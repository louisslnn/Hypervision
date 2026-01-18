import {
  ChessEngine,
  EngineAnalyzeOptions,
  EngineEval,
  EngineMoveOptions,
  EngineSkillOptions
} from "../ChessEngine";

type StockfishWorker = {
  postMessage: (message: string) => void;
  onmessage?: (event: { data: string }) => void;
  terminate?: () => void;
};

type StockfishFactory = () => StockfishWorker;

type PendingRequest<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  startedAt: number;
  evaluations: Map<number, EngineEval>;
  mode: "analyze" | "bestmove";
};

export class StockfishWasmAdapter implements ChessEngine {
  private engine: StockfishWorker | null = null;
  private pending: PendingRequest<EngineEval[]> | PendingRequest<string> | null = null;
  private skillOptions: Required<EngineSkillOptions> = {
    skillLevel: 20,
    limitStrength: false,
    elo: 0
  };

  async init(): Promise<void> {
    if (this.engine) {
      return;
    }
    // Explicit build path avoids missing stockfish.js entry in the current package version.
    const module = await import("stockfish/src/stockfish-17.1-lite-single-03e3232.js");
    const Stockfish = (module.default ?? module) as StockfishFactory;
    const engine = Stockfish();
    this.engine = engine;

    await new Promise<void>((resolve, reject) => {
      let ready = false;
      engine.onmessage = (event) => {
        if (typeof event.data !== "string") {
          return;
        }
        if (event.data === "readyok") {
          ready = true;
          resolve();
        }
      };

      engine.postMessage("uci");
      engine.postMessage("isready");

      setTimeout(() => {
        if (!ready) {
          reject(new Error("Stockfish init timeout"));
        }
      }, 4000);
    });
  }

  async analyze(fen: string, opts: EngineAnalyzeOptions): Promise<EngineEval[]> {
    this.ensureIdle();
    const engine = this.ensureEngine();

    this.applySkillOptions(engine, opts);
    const multipv = opts.multipv ?? 1;
    engine.postMessage(`setoption name MultiPV value ${multipv}`);
    engine.postMessage(`position fen ${fen}`);

    const evaluations = new Map<number, EngineEval>();

    return new Promise<EngineEval[]>((resolve, reject) => {
      const pending: PendingRequest<EngineEval[]> = {
        resolve,
        reject,
        startedAt: Date.now(),
        evaluations,
        mode: "analyze"
      };
      this.pending = pending;

      engine.onmessage = (event) => this.handleMessage(event.data);
      engine.postMessage(`go movetime ${opts.timeMs}`);
    });
  }

  async bestMove(fen: string, opts: EngineMoveOptions): Promise<string> {
    this.ensureIdle();
    const engine = this.ensureEngine();

    this.applySkillOptions(engine, opts);
    engine.postMessage("setoption name MultiPV value 1");
    engine.postMessage(`position fen ${fen}`);

    return new Promise<string>((resolve, reject) => {
      const pending: PendingRequest<string> = {
        resolve,
        reject,
        startedAt: Date.now(),
        evaluations: new Map(),
        mode: "bestmove"
      };
      this.pending = pending;

      engine.onmessage = (event) => this.handleMessage(event.data);
      engine.postMessage(`go movetime ${opts.timeMs}`);
    });
  }

  async terminate(): Promise<void> {
    this.engine?.terminate?.();
    this.engine = null;
    this.pending = null;
  }

  private handleMessage(message: string): void {
    if (!this.pending) {
      return;
    }

    if (message.startsWith("info")) {
      const info = parseInfoLine(message, this.pending.startedAt);
      if (info) {
        const index = info.multipv ?? 1;
        this.pending.evaluations.set(index, info.eval);
      }
      return;
    }

    if (message.startsWith("bestmove")) {
      const best = message.split(" ")[1] ?? "";
      const pending = this.pending;
      this.pending = null;

      if (pending.mode === "analyze") {
        const evaluations = Array.from(pending.evaluations.entries())
          .sort(([a], [b]) => a - b)
          .map(([, evalResult]) => evalResult);
        (pending as PendingRequest<EngineEval[]>).resolve(evaluations);
        return;
      }

      (pending as PendingRequest<string>).resolve(best);
    }
  }

