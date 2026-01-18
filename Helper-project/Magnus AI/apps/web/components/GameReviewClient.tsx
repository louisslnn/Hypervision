'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard/dist/index.esm.js';

import type {
  CommentaryWizardResponse,
  Game,
  GameAnalysisResponse,
  GameAnalysisSeriesResponse,
  GameRecapResponse,
  Move,
  MoveCommentaryResponse,
} from '@magnus/shared';

import {
  fetchGameRecap,
  fetchMoveCommentary,
  generateCommentaryWizard,
  generateGameRecap,
  generateMoveCommentary,
} from '../lib/api';

const MATE_SCORE = 10000;
const DEFAULT_API_BASE_URL = 'http://localhost:8000';

type GameReviewClientProps = {
  game: Game;
  moves: Move[];
  analysis: GameAnalysisResponse | null;
  series: GameAnalysisSeriesResponse | null;
  initialMoveId?: number;
  playerUsername?: string;
};

type EvalPoint = {
  move_id: number;
  ply: number;
  eval: number;
};

type CommentaryMetaItem = {
  label: string;
  value: string;
};

type WizardToken = {
  id: string;
  type: 'text' | 'move';
  value: string;
};

const ANNOTATION_LABELS: Record<string, string> = {
  best: '★',
  good: '✓',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
  book: '📖',
};

function evalToCp(evalAfter: { eval_cp: number | null; eval_mate: number | null }) {
  if (evalAfter.eval_mate !== null) {
    return Math.sign(evalAfter.eval_mate) * MATE_SCORE;
  }
  return evalAfter.eval_cp;
}

function formatEvalScore(evalCp: number | null, evalMate: number | null): string | null {
  if (evalMate !== null) {
    const prefix = evalMate > 0 ? 'M' : '-M';
    return `${prefix}${Math.abs(evalMate)}`;
  }
  if (evalCp === null) {
    return null;
  }
  const value = evalCp / 100;
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function formatSeconds(ms?: number | null): string | null {
  if (ms === null || ms === undefined) {
    return null;
  }
  const seconds = ms / 1000;
  const precision = seconds >= 10 ? 0 : 1;
  return `${seconds.toFixed(precision)}s`;
}

function stripInternalRefs(text: string): string {
  return text
    .replace(/\([^)]*(move_id|fen_hash)[^)]*\)/gi, '')
    .replace(/\bmove_id\b\s*[:=]?\s*\d+/gi, '')
    .replace(/\bfen_hash\b\s*[:=]?\s*[a-f0-9]{6,}/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeCommentaryText(text: string): string {
  let cleaned = stripInternalRefs(text);
  cleaned = cleaned
    .replace(/\([^)]*\b(eval|evaluation)[^)]*\)/gi, '')
    .replace(
      /\b(eval(?:uation)?\s*(?:moved|moves|shifted|shifts|changed|changes|went|goes)\s*from\s*[^.;]+)([.;])/gi,
      '$2',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned;
}

function buildCommentaryMeta(input: {
  cpl?: number | null;
  bestMove?: string | null;
  evalBeforeCp?: number | null;
  evalBeforeMate?: number | null;
  evalAfterCp?: number | null;
  evalAfterMate?: number | null;
  timeSpentMs?: number | null;
}): CommentaryMetaItem[] {
  const items: CommentaryMetaItem[] = [];
  if (input.cpl !== null && input.cpl !== undefined) {
    items.push({ label: 'CPL', value: String(input.cpl) });
  }
  if (input.bestMove) {
    items.push({ label: 'Best', value: input.bestMove });
  }
  const evalBefore = formatEvalScore(input.evalBeforeCp ?? null, input.evalBeforeMate ?? null);
  const evalAfter = formatEvalScore(input.evalAfterCp ?? null, input.evalAfterMate ?? null);
  if (evalBefore || evalAfter) {
    items.push({ label: 'Eval', value: `${evalBefore ?? 'n/a'} → ${evalAfter ?? 'n/a'}` });
  }
  const timeSpent = formatSeconds(input.timeSpentMs);
  if (timeSpent) {
    items.push({ label: 'Time', value: timeSpent });
  }
  return items;
}

function applyUciMove(fen: string, uci: string): string | null {
  if (!uci || uci.length < 4) {
    return null;
  }
  try {
    const chess = fen === 'start' ? new Chess() : new Chess(fen);
    const move = {
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    };
    const result = chess.move(move);
    if (!result) {
      return null;
    }
    return chess.fen();
  } catch {
    return null;
  }
}

