"use client";

import {
  computeHomography,
  invertHomography,
  InteractionState,
  reduceInteraction,
  syncCanvasToVideo
} from "@hypervision/ar-core";
import { createInitialGameState, MoveDTO, tryMove } from "@hypervision/chess-domain";
import { Chess } from "chess.js";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PerfHud } from "@/components/PerfHud";
import { FirebaseSyncAdapter } from "@/features/multiplayer/FirebaseSyncAdapter";
import { defaultCalibration, ScreenPoint, screenToSquare } from "@/lib/boardMapping";
import { GhostPiece, renderBoard } from "@/lib/chessBoardRenderer";
import { useCamera } from "@/lib/useCamera";
import { useEngine, AnalyzeMoveResponse } from "@/lib/useEngine";
import { useHandGestures } from "@/lib/useHandGestures";
import { useVoice } from "@/lib/useVoice";

const BOARD_POINTS = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 }
];

const ILLEGAL_MOVE_CLEAR_MS = 3000;
const OPPONENT_MOVE_DELAY_MS = 500;

type Mode = "local" | "practice" | "multiplayer";

const PRACTICE_LEVELS = {
  beginner: {
    label: "Beginner",
    analysisMs: 80,
    replyMs: 120,
    skillLevel: 4,
    limitStrength: true,
    elo: 800
  },
  intermediate: {
    label: "Intermediate",
    analysisMs: 160,
    replyMs: 240,
    skillLevel: 10,
    limitStrength: true,
    elo: 1400
  },
  advanced: {
    label: "Advanced",
    analysisMs: 320,
    replyMs: 400,
    skillLevel: 18,
    limitStrength: false,
    elo: 2000
  }
} as const;

type PracticeLevel = keyof typeof PRACTICE_LEVELS;
type PracticeConfig = (typeof PRACTICE_LEVELS)[PracticeLevel];

type CoachState = {
  // Move classification from Magnus AI-style analysis
  classification: string;
  classificationLabel: string;

  // Coach feedback
  explanation: string;
  bestMoveExplanation?: string | undefined;
  tips: string[];
  encouragement: string;

  // Analysis data
  centipawnLoss: number;
  evalBeforeCP?: number | undefined;
  evalAfterCP?: number | undefined;

  // Visual indicators
  arrow?: { from: string; to: string } | undefined;
  line?: string[] | undefined;
  ghostPieces?: GhostPiece[] | undefined;
};