  private ensureEngine(): StockfishWorker {
    if (!this.engine) {
      throw new Error("Stockfish engine not initialized");
    }
    return this.engine;
  }

  private ensureIdle(): void {
    if (this.pending) {
      throw new Error("Engine is busy");
    }
  }

  private applySkillOptions(engine: StockfishWorker, opts: EngineSkillOptions): void {
    const normalized = normalizeSkillOptions(opts);

    if (normalized.skillLevel !== this.skillOptions.skillLevel) {
      engine.postMessage(`setoption name Skill Level value ${normalized.skillLevel}`);
      this.skillOptions.skillLevel = normalized.skillLevel;
    }

    if (normalized.limitStrength !== this.skillOptions.limitStrength) {
      engine.postMessage(
        `setoption name UCI_LimitStrength value ${normalized.limitStrength ? "true" : "false"}`
      );
      this.skillOptions.limitStrength = normalized.limitStrength;
    }

    if (normalized.limitStrength && normalized.elo !== this.skillOptions.elo) {
      engine.postMessage(`setoption name UCI_Elo value ${normalized.elo}`);
    }
    this.skillOptions.elo = normalized.elo;
  }
}

type ParsedInfo = {
  multipv?: number;
  eval: EngineEval;
};

function parseInfoLine(message: string, startedAt: number): ParsedInfo | null {
  const parts = message.split(" ");
  const multipvIndex = parts.indexOf("multipv");
  const scoreIndex = parts.indexOf("score");
  const pvIndex = parts.indexOf("pv");
  const depthIndex = parts.indexOf("depth");

  const multipv = multipvIndex > -1 ? Number(parts[multipvIndex + 1]) : undefined;
  const depth = depthIndex > -1 ? Number(parts[depthIndex + 1]) : undefined;

  let cp: number | undefined;
  let mate: number | undefined;
  if (scoreIndex > -1) {
    const scoreType = parts[scoreIndex + 1];
    const scoreValue = Number(parts[scoreIndex + 2]);
    if (scoreType === "cp") {
      cp = scoreValue;
    }
    if (scoreType === "mate") {
      mate = scoreValue;
    }
  }

  const pvMoves = pvIndex > -1 ? parts.slice(pvIndex + 1) : [];

  if (!depth && cp === undefined && mate === undefined) {
    return null;
  }

  const evalParams: {
    depth?: number;
    cp?: number;
    mate?: number;
    pv: string[];
    startedAt: number;
  } = { pv: pvMoves, startedAt };

  if (depth !== undefined) {
    evalParams.depth = depth;
  }
  if (cp !== undefined) {
    evalParams.cp = cp;
  }
  if (mate !== undefined) {
    evalParams.mate = mate;
  }

  const info: ParsedInfo = { eval: buildEval(evalParams) };
  if (multipv !== undefined) {
    info.multipv = multipv;
  }

  return info;
}

function buildEval(params: {
  depth?: number;
  cp?: number;
  mate?: number;
  pv: string[];
  startedAt: number;
}): EngineEval {
  const base: EngineEval = {
    timeMs: Math.max(0, Date.now() - params.startedAt),
    pv: params.pv
  };

  if (params.depth !== undefined) {
    base.depth = params.depth;
  }
  if (params.cp !== undefined) {
    base.cp = params.cp;
  }
  if (params.mate !== undefined) {
    base.mate = params.mate;
  }

  return base;
}

function normalizeSkillOptions(opts: EngineSkillOptions): Required<EngineSkillOptions> {
  const skillRaw = opts.skillLevel ?? 20;
  const skillLevel = Math.max(0, Math.min(20, Math.round(skillRaw)));
  const limitStrength = opts.limitStrength ?? opts.elo !== undefined;
  const eloRaw = opts.elo ?? 0;
  const elo = Math.max(0, Math.round(eloRaw));
  return { skillLevel, limitStrength, elo };
}