function applySanMove(fen: string, san: string): string | null {
  if (!san) {
    return null;
  }
  const cleaned = sanitizeSanToken(san);
  if (!cleaned) {
    return null;
  }
  try {
    const chess = fen === 'start' ? new Chess() : new Chess(fen);
    const result = chess.move(cleaned, { strict: false });
    if (!result) {
      return null;
    }
    return chess.fen();
  } catch {
    return null;
  }
}

function sanitizeSanToken(san: string): string {
  return san.replace(/[!?]+$/g, '').trim();
}

function tokenizeWizardSegments(
  segments: CommentaryWizardResponse['report']['segments'],
): WizardToken[] {
  const tokens: WizardToken[] = [];
  segments.forEach((segment, segmentIndex) => {
    if (segment.type === 'text' && segment.text) {
      const cleaned = sanitizeCommentaryText(segment.text);
      const words = cleaned.split(/\s+/).filter(Boolean);
      words.forEach((word, wordIndex) => {
        tokens.push({
          id: `t-${segmentIndex}-${wordIndex}`,
          type: 'text',
          value: word,
        });
      });
      return;
    }
    if (segment.type === 'move' && segment.san) {
      const cleaned = sanitizeSanToken(segment.san);
      if (!cleaned) {
        return;
      }
      tokens.push({
        id: `m-${segmentIndex}`,
        type: 'move',
        value: cleaned,
      });
    }
  });
  return tokens;
}

function buildEvalPoints(series: GameAnalysisSeriesResponse | null): EvalPoint[] {
  if (!series) {
    return [];
  }
  return series.series
    .map((point) => {
      const evalCp = evalToCp(point.eval_after);
      if (evalCp === null) {
        return null;
      }
      return {
        move_id: point.move_id,
        ply: point.ply,
        eval: evalCp,
      };
    })
    .filter((point): point is EvalPoint => point !== null);
}

function moveToSquare(uci: string | null): string | null {
  if (!uci || uci.length < 4) {
    return null;
  }
  return uci.slice(2, 4);
}

function squareToPosition(square: string, boardWidth: number) {
  const fileChar = square[0]?.toLowerCase();
  const rankChar = square[1];
  if (!fileChar || !rankChar) {
    return null;
  }
  const fileIndex = fileChar.charCodeAt(0) - 97;
  const rankIndex = Number(rankChar) - 1;
  if (fileIndex < 0 || fileIndex > 7 || rankIndex < 0 || rankIndex > 7) {
    return null;
  }
  const squareSize = boardWidth / 8;
  const x = fileIndex * squareSize;
  const y = (7 - rankIndex) * squareSize;
  return { x, y, squareSize };
}

function EvalGraph({ points, currentMoveId }: { points: EvalPoint[]; currentMoveId?: number }) {
  if (points.length < 2) {
    return <p className="muted">Evaluation graph requires analyzed moves.</p>;
  }

  const width = 520;
  const height = 140;
  const values = points.map((point) => point.eval);
  const min = Math.min(...values, -200);
  const max = Math.max(...values, 200);
  const range = Math.max(max - min, 1);

  const coords = points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - ((point.eval - min) / range) * height;
    return { ...point, x, y };
  });

  const path = coords.map((point) => `${point.x},${point.y}`).join(' ');
  const zeroY = height - ((0 - min) / range) * height;
  const current = coords.find((point) => point.move_id === currentMoveId);

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img">
      <line x1="0" y1={zeroY} x2={width} y2={zeroY} className="chart-midline" />
      <polyline points={path} className="chart-line" fill="none" />
      {current ? <circle cx={current.x} cy={current.y} r="4" className="chart-dot" /> : null}
    </svg>
  );
}

function TimeChart({
  series,
  currentMoveId,
}: {
  series: GameAnalysisSeriesResponse | null;
  currentMoveId?: number;
}) {
  if (!series || series.series.length === 0) {
    return <p className="muted">Time chart requires clock data.</p>;
  }

  const values = series.series.map((point) => point.time_spent_ms ?? 0);
  const max = Math.max(...values, 1);

  return (
    <div className="time-chart">
      {series.series.map((point, index) => {
        const height = Math.max((values[index] / max) * 100, 2);
        const active = point.move_id === currentMoveId;
        return (
          <span
            key={point.move_id}
            className={`time-bar${active ? ' active' : ''}`}
            style={{ height: `${height}%` }}
            title={`${point.time_spent_ms ?? 0} ms`}
          />
        );
      })}
    </div>
  );
}