export function ChessExperience() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [calibration, setCalibration] = useState<ScreenPoint[]>([]);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [focusedSquare, setFocusedSquare] = useState<string>("e2");
  const [mode, setMode] = useState<Mode>("practice");
  const [practiceLevel, setPracticeLevel] = useState<PracticeLevel>("intermediate");
  const [moveHistory, setMoveHistory] = useState<MoveDTO[]>([]);
  const [coachState, setCoachState] = useState<CoachState | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showPerfHud, setShowPerfHud] = useState(false);
  const [gameIdInput, setGameIdInput] = useState("");
  const [gameId, setGameId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState("offline");

  const [gameState, setGameState] = useState(() => createInitialGameState());
  const gameStateRef = useRef(gameState);
  const serverStateRef = useRef(gameState);
  const cursorRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const selectedSquareRef = useRef<string | null>(null);
  const containerSizeRef = useRef<{ width: number; height: number } | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep gameStateRef in sync with gameState to avoid stale closures
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
    };
  }, []);

  const cameraState = useCamera(videoRef, true);
  const engineState = useEngine(mode === "practice");
  const practiceConfig = PRACTICE_LEVELS[practiceLevel];
  const syncAdapterRef = useRef(new FirebaseSyncAdapter());

  // Voice features
  const openaiApiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  const voice = useVoice(openaiApiKey);

  const homography = useMemo(() => {
    if (calibration.length !== 4) {
      return null;
    }
    return computeHomography(BOARD_POINTS, calibration);
  }, [calibration]);

  const inverseHomography = useMemo(() => {
    if (!homography) {
      return null;
    }
    return invertHomography(homography);
  }, [homography]);

  const interactionRef = useRef<InteractionState>({ status: "idle" });
  const attemptMoveRef = useRef<(from: string, to: string) => Promise<void>>(async () => {});

  const handleGestureEvent = useCallback((event: Parameters<typeof reduceInteraction>[1]) => {
    const output = reduceInteraction(interactionRef.current, event);
    interactionRef.current = output.state;

    if (output.proposedMove) {
      // Reset interaction state immediately so user can retry if move fails
      interactionRef.current = { status: "idle" };
      void attemptMoveRef.current(output.proposedMove.from, output.proposedMove.to);
    }
  }, []);

  const gestureState = useHandGestures({
    enabled: process.env.NEXT_PUBLIC_DISABLE_HANDS !== "true",
    videoRef,
    inverseHomography,
    onEvent: handleGestureEvent
  });

  useEffect(() => {
    cursorRef.current = gestureState.cursor;
  }, [gestureState.cursor]);

  useEffect(() => {
    const stored = window.localStorage.getItem("hv_calibration");
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as ScreenPoint[];
        if (Array.isArray(parsed) && parsed.length === 4) {
          setCalibration(parsed);
          return;
        }
      } catch {
        setCalibration([]);
      }
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const handleLoaded = () => {
      const width = video.clientWidth || video.videoWidth;
      const height = video.clientHeight || video.videoHeight;
      if (calibration.length === 0 && width > 0 && height > 0) {
        const defaults = defaultCalibration(width, height);
        setCalibration(defaults);
      }
    };

    video.addEventListener("loadedmetadata", handleLoaded);
    return () => {
      video.removeEventListener("loadedmetadata", handleLoaded);
    };
  }, [calibration.length]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const previous = containerSizeRef.current;
      if (!previous) {
        containerSizeRef.current = { width: rect.width, height: rect.height };
        if (calibration.length === 0) {
          setCalibration(defaultCalibration(rect.width, rect.height));
        }
        return;
      }

      if (previous.width === rect.width && previous.height === rect.height) {
        return;
      }

      containerSizeRef.current = { width: rect.width, height: rect.height };

      if (calibration.length === 0) {
        setCalibration(defaultCalibration(rect.width, rect.height));
        return;
      }

      if (calibration.length === 4) {
        const scaleX = rect.width / previous.width;
        const scaleY = rect.height / previous.height;
        setCalibration((points) =>
          points.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY }))
        );
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [calibration.length]);

  useEffect(() => {
    if (calibration.length === 4) {
      window.localStorage.setItem("hv_calibration", JSON.stringify(calibration));
    }
  }, [calibration]);

  useEffect(() => {
    let rafId: number | null = null;
    const draw = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video || !homography) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      syncCanvasToVideo(canvas, video);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      const draggingPiece = getDraggingPiece(gameState.fen, interactionRef.current);
      const highlightSquares = new Set<string>();
      if (selectedSquare) {
        highlightSquares.add(selectedSquare);
      }
      if (focusedSquare) {
        highlightSquares.add(focusedSquare);
      }
      const highlight = {
        squares: Array.from(highlightSquares),
        ...(coachState?.arrow ? { arrow: coachState.arrow } : {})
      };
      renderBoard(
        ctx,
        homography,
        gameState.fen,
        highlight,
        draggingPiece,
        cursorRef.current,
        coachState?.ghostPieces
      );

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [gameState.fen, homography, selectedSquare, focusedSquare, coachState]);

  useEffect(() => {
    if (mode !== "multiplayer" || !gameId) {
      return;
    }

    setSyncStatus("connecting");
    const unsubscribe = syncAdapterRef.current.subscribeToGame(gameId, (snapshot) => {
      setSyncStatus("synced");
      const nextState = {
        fen: snapshot.fen,
        moveNumber: snapshot.moveNumber,
        turn: snapshot.turn,
        version: snapshot.version
      };
      serverStateRef.current = nextState;
      setGameState(nextState);
    });

    return () => {
      unsubscribe();
      setSyncStatus("offline");
    };
  }, [gameId, mode]);

  useEffect(() => {
    if (mode !== "practice") {
      setCoachState(null);
    }
  }, [mode]);

  const updateSelectedSquare = (square: string | null) => {
    selectedSquareRef.current = square;
    setSelectedSquare(square);
  };

  const updateStatusMessage = (message: string | null, timeoutMs?: number) => {
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = null;
    }
    setStatusMessage(message);
    if (message && timeoutMs) {
      statusTimeoutRef.current = setTimeout(() => {
        setStatusMessage(null);
        statusTimeoutRef.current = null;
      }, timeoutMs);
    }
  };

  const attemptMove = async (from: string, to: string) => {
    const currentGame = gameStateRef.current;
    const uci = `${from}${to}`;
    if (process.env.NEXT_PUBLIC_DEBUG_INPUT === "true") {
      console.info("[input] attempt", {
        from,
        to,
        mode,
        gameId,
        fen: currentGame.fen,
        turn: currentGame.turn
      });
    }
    const result = tryMove(currentGame.fen, uci);
    if (!result.ok) {
      if (result.reason === "Illegal move") {
        updateStatusMessage(result.reason, ILLEGAL_MOVE_CLEAR_MS);
      } else {
        updateStatusMessage(result.reason);
      }
      return;
    }

    updateStatusMessage(null);
    updateSelectedSquare(null);
    setFocusedSquare(to);
    setMoveHistory((prev) => [...prev, result.move]);

    const optimistic = {
      fen: result.fen,
      moveNumber: result.moveNumber,
      turn: result.turn,
      version: mode === "multiplayer" ? currentGame.version + 1 : currentGame.version
    };

    setGameState(optimistic);
    gameStateRef.current = optimistic;

    if (mode === "practice") {
      await handlePracticeResponse(
        currentGame.fen,
        result.fen,
        result.turn,
        result.move,
        engineState.engine,
        practiceConfig
      );
    }

    if (mode === "multiplayer" && gameId) {
      try {
        await syncAdapterRef.current.submitMove(gameId, uci, currentGame.version);
      } catch (error) {
        updateStatusMessage(error instanceof Error ? error.message : "Move rejected");
        setGameState(serverStateRef.current);
      }
    }
  };

  // Keep attemptMoveRef in sync so gesture handler always calls the latest version
  attemptMoveRef.current = attemptMove;

  const handlePracticeResponse = async (
    fenBeforeUser: string,
    fenAfterUser: string,
    turnAfterUser: "w" | "b",
    userMove: MoveDTO,
    engine: typeof engineState.engine,
    config: PracticeConfig
  ) => {
    if (!engine) {
      return;
    }

    // In practice mode, user plays as white
    // Only analyze user's (white's) moves - turnAfterUser === "b" means white just moved
    const userPlayedWhite = turnAfterUser === "b";

    // Calculate ply: white's moves are odd (1, 3, 5...), black's are even (2, 4, 6...)
    // After white's first move, turnAfterUser is "b", so ply should be 1
    const currentMoveNumber = gameStateRef.current.moveNumber;
    const ply = userPlayedWhite ? (currentMoveNumber - 1) * 2 + 1 : currentMoveNumber * 2;

    try {
      // Only provide coach analysis for user's moves (white)
      if (userPlayedWhite && "analyzeMoveWithCoach" in engine && engine.analyzeMoveWithCoach) {
        const coachResult: AnalyzeMoveResponse = await engine.analyzeMoveWithCoach(
          fenBeforeUser,
          fenAfterUser,
          userMove.san,
          userMove.uci,
          ply
        );

        // Extract best move arrow from PV
        const arrow =
          coachResult.analysis.pv.length > 0
            ? parseUciArrow(coachResult.analysis.pv[0])
            : coachResult.analysis.bestMoveUci
              ? parseUciArrow(coachResult.analysis.bestMoveUci)
              : undefined;

        // Build ghost pieces from PV line
        const ghostPieces = buildGhostLine(fenBeforeUser, coachResult.analysis.pv, 4);

        const nextCoachState: CoachState = {
          classification: coachResult.analysis.classification,
          classificationLabel: coachResult.analysis.classificationLabel,
          explanation: coachResult.coach.explanation,
          bestMoveExplanation: coachResult.coach.bestMoveExplanation,
          tips: coachResult.coach.tips,
          encouragement: coachResult.coach.encouragement,
          centipawnLoss: coachResult.analysis.cpl,
          evalBeforeCP: coachResult.analysis.evalBeforeCP,
          evalAfterCP: coachResult.analysis.evalAfterCP,
          ...(arrow ? { arrow } : {}),
          ...(coachResult.analysis.pv.length > 0 ? { line: coachResult.analysis.pv } : {}),
          ...(ghostPieces.length > 0 ? { ghostPieces } : {})
        };
        setCoachState(nextCoachState);
      } else if (userPlayedWhite) {
        // Fallback to basic engine analysis (only for user's white moves)
        const analysisOptions = {
          timeMs: config.analysisMs,
          multipv: 1,
          skillLevel: config.skillLevel,
          limitStrength: config.limitStrength,
          elo: config.elo
        };
        const afterEval = await engine.analyze(fenAfterUser, analysisOptions);
        const beforeEval = await engine.analyze(fenBeforeUser, analysisOptions);

        const beforeScore = beforeEval[0]?.cp ?? 0;
        const afterScore = afterEval[0]?.cp ?? 0;
        const cpl = Math.max(0, beforeScore - afterScore); // White's perspective

        // Simple classification based on CPL
        let classification = "good";
        let classificationLabel = "Good";
        if (cpl <= 10) {
          classification = "excellent";
          classificationLabel = "Excellent";
        } else if (cpl > 100) {
          classification = "inaccuracy";
          classificationLabel = "Inaccuracy";
        } else if (cpl > 300) {
          classification = "mistake";
          classificationLabel = "Mistake";
        } else if (cpl > 500) {
          classification = "blunder";
          classificationLabel = "Blunder";
        }

        const bestLine = beforeEval[0]?.pv ?? [];
        const arrow = bestLine.length > 0 ? parseUciArrow(bestLine[0]) : undefined;
        const ghostPieces = buildGhostLine(fenBeforeUser, bestLine, 4);

        setCoachState({
          classification,
          classificationLabel,
          explanation: `You played ${userMove.san}. ${cpl <= 10 ? "Great move!" : cpl > 300 ? "There was a better option." : "Solid move."}`,
          tips: [],
          encouragement: cpl <= 50 ? "Keep it up!" : "Stay focused!",
          centipawnLoss: cpl,
          evalBeforeCP: beforeEval[0]?.cp,
          evalAfterCP: afterEval[0]?.cp,
          ...(arrow ? { arrow } : {}),
          ...(bestLine.length > 0 ? { line: bestLine } : {}),
          ...(ghostPieces.length > 0 ? { ghostPieces } : {})
        });
      }
      // No coach feedback for engine's (black's) moves

      // Get engine's response move
      const engineMove = await engine.bestMove(fenAfterUser, {
        timeMs: config.replyMs,
        skillLevel: config.skillLevel,
        limitStrength: config.limitStrength,
        elo: config.elo
      });
      const reply = tryMove(fenAfterUser, engineMove);
      if (reply.ok) {
        await new Promise((resolve) => setTimeout(resolve, OPPONENT_MOVE_DELAY_MS));
        const newState = {
          ...gameStateRef.current,
          fen: reply.fen,
          turn: reply.turn,
          moveNumber: reply.moveNumber
        };
        gameStateRef.current = newState;
        setGameState(newState);
        setMoveHistory((prev: MoveDTO[]) => [...prev, reply.move]);
      }
    } catch (error) {
      console.error("Engine analysis failed:", error);
      updateStatusMessage("Engine analysis failed");
    }
  };

  const handleBoardClick = (event: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let activeInverse = inverseHomography;
    if (!activeInverse && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const defaults = defaultCalibration(rect.width, rect.height);
        setCalibration(defaults);
        const homography = computeHomography(BOARD_POINTS, defaults);
        activeInverse = invertHomography(homography);
      }
    }

    if (!activeInverse) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const square = screenToSquare(activeInverse, point);
    const currentGame = gameStateRef.current;
    if (process.env.NEXT_PUBLIC_DEBUG_INPUT === "true") {
      console.info("[input] click", { x: point.x, y: point.y, square, turn: currentGame.turn });
    }
    if (!square) {
      return;
    }
    setFocusedSquare(square);

    const currentSelection = selectedSquareRef.current;
    if (!currentSelection) {
      const piece = pieceAtSquare(currentGame.fen, square);
      if (piece && isPieceTurn(piece, currentGame.turn)) {
        updateSelectedSquare(square);
      }
      return;
    }

    void attemptMove(currentSelection, square);
  };

  const handleBoardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target && isEditableTarget(target)) {
      return;
    }

    if (event.key === "Escape") {
      updateSelectedSquare(null);
      event.preventDefault();
      return;
    }

    const keyMap: Record<string, { file: number; rank: number }> = {
      ArrowLeft: { file: -1, rank: 0 },
      ArrowRight: { file: 1, rank: 0 },
      ArrowUp: { file: 0, rank: 1 },
      ArrowDown: { file: 0, rank: -1 }
    };

    const delta = keyMap[event.key as keyof typeof keyMap];
    if (delta) {
      const next = shiftSquare(focusedSquare, delta.file, delta.rank);
      if (next) {
        setFocusedSquare(next);
      }
      event.preventDefault();
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      const currentSelection = selectedSquareRef.current;
      const currentGame = gameStateRef.current;
      if (currentSelection) {
        if (currentSelection === focusedSquare) {
          updateSelectedSquare(null);
        } else {
          void attemptMove(currentSelection, focusedSquare);
        }
      } else {
        const piece = pieceAtSquare(currentGame.fen, focusedSquare);
        if (piece && isPieceTurn(piece, currentGame.turn)) {
          updateSelectedSquare(focusedSquare);
        }
      }
      event.preventDefault();
    }
  };

  const handleCalibrationDrag = (index: number, event: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) {
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const next = calibration.map((point, pointIndex) => {
      if (pointIndex !== index) {
        return point;
      }
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
    });
    setCalibration(next);
  };

  const handleCreateGame = async () => {
    const result = await syncAdapterRef.current.createGame();
    setGameId(result.gameId);
    setMode("multiplayer");
  };

  const handleJoinGame = async () => {
    if (!gameIdInput) {
      return;
    }
    await syncAdapterRef.current.joinGame(gameIdInput);
    setGameId(gameIdInput);
    setMode("multiplayer");
  };

  // Voice input for moves
  const handleVoiceMove = async () => {
    if (voice.recordingState === "recording") {
      const move = await voice.stopListening();
      if (move) {
        // Try to parse the move - could be SAN or UCI
        const currentGame = gameStateRef.current;

        // Handle castling
        if (move === "O-O" || move === "O-O-O") {
          const result = tryMove(currentGame.fen, move);
          if (result.ok) {
            const from = currentGame.turn === "w" ? "e1" : "e8";
            const to =
              move === "O-O"
                ? currentGame.turn === "w"
                  ? "g1"
                  : "g8"
                : currentGame.turn === "w"
                  ? "c1"
                  : "c8";
            void attemptMove(from, to);
          }
          return;
        }

        // Try as UCI move (e.g., "e2e4")
        if (move.length >= 4 && /^[a-h][1-8][a-h][1-8]/.test(move)) {
          void attemptMove(move.slice(0, 2), move.slice(2, 4));
          return;
        }

        // Try as SAN piece move (e.g., "Nc3", "Bxe5", "Qd4")
        const sanPieceMatch = move.match(/^([KQRBN])x?([a-h])([1-8])$/);
        if (sanPieceMatch && sanPieceMatch[1] && sanPieceMatch[2] && sanPieceMatch[3]) {
          const pieceType = sanPieceMatch[1];
          const targetSquare = sanPieceMatch[2] + sanPieceMatch[3];

          // Use chess.js to find which piece can make this move
          const chess = new Chess(currentGame.fen);
          const legalMoves = chess.moves({ verbose: true });

          // Find a legal move that matches our SAN
          const matchingMove = legalMoves.find((m) => {
            const isPieceMatch = m.piece.toUpperCase() === pieceType;
            const isTargetMatch = m.to === targetSquare;
            return isPieceMatch && isTargetMatch;
          });

          if (matchingMove) {
            console.info("[Voice] Found matching move:", matchingMove.from, "->", matchingMove.to);
            void attemptMove(matchingMove.from, matchingMove.to);
            return;
          }
        }

        // Try as SAN with disambiguation (e.g., "Nbd2", "R1a3")
        const sanDisambigMatch = move.match(/^([KQRBN])([a-h])?([1-8])?x?([a-h])([1-8])$/);
        if (sanDisambigMatch && sanDisambigMatch[1] && sanDisambigMatch[4] && sanDisambigMatch[5]) {
          const pieceType = sanDisambigMatch[1];
          const disambigFile = sanDisambigMatch[2];
          const disambigRank = sanDisambigMatch[3];
          const targetSquare = sanDisambigMatch[4] + sanDisambigMatch[5];

          const chess = new Chess(currentGame.fen);
          const legalMoves = chess.moves({ verbose: true });

          const matchingMove = legalMoves.find((m) => {
            const isPieceMatch = m.piece.toUpperCase() === pieceType;
            const isTargetMatch = m.to === targetSquare;
            const isFileMatch = !disambigFile || m.from[0] === disambigFile;
            const isRankMatch = !disambigRank || m.from[1] === disambigRank;
            return isPieceMatch && isTargetMatch && isFileMatch && isRankMatch;
          });

          if (matchingMove) {
            console.info(
              "[Voice] Found disambiguated move:",
              matchingMove.from,
              "->",
              matchingMove.to
            );
            void attemptMove(matchingMove.from, matchingMove.to);
            return;
          }
        }

        // Try as square (e.g., "e4" for pawn move)
        if (move.length === 2 && /^[a-h][1-8]$/.test(move)) {
          // Find a pawn that can move to this square
          const targetSquare = move;
          const turn = currentGame.turn;
          const direction = turn === "w" ? 1 : -1;
          const file = move[0] as string;
          const rank = parseInt(move[1] as string);

          // Check one square back
          const fromRank1 = rank - direction;
          if (fromRank1 >= 1 && fromRank1 <= 8) {
            const from1 = `${file}${fromRank1}`;
            const piece = pieceAtSquare(currentGame.fen, from1);
            if (piece && piece.toLowerCase() === "p" && isPieceTurn(piece, turn)) {
              void attemptMove(from1, targetSquare);
              return;
            }
          }

          // Check two squares back (for initial pawn move)
          const fromRank2 = rank - direction * 2;
          const startRank = turn === "w" ? 2 : 7;
          if (fromRank2 === startRank) {
            const from2 = `${file}${fromRank2}`;
            const piece = pieceAtSquare(currentGame.fen, from2);
            if (piece && piece.toLowerCase() === "p" && isPieceTurn(piece, turn)) {
              void attemptMove(from2, targetSquare);
              return;
            }
          }
        }

        // Try as pawn capture (e.g., "exd5")
        const pawnCaptureMatch = move.match(/^([a-h])x([a-h])([1-8])$/);
        if (pawnCaptureMatch && pawnCaptureMatch[1] && pawnCaptureMatch[2] && pawnCaptureMatch[3]) {
          const fromFile = pawnCaptureMatch[1];
          const targetSquare = pawnCaptureMatch[2] + pawnCaptureMatch[3];

          const chess = new Chess(currentGame.fen);
          const legalMoves = chess.moves({ verbose: true });

          const matchingMove = legalMoves.find(
            (m) => m.piece === "p" && m.from[0] === fromFile && m.to === targetSquare && m.captured
          );

          if (matchingMove) {
            console.info("[Voice] Found pawn capture:", matchingMove.from, "->", matchingMove.to);
            void attemptMove(matchingMove.from, matchingMove.to);
            return;
          }
        }

        updateStatusMessage(`Couldn't play: ${move}`);
      }
    } else {
      voice.startListening();
    }
  };

  // Auto-play coach feedback
  useEffect(() => {
    if (voice.autoPlayCoach && coachState?.explanation) {
      const textToSpeak = `${coachState.classificationLabel}. ${coachState.explanation}`;
      voice.speakCoachFeedback(textToSpeak);
    }
  }, [coachState, voice.autoPlayCoach]);

  return (
    <div className="chess-experience">
      {/* Camera Section - Full Width */}
      <div className="camera-section">
        <div className="camera-header">
          <div>
            <h1 className="camera-title">HyperVision AR Chess</h1>
            <p className="camera-subtitle">
              Pinch to move pieces, or click squares for fallback control
            </p>
          </div>
          <div className="camera-actions">
            <button className="btn-calibrate" onClick={() => setIsCalibrating((prev) => !prev)}>
              {isCalibrating ? "✓ Done" : "⊞ Calibrate"}
            </button>
            <button
              className="btn-icon"
              onClick={() => setShowPerfHud((prev) => !prev)}
              title="Performance stats"
            >
              {showPerfHud ? "📊" : "📈"}
            </button>
          </div>
        </div>

        <div
          className="camera-container"
          ref={containerRef}
          onClick={handleBoardClick}
          onKeyDown={handleBoardKeyDown}
          tabIndex={0}
          aria-label="Chess board"
        >
          <video ref={videoRef} className="camera-video mirrored" playsInline muted />
          <canvas ref={canvasRef} className="camera-canvas" />
          <PerfHud
            fps={gestureState.fps}
            latencyMs={gestureState.latencyMs}
            visible={showPerfHud}
          />
          {isCalibrating && (
            <div className="calibration-overlay">
              {calibration.map((point, index) => (
                <div
                  key={`corner-${index}`}
                  className="calibration-handle"
                  style={{ left: point.x - 10, top: point.y - 10 }}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (event.buttons === 1) {
                      handleCalibrationDrag(index, event);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Controls Bar */}
        <div className="controls-bar">
          <div className="control-group">
            <span className="control-label">Mode</span>
            <div className="pill-group">
              <button
                className={`pill ${mode === "local" ? "active" : ""}`}
                onClick={() => setMode("local")}
              >
                Local
              </button>
              <button
                className={`pill ${mode === "practice" ? "active" : ""}`}
                onClick={() => setMode("practice")}
              >
                Practice
              </button>
            </div>
          </div>

          {mode === "practice" && (
            <div className="control-group">
              <span className="control-label">Difficulty</span>
              <div className="pill-group">
                {(Object.keys(PRACTICE_LEVELS) as PracticeLevel[]).map((level) => (
                  <button
                    key={level}
                    className={`pill ${practiceLevel === level ? "active" : ""}`}
                    onClick={() => setPracticeLevel(level)}
                  >
                    {PRACTICE_LEVELS[level].label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="control-group">
            <span className="control-label">Status</span>
            <div className="status-indicators">
              <span className={`status-dot ${cameraState.status === "ready" ? "online" : ""}`} />
              <span className="status-text">Camera</span>
              <span className={`status-dot ${engineState.ready ? "online" : ""}`} />
              <span className="status-text">Engine</span>
            </div>
          </div>
        </div>
      </div>

      {/* Side Panel */}
      <div className="side-panel">
        {/* Multiplayer */}
        <div className="panel-section">
          <h3 className="panel-title">Multiplayer</h3>
          <div className="multiplayer-controls">
            <div className="join-row">
              <input
                className="input-game-id"
                placeholder="Game ID"
                value={gameIdInput}
                onChange={(event) => setGameIdInput(event.target.value)}
              />
              <button className="btn-join" onClick={handleJoinGame}>
                Join
              </button>
            </div>
            <button className="btn-create" onClick={handleCreateGame}>
              + Create Game
            </button>
            {gameId && <div className="game-info">Playing: {gameId}</div>}
            <div className="sync-status">
              <span className={`sync-dot ${syncStatus === "synced" ? "synced" : ""}`} />
              {syncStatus}
            </div>
          </div>
        </div>

        {/* Voice Input */}
        {voice.hasApiKey && (
          <div className="panel-section voice-panel">
            <h3 className="panel-title">Voice Input</h3>
            <div className="voice-controls">
              <button
                className={`voice-btn ${voice.recordingState === "recording" ? "recording" : ""} ${voice.recordingState === "processing" ? "processing" : ""}`}
                onClick={handleVoiceMove}
                disabled={voice.recordingState === "processing"}
              >
                {voice.recordingState === "idle" && "🎤 Say Move"}
                {voice.recordingState === "recording" && "⏹️ Stop"}
                {voice.recordingState === "processing" && "⏳ Processing..."}
              </button>
              {voice.lastTranscript && (
                <div className="voice-transcript">
                  Heard: "{voice.lastTranscript}"
                  {voice.lastParsedMove && (
                    <span className="voice-parsed"> → {voice.lastParsedMove}</span>
                  )}
                </div>
              )}
              {voice.inputError && <div className="voice-error">{voice.inputError}</div>}
            </div>
          </div>
        )}

        {/* Coach Feedback */}
        {mode === "practice" && (
          <div className="panel-section coach-panel">
            <div className="coach-title-row">
              <h3 className="panel-title">Coach Feedback</h3>
              <div className="coach-voice-controls">
                <button
                  className={`coach-voice-toggle ${voice.autoPlayCoach ? "active" : ""}`}
                  onClick={voice.toggleAutoPlay}
                  title={voice.autoPlayCoach ? "Auto-play ON" : "Auto-play OFF"}
                >
                  {voice.autoPlayCoach ? "🔊" : "🔇"}
                </button>
              </div>
            </div>
            {coachState ? (
              <div className={`coach-card coach-${coachState.classification}`}>
                <div className="coach-header">
                  <span className={`coach-badge ${coachState.classification}`}>
                    {coachState.classificationLabel}
                  </span>
                  <div className="coach-header-right">
                    <span className="coach-cpl">
                      {coachState.centipawnLoss > 0 ? `−${coachState.centipawnLoss}` : "±0"}
                    </span>
                    {voice.hasApiKey && (
                      <button
                        className={`coach-speak-btn ${voice.isSpeaking ? "speaking" : ""}`}
                        onClick={() => {
                          if (voice.isSpeaking) {
                            voice.stopSpeaking();
                          } else {
                            voice.speakCoachFeedback(
                              `${coachState.classificationLabel}. ${coachState.explanation}`
                            );
                          }
                        }}
                        title={voice.isSpeaking ? "Stop" : "Play feedback"}
                      >
                        {voice.isSpeaking ? "⏹️" : "▶️"}
                      </button>
                    )}
                  </div>
                </div>

                <div className="coach-explanation">{coachState.explanation}</div>

                {coachState.bestMoveExplanation && (
                  <div className="coach-best-move">
                    <strong>Better:</strong> {coachState.bestMoveExplanation}
                  </div>
                )}

                {coachState.tips && coachState.tips.length > 0 && (
                  <div className="coach-tips">
                    {coachState.tips.map((tip, i) => (
                      <span key={i} className="coach-tip">
                        💡 {tip}
                      </span>
                    ))}
                  </div>
                )}

                <div className="coach-encouragement">{coachState.encouragement}</div>

                {coachState.line && coachState.line.length > 0 && (
                  <div className="coach-line">
                    <span className="line-label">Best line:</span>
                    <span className="line-moves">{coachState.line.slice(0, 4).join(" → ")}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="coach-empty">Make a move to get feedback</p>
            )}
          </div>
        )}

        {/* Move History */}
        <div className="panel-section moves-panel">
          <h3 className="panel-title">Moves</h3>
          <div className="move-list">
            {moveHistory.length === 0 ? (
              <span className="move-empty">No moves yet</span>
            ) : (
              moveHistory.map((move, index) => {
                const isWhiteMove = index % 2 === 0;
                const isLastMove = index === moveHistory.length - 1;
                const isSecondLastMove = index === moveHistory.length - 2;
                const isRecentMove = isLastMove || isSecondLastMove;
                return (
                  <span
                    key={`${move.uci}-${index}`}
                    className={`move-item ${isRecentMove ? "recent" : ""} ${isLastMove ? "last" : ""}`}
                    title={`${move.uci}`}
                  >
                    {isWhiteMove && (
                      <span className="move-number">{Math.floor(index / 2) + 1}.</span>
                    )}
                    <span className={`move-san ${isWhiteMove ? "white" : "black"}`}>
                      {move.san}
                    </span>
                  </span>
                );
              })
            )}
          </div>
          {moveHistory.length > 0 && (
            <div className="move-summary">
              <span className="move-count">{moveHistory.length} moves</span>
              <span className="turn-indicator">
                {gameState.turn === "w" ? "White to move" : "Black to move"}
              </span>
            </div>
          )}
        </div>

        {/* Debug */}
        <details className="debug-section">
          <summary>Debug Info</summary>
          <div className="debug-content">
            <code>{gameState.fen}</code>
            <span>v{gameState.version}</span>
          </div>
        </details>

        {statusMessage && <div className="error-message">{statusMessage}</div>}
      </div>

      <style jsx>{`
        .chess-experience {
          display: grid;
          grid-template-columns: 1fr 320px;
          gap: 24px;
          max-width: 1400px;
          margin: 0 auto;
        }

        @media (max-width: 1000px) {
          .chess-experience {
            grid-template-columns: 1fr;
          }
        }

        /* Camera Section */
        .camera-section {
          background: rgba(20, 20, 22, 0.95);
          border-radius: 20px;
          overflow: hidden;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }

        .camera-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.08) 0%, transparent 100%);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .camera-title {
          font-family: var(--font-display);
          font-size: 1.5rem;
          color: #fff;
          margin: 0;
        }

        .camera-subtitle {
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.5);
          margin: 4px 0 0;
        }

        .camera-actions {
          display: flex;
          gap: 8px;
        }

        .btn-calibrate {
          background: var(--color-ember);
          color: white;
          border: none;
          padding: 10px 16px;
          border-radius: 10px;
          font-weight: 500;
          cursor: pointer;
          transition:
            transform 0.15s,
            background 0.15s;
        }

        .btn-calibrate:hover {
          background: #d14a25;
          transform: translateY(-1px);
        }

        .btn-icon {
          background: rgba(255, 255, 255, 0.1);
          border: none;
          width: 40px;
          height: 40px;
          border-radius: 10px;
          font-size: 1.1rem;
          cursor: pointer;
          transition: background 0.15s;
        }

        .btn-icon:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        .camera-container {
          position: relative;
          aspect-ratio: 4 / 3;
          min-height: 480px;
          cursor: pointer;
          background: #000;
        }

        .camera-video {
          width: 100%;
          height: 100%;
          object-fit: contain;
          background: #0a0a0a;
        }

        .camera-video.mirrored {
          transform: scaleX(-1);
        }

        .camera-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          transform: scaleX(-1);
        }

        .calibration-overlay {
          position: absolute;
          inset: 0;
        }

        .calibration-handle {
          position: absolute;
          width: 20px;
          height: 20px;
          background: var(--color-ember);
          border: 3px solid white;
          border-radius: 50%;
          cursor: grab;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
          transition: transform 0.1s;
        }

        .calibration-handle:active {
          cursor: grabbing;
          transform: scale(1.2);
        }

        /* Controls Bar */
        .controls-bar {
          display: flex;
          flex-wrap: wrap;
          gap: 20px;
          padding: 16px 20px;
          background: rgba(255, 255, 255, 0.03);
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }

        .control-group {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .control-label {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: rgba(255, 255, 255, 0.4);
        }

        .pill-group {
          display: flex;
          gap: 4px;
          background: rgba(255, 255, 255, 0.05);
          padding: 3px;
          border-radius: 10px;
        }

        .pill {
          background: transparent;
          border: none;
          color: rgba(255, 255, 255, 0.6);
          padding: 6px 12px;
          border-radius: 8px;
          font-size: 0.85rem;
          cursor: pointer;
          transition: all 0.15s;
        }

        .pill:hover {
          color: rgba(255, 255, 255, 0.9);
        }

        .pill.active {
          background: var(--color-ember);
          color: white;
        }

        .status-indicators {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.2);
        }

        .status-dot.online {
          background: #22c55e;
          box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
        }

        .status-text {
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.5);
          margin-right: 8px;
        }

        /* Side Panel */
        .side-panel {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .panel-section {
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(8px);
          border-radius: 16px;
          padding: 16px;
          border: 1px solid rgba(0, 0, 0, 0.08);
        }

        .panel-title {
          font-family: var(--font-display);
          font-size: 1.1rem;
          margin: 0 0 12px;
          color: var(--color-slate);
        }

        /* Multiplayer */
        .multiplayer-controls {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .join-row {
          display: flex;
          gap: 8px;
        }

        .input-game-id {
          flex: 1;
          padding: 10px 12px;
          border: 1px solid rgba(0, 0, 0, 0.15);
          border-radius: 10px;
          font-size: 0.9rem;
          background: white;
        }

        .btn-join {
          background: var(--color-moss);
          color: white;
          border: none;
          padding: 10px 16px;
          border-radius: 10px;
          font-weight: 500;
          cursor: pointer;
        }

        .btn-create {
          background: var(--color-slate);
          color: white;
          border: none;
          padding: 12px;
          border-radius: 10px;
          font-weight: 500;
          cursor: pointer;
        }

        .game-info {
          font-size: 0.8rem;
          color: var(--color-moss);
          font-weight: 500;
        }

        .sync-status {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.75rem;
          color: #666;
        }

        .sync-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #ccc;
        }

        .sync-dot.synced {
          background: #22c55e;
        }

        /* Voice Input */
        .voice-panel {
          background: rgba(30, 30, 35, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .voice-panel .panel-title {
          color: #fff;
        }

        .voice-controls {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .voice-btn {
          background: var(--color-ember);
          color: white;
          border: none;
          padding: 12px 16px;
          border-radius: 10px;
          font-weight: 600;
          font-size: 0.9rem;
          cursor: pointer;
          transition: all 0.15s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .voice-btn:hover {
          background: #d14a25;
          transform: translateY(-1px);
        }

        .voice-btn.recording {
          background: #dc2626;
          animation: pulse 1.5s infinite;
        }

        .voice-btn.processing {
          background: #666;
          cursor: wait;
        }

        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
        }

        .voice-transcript {
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.7);
          padding: 8px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 6px;
        }

        .voice-parsed {
          color: #96bc4b;
          font-weight: 600;
        }

        .voice-error {
          font-size: 0.8rem;
          color: #f87171;
          padding: 8px;
          background: rgba(248, 113, 113, 0.1);
          border-radius: 6px;
        }

        /* Coach Feedback - Magnus AI Style */
        .coach-panel {
          background: rgba(30, 30, 35, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .coach-panel .panel-title {
          color: #fff;
          margin: 0;
        }

        .coach-title-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .coach-voice-controls {
          display: flex;
          gap: 4px;
        }

        .coach-voice-toggle {
          background: rgba(255, 255, 255, 0.1);
          border: none;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.15s;
        }

        .coach-voice-toggle:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        .coach-voice-toggle.active {
          background: var(--color-ember);
        }

        .coach-header-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .coach-speak-btn {
          background: rgba(255, 255, 255, 0.15);
          border: none;
          width: 28px;
          height: 28px;
          border-radius: 6px;
          font-size: 0.85rem;
          cursor: pointer;
          transition: all 0.15s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .coach-speak-btn:hover {
          background: rgba(255, 255, 255, 0.25);
        }

        .coach-speak-btn.speaking {
          background: var(--color-ember);
          animation: pulse 1s infinite;
        }

        .coach-card {
          border-radius: 12px;
          padding: 14px;
          transition: all 0.2s;
        }

        .coach-card.coach-best,
        .coach-card.coach-excellent {
          background: linear-gradient(
            135deg,
            rgba(150, 188, 75, 0.15) 0%,
            rgba(150, 188, 75, 0.08) 100%
          );
          border: 1px solid rgba(150, 188, 75, 0.3);
        }

        .coach-card.coach-good,
        .coach-card.coach-book {
          background: linear-gradient(
            135deg,
            rgba(139, 195, 74, 0.12) 0%,
            rgba(139, 195, 74, 0.06) 100%
          );
          border: 1px solid rgba(139, 195, 74, 0.25);
        }

        .coach-card.coach-inaccuracy {
          background: linear-gradient(
            135deg,
            rgba(240, 173, 78, 0.15) 0%,
            rgba(240, 173, 78, 0.08) 100%
          );
          border: 1px solid rgba(240, 173, 78, 0.3);
        }

        .coach-card.coach-mistake {
          background: linear-gradient(
            135deg,
            rgba(230, 126, 34, 0.15) 0%,
            rgba(230, 126, 34, 0.08) 100%
          );
          border: 1px solid rgba(230, 126, 34, 0.3);
        }

        .coach-card.coach-blunder {
          background: linear-gradient(
            135deg,
            rgba(231, 76, 60, 0.15) 0%,
            rgba(231, 76, 60, 0.08) 100%
          );
          border: 1px solid rgba(231, 76, 60, 0.3);
        }

        .coach-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }

        .coach-badge {
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 4px 10px;
          border-radius: 20px;
        }

        .coach-badge.best,
        .coach-badge.excellent {
          background: #96bc4b;
          color: #1a1a1a;
        }

        .coach-badge.good,
        .coach-badge.book {
          background: #8bc34a;
          color: #1a1a1a;
        }

        .coach-badge.inaccuracy {
          background: #f0ad4e;
          color: #1a1a1a;
        }

        .coach-badge.mistake {
          background: #e67e22;
          color: white;
        }

        .coach-badge.blunder {
          background: #e74c3c;
          color: white;
        }

        .coach-cpl {
          font-family: "SF Mono", "Consolas", monospace;
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.6);
        }

        .coach-explanation {
          font-size: 0.9rem;
          color: rgba(255, 255, 255, 0.9);
          line-height: 1.5;
        }

        .coach-best-move {
          margin-top: 10px;
          padding: 10px;
          background: rgba(150, 188, 75, 0.1);
          border-radius: 8px;
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.8);
        }

        .coach-best-move strong {
          color: #96bc4b;
        }

        .coach-tips {
          margin-top: 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .coach-tip {
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.7);
          padding: 6px 10px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 6px;
        }

        .coach-encouragement {
          margin-top: 10px;
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.6);
          font-style: italic;
        }

        .coach-line {
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          font-size: 0.8rem;
        }

        .line-label {
          color: rgba(255, 255, 255, 0.5);
          margin-right: 8px;
        }

        .line-moves {
          font-family: "SF Mono", "Consolas", monospace;
          color: rgba(255, 255, 255, 0.7);
        }

        .coach-empty {
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.5);
          margin: 0;
        }

        /* Move List */
        .moves-panel {
          max-height: 200px;
          overflow-y: auto;
        }

        .move-list {
          display: flex;
          flex-wrap: wrap;
          gap: 4px 10px;
          font-family: "SF Mono", "Consolas", monospace;
          font-size: 0.85rem;
          line-height: 1.6;
        }

        .move-empty {
          color: #888;
          font-family: var(--font-sans);
          font-style: italic;
        }

        .move-item {
          display: inline-flex;
          align-items: baseline;
          gap: 3px;
          padding: 2px 0;
          transition: background 0.15s;
        }

        .move-item.recent {
          background: rgba(229, 84, 43, 0.08);
          border-radius: 4px;
          padding: 2px 4px;
          margin: -2px -4px;
        }

        .move-item.last {
          background: rgba(229, 84, 43, 0.15);
          font-weight: 600;
        }

        .move-number {
          color: #888;
          font-size: 0.75rem;
        }

        .move-san {
          color: #1a1a1a;
        }

        .move-san.white {
          color: #1a1a1a;
        }

        .move-san.black {
          color: #444;
        }

        .move-summary {
          display: flex;
          justify-content: space-between;
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid rgba(0, 0, 0, 0.1);
          font-size: 0.75rem;
        }

        .move-count {
          color: #666;
        }

        .turn-indicator {
          font-weight: 600;
          color: var(--color-ember);
        }

        /* Debug */
        .debug-section {
          background: rgba(255, 255, 255, 0.6);
          border-radius: 12px;
          padding: 12px;
          font-size: 0.75rem;
          color: #666;
        }

        .debug-section summary {
          cursor: pointer;
          user-select: none;
        }

        .debug-content {
          margin-top: 8px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .debug-content code {
          font-size: 0.7rem;
          word-break: break-all;
          background: rgba(0, 0, 0, 0.05);
          padding: 6px;
          border-radius: 6px;
        }

        /* Error */
        .error-message {
          background: #fef2f2;
          color: #dc2626;
          padding: 12px;
          border-radius: 12px;
          font-size: 0.85rem;
        }
      `}</style>
    </div>
  );
}

function pieceAtSquare(fen: string, square: string): string | null {
  const [placement] = fen.split(" ");
  if (!placement) {
    return null;
  }
  const rows = placement.split("/");
  const fileIndex = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const rowIndex = 8 - rank;
  const row = rows[rowIndex];
  if (!row) {
    return null;
  }

  let file = 0;
  for (const char of row) {
    const count = Number(char);
    if (Number.isNaN(count)) {
      if (file === fileIndex) {
        return char;
      }
      file += 1;
    } else {
      file += count;
    }
  }
  return null;
}

function isPieceTurn(piece: string, turn: "w" | "b"): boolean {
  const isWhite = piece === piece.toUpperCase();
  return (isWhite && turn === "w") || (!isWhite && turn === "b");
}

function getDraggingPiece(fen: string, state: InteractionState) {
  if (state.status !== "dragging" && state.status !== "release" && state.status !== "confirm") {
    return undefined;
  }
  const piece = pieceAtSquare(fen, state.fromSquare);
  if (!piece) {
    return undefined;
  }
  return {
    piece,
    cursor: state.cursor
  };
}

function buildGhostLine(fen: string, pv: string[], maxPlies: number): GhostPiece[] {
  let currentFen = fen;
  const ghosts: GhostPiece[] = [];
  let applied = 0;

  for (const uci of pv) {
    if (applied >= maxPlies) {
      break;
    }
    if (uci.length < 4) {
      continue;
    }
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const piece = pieceAtSquare(currentFen, from);
    if (piece) {
      ghosts.push({ piece, square: to });
    }
    const result = tryMove(currentFen, uci);
    if (!result.ok) {
      break;
    }
    currentFen = result.fen;
    applied += 1;
  }

  return ghosts;
}

function parseUciArrow(uci?: string) {
  if (!uci || uci.length < 4) {
    return undefined;
  }
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}

const BOARD_FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

function shiftSquare(square: string, fileDelta: number, rankDelta: number): string | null {
  if (square.length !== 2) {
    return null;
  }
  const fileIndex = BOARD_FILES.indexOf(square[0] as (typeof BOARD_FILES)[number]);
  const rank = Number(square[1]);
  if (fileIndex < 0 || Number.isNaN(rank)) {
    return null;
  }
  const nextFile = Math.min(7, Math.max(0, fileIndex + fileDelta));
  const nextRank = Math.min(8, Math.max(1, rank + rankDelta));
  return `${BOARD_FILES[nextFile]}${nextRank}`;
}

function isEditableTarget(target: HTMLElement): boolean {
  const tag = target.tagName;
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
