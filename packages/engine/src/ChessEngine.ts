export type EngineEval = {
  depth?: number;
  timeMs: number;
  cp?: number;
  mate?: number;
  pv: string[];
};

export type EngineSkillOptions = {
  skillLevel?: number;
  limitStrength?: boolean;
  elo?: number;
};

export type EngineAnalyzeOptions = EngineSkillOptions & {
  timeMs: number;
  multipv?: number;
};

export type EngineMoveOptions = EngineSkillOptions & {
  timeMs: number;
};

export interface ChessEngine {
  init(): Promise<void>;
  analyze(fen: string, opts: EngineAnalyzeOptions): Promise<EngineEval[]>;
  bestMove(fen: string, opts: EngineMoveOptions): Promise<string>;
  terminate(): Promise<void>;
}