export function GameReviewClient({
  game,
  moves,
  analysis,
  series,
  initialMoveId,
  playerUsername,
}: GameReviewClientProps) {
  const [moveIndex, setMoveIndex] = useState(0);
  const [boardWidth, setBoardWidth] = useState(420);
  const [analysisTab, setAnalysisTab] = useState<'critical' | 'evaluation' | 'commentary'>(
    'critical',
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [commentary, setCommentary] = useState<MoveCommentaryResponse | null>(null);
  const [recap, setRecap] = useState<GameRecapResponse | null>(null);
  const [commentaryLoading, setCommentaryLoading] = useState(false);
  const [recapLoading, setRecapLoading] = useState(false);
  const [commentaryError, setCommentaryError] = useState<string | null>(null);
  const [recapError, setRecapError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardQuestion, setWizardQuestion] = useState('');
  const [wizardResponse, setWizardResponse] = useState<CommentaryWizardResponse | null>(null);
  const [wizardTokens, setWizardTokens] = useState<WizardToken[]>([]);
  const [wizardTokenIndex, setWizardTokenIndex] = useState(0);
  const [wizardPlaying, setWizardPlaying] = useState(false);
  const [wizardLoading, setWizardLoading] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [wizardFen, setWizardFen] = useState<string | null>(null);
  const [wizardBaseFen, setWizardBaseFen] = useState<string | null>(null);
  const [previewFen, setPreviewFen] = useState<string | null>(null);
  const [previewMove, setPreviewMove] = useState<string | null>(null);
  const wizardChessRef = useRef<Chess | null>(null);

  const apiBaseUrl = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    [],
  );

  useEffect(() => {
    const update = () => {
      const width = window.innerWidth;
      setBoardWidth(Math.min(520, width - 64));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    if (!initialMoveId) {
      return;
    }
    const index = moves.findIndex((move) => move.id === initialMoveId);
    if (index >= 0) {
      setMoveIndex(index + 1);
    }
  }, [initialMoveId, moves]);

  const startFen = moves[0]?.fen_before ?? 'start';
  const currentMove = moveIndex > 0 ? moves[moveIndex - 1] : null;
  const currentFen = currentMove ? currentMove.fen_after : startFen;
  const displayFen = wizardFen ?? previewFen ?? currentFen;

  const evalPoints = useMemo(() => buildEvalPoints(series), [series]);
  const analysisByMoveId = useMemo(() => {
    const map = new Map<number, GameAnalysisSeriesResponse['series'][number]>();
    if (series) {
      for (const point of series.series) {
        map.set(point.move_id, point);
      }
    }
    return map;
  }, [series]);

  const navigate = (nextIndex: number) => {
    const clamped = Math.max(0, Math.min(nextIndex, moves.length));
    setMoveIndex(clamped);
  };

  const analysisVersion = analysis?.analysis_version ?? series?.analysis_version ?? undefined;
  const analysisComplete = Boolean(
    analysis && moves.length > 0 && analysis.move_count === moves.length,
  );
  const currentAnalysis = currentMove ? analysisByMoveId.get(currentMove.id) : null;
  const currentClassification = currentAnalysis?.classification;
  const annotationLabel = currentClassification
    ? ANNOTATION_LABELS[currentClassification] ?? null
    : null;
  const annotationSquare = currentMove ? moveToSquare(currentMove.move_uci) : null;
  const annotationPosition =
    annotationSquare && annotationLabel ? squareToPosition(annotationSquare, boardWidth) : null;
  const markerStyle = annotationPosition
    ? (() => {
        const markerSize = Math.max(16, Math.round(annotationPosition.squareSize * 0.28));
        const offset = Math.max(4, Math.round(annotationPosition.squareSize * 0.05));
        return {
          left: annotationPosition.x + annotationPosition.squareSize - markerSize - offset,
          top: annotationPosition.y + offset,
          width: markerSize,
          height: markerSize,
          fontSize: Math.max(10, Math.round(markerSize * 0.55)),
        };
      })()
    : null;

  const player =
    game.white_username && game.black_username
      ? `${game.white_username} vs ${game.black_username}`
      : 'Game';

  const playerSide = useMemo(() => {
    const normalized = playerUsername?.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (game.white_username?.toLowerCase() === normalized) {
      return 'white';
    }
    if (game.black_username?.toLowerCase() === normalized) {
      return 'black';
    }
    return null;
  }, [game.black_username, game.white_username, playerUsername]);

  const currentCommentary = useMemo(() => {
    if (!commentary || !currentMove) {
      return null;
    }
    return (
      commentary.report.moves.find((item) => item.move_id === currentMove.id) ??
      commentary.report.moves.find((item) => item.ply === currentMove.ply) ??
      null
    );
  }, [commentary, currentMove]);

  const bestMoveUci = currentCommentary?.evidence.best_move_uci ?? null;
  const canPreviewBest = Boolean(currentMove && bestMoveUci && !wizardPlaying);

  const clearPreview = () => {
    setPreviewFen(null);
    setPreviewMove(null);
  };

  const handlePreviewBest = () => {
    if (!currentMove || !bestMoveUci) {
      return;
    }
    if (previewFen) {
      clearPreview();
      return;
    }
    const fenBefore = currentMove.fen_before ?? startFen;
    const nextFen = applyUciMove(fenBefore, bestMoveUci);
    if (!nextFen) {
      setCommentaryError('Unable to preview the best move for this position.');
      return;
    }
    setPreviewFen(nextFen);
    setPreviewMove(bestMoveUci);
  };

  const resetWizardBoard = (baseFen: string) => {
    try {
      wizardChessRef.current = baseFen === 'start' ? new Chess() : new Chess(baseFen);
      setWizardBaseFen(baseFen);
      setWizardFen(wizardChessRef.current.fen());
    } catch {
      wizardChessRef.current = null;
      setWizardBaseFen(null);
      setWizardFen(null);
    }
  };

  const stopWizardPlayback = () => {
    setWizardPlaying(false);
    setWizardTokenIndex(0);
    setWizardFen(null);
    setWizardBaseFen(null);
    wizardChessRef.current = null;
  };

  const startWizardPlayback = () => {
    if (!wizardTokens.length) {
      return;
    }
    const baseFen = currentMove?.fen_after ?? startFen;
    setWizardError(null);
    resetWizardBoard(baseFen);
    setWizardTokenIndex(0);
    setWizardPlaying(true);
    setPreviewFen(null);
    setPreviewMove(null);
  };

  const previewWizardMove = (san: string) => {
    const baseFen = currentMove?.fen_after ?? startFen;
    const nextFen = applySanMove(baseFen, san);
    if (!nextFen) {
      setWizardError('Unable to preview that move on the current position.');
      return;
    }
    setWizardError(null);
    setWizardPlaying(false);
    setWizardTokenIndex(0);
    setWizardBaseFen(baseFen);
    setWizardFen(nextFen);
  };

  const runParse = async () => {
    setActionError(null);
    setParsing(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/games/${game.id}/parse`, {
        method: 'POST',
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Request failed (${response.status})`);
      }
      window.location.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to parse moves.');
    } finally {
      setParsing(false);
    }
  };

  const runAnalysis = async () => {
    setActionError(null);
    setAnalyzing(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/games/${game.id}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Request failed (${response.status})`);
      }
      window.location.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to run analysis.');
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    if (!analysisVersion) {
      return;
    }
    fetchMoveCommentary(game.id, analysisVersion)
      .then((data) => setCommentary(data))
      .catch((err) =>
        setCommentaryError(err instanceof Error ? err.message : 'Unable to load commentary.'),
      );
    fetchGameRecap(game.id, analysisVersion)
      .then((data) => setRecap(data))
      .catch((err) =>
        setRecapError(err instanceof Error ? err.message : 'Unable to load recap.'),
      );
  }, [analysisVersion, game.id]);

  useEffect(() => {
    setWizardResponse(null);
    setWizardTokens([]);
    setWizardTokenIndex(0);
    setWizardPlaying(false);
    setWizardError(null);
    setWizardFen(null);
    setWizardBaseFen(null);
    wizardChessRef.current = null;
  }, [commentary?.output_id]);

  useEffect(() => {
    setPreviewFen(null);
    setPreviewMove(null);
    setWizardOpen(false);
    setWizardResponse(null);
    setWizardTokens([]);
    setWizardTokenIndex(0);
    setWizardPlaying(false);
    setWizardError(null);
    setWizardFen(null);
    setWizardBaseFen(null);
    wizardChessRef.current = null;
  }, [moveIndex]);

  useEffect(() => {
    if (!wizardOpen) {
      setWizardPlaying(false);
      setWizardTokenIndex(0);
      setWizardFen(null);
      setWizardBaseFen(null);
      wizardChessRef.current = null;
    }
  }, [wizardOpen]);

  useEffect(() => {
    if (!wizardPlaying || wizardTokens.length === 0) {
      return;
    }
    if (wizardTokenIndex >= wizardTokens.length) {
      setWizardPlaying(false);
      return;
    }
    const token = wizardTokens[wizardTokenIndex];
    let shouldAdvance = true;
    if (token.type === 'move') {
      if (!wizardChessRef.current) {
        const baseFen = wizardBaseFen ?? currentMove?.fen_after ?? startFen;
        try {
          wizardChessRef.current = baseFen === 'start' ? new Chess() : new Chess(baseFen);
          setWizardBaseFen(baseFen);
          setWizardFen(wizardChessRef.current.fen());
        } catch {
          wizardChessRef.current = null;
          setWizardFen(null);
        }
      }
      if (wizardChessRef.current) {
        const sanitizedMove = sanitizeSanToken(token.value);
        if (!sanitizedMove) {
          setWizardError('Wizard move could not be applied.');
          setWizardPlaying(false);
          shouldAdvance = false;
        } else {
          try {
            const legalMoves = wizardChessRef.current.moves({ verbose: true });
            const match = legalMoves.find((move) => move.san === sanitizedMove);
            if (!match) {
              setWizardError(`Wizard move "${sanitizedMove}" is not legal from this position.`);
              setWizardPlaying(false);
              shouldAdvance = false;
            } else {
              const result = wizardChessRef.current.move(match.san);
              if (result) {
                setWizardFen(wizardChessRef.current.fen());
              }
            }
          } catch {
            setWizardError(`Wizard move "${sanitizedMove}" could not be applied.`);
            setWizardPlaying(false);
            shouldAdvance = false;
          }
        }
      }
    }
    if (!shouldAdvance) {
      return;
    }
    const delay = token.type === 'move' ? 900 : 220;
    const timer = window.setTimeout(() => {
      setWizardTokenIndex((index) => index + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    wizardPlaying,
    wizardTokens,
    wizardTokenIndex,
    wizardBaseFen,
    currentMove,
    startFen,
  ]);

  const runCommentary = async (force?: boolean) => {
    setCommentaryError(null);
    setCommentaryLoading(true);
    try {
      const response = await generateMoveCommentary(game.id, analysisVersion, force);
      setCommentary(response);
    } catch (err) {
      setCommentaryError(err instanceof Error ? err.message : 'Unable to generate commentary.');
    } finally {
      setCommentaryLoading(false);
    }
  };

  const runRecap = async (force?: boolean) => {
    setRecapError(null);
    setRecapLoading(true);
    try {
      const response = await generateGameRecap(game.id, analysisVersion, force);
      setRecap(response);
    } catch (err) {
      setRecapError(err instanceof Error ? err.message : 'Unable to generate recap.');
    } finally {
      setRecapLoading(false);
    }
  };

  const runWizard = async () => {
    if (!currentMove) {
      setWizardError('Select a move to ask about its commentary.');
      return;
    }
    if (!commentary) {
      setWizardError('Generate commentary before asking the wizard.');
      return;
    }
    const trimmed = wizardQuestion.trim();
    if (!trimmed) {
      setWizardError('Enter a question for the current move.');
      return;
    }
    setWizardError(null);
    setWizardLoading(true);
    try {
      const response = await generateCommentaryWizard(
        game.id,
        currentMove.id,
        trimmed,
        analysisVersion,
      );
      setWizardResponse(response);
      setWizardTokens(tokenizeWizardSegments(response.report.segments));
      setWizardTokenIndex(0);
      setWizardPlaying(false);
      setWizardFen(null);
      setWizardBaseFen(null);
      wizardChessRef.current = null;
    } catch (err) {
      setWizardError(err instanceof Error ? err.message : 'Unable to fetch wizard response.');
    } finally {
      setWizardLoading(false);
    }
  };

  const renderCriticalMoments = () => {
    if (!analysis) {
      return <p className="muted">Run engine analysis to see critical moments.</p>;
    }
    return (
      <div className="critical-list">
        {analysis.critical_moments.map((moment) => (
          <button
            key={moment.move_id}
            className="critical-card"
            onClick={() => navigate(moment.ply)}
          >
            <div>
              <strong>
                {moment.ply}. {moment.move_san}
              </strong>
              <p className="muted">
                {moment.classification} · CPL {moment.cpl ?? 'n/a'}
              </p>
            </div>
            <div className="critical-meta">
              <span className="label">Best</span>
              <span>{moment.best_move_uci ?? 'n/a'}</span>
            </div>
          </button>
        ))}
      </div>
    );
  };

  const renderEvaluation = () => (
    <div className="chart-stack">
      <div className="chart-panel">
        <h3>Evaluation</h3>
        <EvalGraph points={evalPoints} currentMoveId={currentMove?.id} />
      </div>
      <div className="chart-panel">
        <h3>Time usage</h3>
        <TimeChart series={series} currentMoveId={currentMove?.id} />
      </div>
    </div>
  );

  const renderCommentary = () => (
    <>
      {!analysisVersion ? (
        <p className="muted">Run engine analysis to unlock per-move commentary.</p>
      ) : (
        <>
          <div className="commentary-toolbar">
            <button
              className="button secondary"
              type="button"
              onClick={() => runCommentary(false)}
              disabled={commentaryLoading}
            >
              {commentaryLoading
                ? 'Generating…'
                : commentary
                  ? 'Regenerate commentary'
                  : 'Generate commentary'}
            </button>
            <button
              className={`button ghost wizard-toggle${wizardOpen ? ' active' : ''}`}
              type="button"
              onClick={() => setWizardOpen((open) => !open)}
              disabled={!analysisVersion}
            >
              Wizard
            </button>
          </div>
          <p className="muted">
            Commentary can take a few minutes for full games. Leave this tab open while it runs.
          </p>
          {!analysisComplete ? (
            <p className="muted">
              Full engine analysis will run automatically if it has not completed yet.
            </p>
          ) : null}
          {commentaryError ? <p className="muted">{commentaryError}</p> : null}
          {wizardOpen ? (
            <div className="wizard-panel">
              <div className="wizard-header">
                <div>
                  <span className="label">Coach wizard</span>
                  <p className="muted">
                    Ask about move {currentMove?.ply ?? '—'}
                    {currentMove?.move_san ? ` (${currentMove.move_san})` : ''}.
                  </p>
                </div>
                <button className="button ghost" type="button" onClick={() => setWizardOpen(false)}>
                  Close
                </button>
              </div>
              <label className="wizard-label" htmlFor="wizard-question">
                Your question
              </label>
              <textarea
                id="wizard-question"
                className="wizard-input"
                rows={3}
                placeholder="Ask why this move is strong, what the threat is, or what plan follows."
                value={wizardQuestion}
                onChange={(event) => setWizardQuestion(event.target.value)}
              />
              {!commentary ? (
                <p className="muted">Generate commentary to unlock the wizard responses.</p>
              ) : null}
              <div className="wizard-actions">
                <button
                  className="button secondary"
                  type="button"
                  onClick={runWizard}
                  disabled={wizardLoading || !currentMove || !commentary}
                >
                  {wizardLoading ? 'Thinking…' : 'Ask'}
                </button>
                <button
                  className="button ghost"
                  type="button"
                  onClick={startWizardPlayback}
                  disabled={!wizardTokens.length || wizardPlaying}
                >
                  {wizardPlaying ? 'Playing…' : 'Play'}
                </button>
                <button
                  className="button ghost"
                  type="button"
                  onClick={stopWizardPlayback}
                  disabled={!wizardTokens.length}
                >
                  Reset
                </button>
              </div>
              {wizardError ? <p className="muted">{wizardError}</p> : null}
              {wizardLoading && !wizardResponse ? (
                <p className="muted">Generating a grounded answer...</p>
              ) : null}
              {wizardResponse ? (
                <div className="wizard-answer">
                  <div className="wizard-stream">
                    {wizardTokens.length ? (
                      wizardTokens.map((token, index) => {
                        const isActive = wizardPlaying && index === wizardTokenIndex;
                        if (token.type === 'move') {
                          return (
                            <span key={token.id} className="wizard-token">
                              <button
                                className={`wizard-move${isActive ? ' active' : ''}`}
                                type="button"
                                onClick={() => previewWizardMove(token.value)}
                              >
                                {token.value}
                              </button>
                              {index < wizardTokens.length - 1 ? ' ' : null}
                            </span>
                          );
                        }
                        return (
                          <span
                            key={token.id}
                            className={`wizard-word${isActive ? ' active' : ''}`}
                          >
                            {token.value}
                            {index < wizardTokens.length - 1 ? ' ' : null}
                          </span>
                        );
                      })
                    ) : (
                      <p className="muted">No wizard response yet.</p>
                    )}
                  </div>
                  {wizardResponse.report.limitations.length ? (
                    <div className="wizard-limitations">
                      <span className="label">Limitations</span>
                      <ul>
                        {wizardResponse.report.limitations.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {commentaryLoading && !commentary ? (
            <div className="commentary-shimmer">
              <div className="commentary-shimmer-header">
                <span className="shimmer-line shimmer-title" />
                <span className="shimmer-pill" />
              </div>
              <span className="shimmer-line" />
              <span className="shimmer-line shimmer-wide" />
              <span className="shimmer-line" />
              <div className="commentary-shimmer-meta">
                <span className="shimmer-pill" />
                <span className="shimmer-pill" />
                <span className="shimmer-pill" />
              </div>
              <div className="commentary-shimmer-best">
                <span className="shimmer-line shimmer-label" />
                <span className="shimmer-line shimmer-wide" />
                <span className="shimmer-line" />
              </div>
            </div>
          ) : null}
          {commentary && currentMove ? (
            currentCommentary ? (
              <div
                className="commentary-focus"
                data-classification={currentCommentary.classification}
              >
                <div className="commentary-focus-header">
                  <div>
                    <span className="commentary-focus-kicker">
                      Move {currentCommentary.ply} of {moves.length}
                    </span>
                    <h3 className="commentary-focus-title">{currentCommentary.move_san}</h3>
                  </div>
                  <span className={`tag tag-${currentCommentary.classification}`}>
                    {currentCommentary.classification}
                  </span>
                </div>
                <p className="commentary-focus-text">
                  {sanitizeCommentaryText(currentCommentary.explanation)}
                </p>
                {(() => {
                  const metaItems = buildCommentaryMeta({
                    cpl: currentCommentary.cpl,
                    bestMove: currentCommentary.evidence.best_move_uci,
                    evalBeforeCp: currentCommentary.evidence.eval_before_cp,
                    evalBeforeMate: currentCommentary.evidence.eval_before_mate,
                    evalAfterCp: currentCommentary.evidence.eval_after_cp,
                    evalAfterMate: currentCommentary.evidence.eval_after_mate,
                    timeSpentMs: currentCommentary.time_spent_ms,
                  });
                  return metaItems.length ? (
                    <div className="commentary-meta">
                      {metaItems.map((meta) => (
                        <div
                          key={`${currentCommentary.move_id}-${meta.label}`}
                          className="commentary-meta-item"
                        >
                          <span className="commentary-meta-label">{meta.label}</span>
                          <span className="commentary-meta-value">{meta.value}</span>
                        </div>
                      ))}
                    </div>
                  ) : null;
                })()}
                <div className="commentary-best">
                  <div className="commentary-best-copy">
                    <span className="label">Better move</span>
                    <div className="commentary-best-row">
                      <strong>{bestMoveUci ?? 'n/a'}</strong>
                      <button
                        className="commentary-best-button"
                        type="button"
                        onClick={handlePreviewBest}
                        disabled={!canPreviewBest}
                      >
                        {previewFen ? 'Return to game move' : 'Preview best move'}
                      </button>
                    </div>
                    <p className="commentary-best-text">
                      {sanitizeCommentaryText(
                        currentCommentary.best_move_explanation ??
                          'No best move explanation available for this position.',
                      )}
                    </p>
                  </div>
                </div>
                {currentCommentary.focus_tags.length > 0 ? (
                  <div className="tag-row commentary-tags">
                    {currentCommentary.focus_tags.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="muted">No commentary found for this move yet.</p>
            )
          ) : null}
          {commentary && !currentMove ? (
            <p className="muted">Start stepping through moves to see commentary.</p>
          ) : null}
        </>
      )}
    </>
  );

  const renderRecap = () => (
    <section className="card recap-panel">
      <h3>Game recap</h3>
      {!analysisVersion ? (
        <p className="muted">
          Recap generation will run engine analysis automatically if needed.
        </p>
      ) : (
        <>
          <button
            className="button secondary"
            type="button"
            onClick={() => runRecap(false)}
            disabled={recapLoading}
          >
            {recapLoading ? 'Generating…' : recap ? 'Regenerate recap' : 'Generate recap'}
          </button>
          {recapError ? <p className="muted">{recapError}</p> : null}
          {recap ? (
            <div className="panel">
              <strong>Summary</strong>
              <ul>
                {recap.report.summary.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
              <div className="tag-row">
                {recap.report.training_focus.map((item, index) => (
                  <span key={`${item}-${index}`} className="pill">
                    {item}
                  </span>
                ))}
              </div>
              <div className="grid">
                <div>
                  <strong>Strengths</strong>
                  <ul>
                    {recap.report.strengths.map((item, index) => (
                      <li key={`${item}-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Weaknesses</strong>
                  <ul>
                    {recap.report.weaknesses.map((item, index) => (
                      <li key={`${item}-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
              {recap.report.key_moments.length > 0 ? (
                <div className="commentary-list">
                  {recap.report.key_moments.map((moment) => {
                    const metaItems = buildCommentaryMeta({
                      cpl: moment.cpl,
                      bestMove: moment.evidence.best_move_uci,
                      evalBeforeCp: moment.evidence.eval_before_cp,
                      evalBeforeMate: moment.evidence.eval_before_mate,
                      evalAfterCp: moment.evidence.eval_after_cp,
                      evalAfterMate: moment.evidence.eval_after_mate,
                    });
                    return (
                      <button
                        key={moment.move_id}
                        className="commentary-card"
                        data-classification={moment.classification}
                        onClick={() => navigate(moment.ply)}
                      >
                        <div className="commentary-header">
                          <div className="commentary-move">
                            <span className="commentary-ply">{moment.ply}.</span>
                            <span className="commentary-san">{moment.move_san}</span>
                          </div>
                          <span className={`tag tag-${moment.classification}`}>
                            {moment.classification}
                          </span>
                        </div>
                        <p className="commentary-text">{moment.explanation}</p>
                        {metaItems.length > 0 ? (
                          <div className="commentary-meta">
                            {metaItems.map((meta) => (
                              <div
                                key={`${moment.move_id}-${meta.label}`}
                                className="commentary-meta-item"
                              >
                                <span className="commentary-meta-label">{meta.label}</span>
                                <span className="commentary-meta-value">{meta.value}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );

  return (
    <>
      <div className="review-grid">
        <section className="board-panel">
        <div className="board-header">
          <div>
            <h2>{player}</h2>
            <p className="muted">
              {game.time_control ?? 'Unknown time control'} · {game.time_class ?? 'class'}
            </p>
            {playerSide ? (
              <div className={`player-side player-${playerSide}`}>
                You played {playerSide === 'white' ? 'White' : 'Black'}
              </div>
            ) : null}
          </div>
          <div className="analysis-status">
            <span className="label">Analysis</span>
            <span className="pill">{analysis ? 'ready' : 'pending'}</span>
            {!analysis ? (
              <button className="button secondary" type="button" onClick={runAnalysis} disabled={analyzing}>
                {analyzing ? 'Analyzing…' : 'Run analysis'}
              </button>
            ) : null}
          </div>
        </div>
        {actionError ? <p className="muted">{actionError}</p> : null}
        <div className="board-wrap">
          <Chessboard position={displayFen} boardWidth={boardWidth} />
          {annotationLabel && markerStyle && currentClassification ? (
            <span
              className={`annotation-marker annotation-${currentClassification}`}
              style={markerStyle}
              title={`${currentClassification} move`}
            >
              {annotationLabel}
            </span>
          ) : null}
        </div>
        <div className="board-controls">
          <button className="button secondary" onClick={() => navigate(0)}>
            {'<<'}
          </button>
          <button className="button secondary" onClick={() => navigate(moveIndex - 1)}>
            {'<'}
          </button>
          <span className="pill">
            {moveIndex}/{moves.length}
          </span>
          <button className="button secondary" onClick={() => navigate(moveIndex + 1)}>
            {'>'}
          </button>
          <button className="button secondary" onClick={() => navigate(moves.length)}>
            {'>>'}
          </button>
        </div>
        {previewFen && previewMove ? (
          <div className="preview-banner">
            <span className="label">Preview</span>
            <span>Best move {previewMove}</span>
            <button className="button secondary" type="button" onClick={clearPreview}>
              Return to game move
            </button>
          </div>
        ) : null}
        {moves.length === 0 ? (
          <div className="panel">
            <p className="muted">Moves are not parsed yet.</p>
            <button className="button secondary" type="button" onClick={runParse} disabled={parsing}>
              {parsing ? 'Parsing…' : 'Parse moves'}
            </button>
          </div>
        ) : null}
        </section>

        <section className="side-panel">
          <div className="panel-section analysis-tabs">
            <div className="tab-header">
              <button
                className={`tab-button${analysisTab === 'critical' ? ' active' : ''}`}
                type="button"
                onClick={() => setAnalysisTab('critical')}
              >
                Critical moments
              </button>
              <button
                className={`tab-button${analysisTab === 'evaluation' ? ' active' : ''}`}
                type="button"
                onClick={() => setAnalysisTab('evaluation')}
              >
                Evaluation
              </button>
              <button
                className={`tab-button${analysisTab === 'commentary' ? ' active' : ''}`}
                type="button"
                onClick={() => setAnalysisTab('commentary')}
              >
                Commentary
              </button>
            </div>
            <div className="tab-body">
              {analysisTab === 'critical' ? renderCriticalMoments() : null}
              {analysisTab === 'evaluation' ? renderEvaluation() : null}
              {analysisTab === 'commentary' ? renderCommentary() : null}
            </div>
          </div>
        </section>
      </div>
      {renderRecap()}
    </>
  );
}
