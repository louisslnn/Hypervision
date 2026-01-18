import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  db: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const syncRunSchema = z.object({
  id: z.number().int(),
  status: z.string(),
  player_username: z.string().nullable(),
  sync_version: z.string(),
  archives_total: z.number().int(),
  months_fetched: z.number().int(),
  months_not_modified: z.number().int(),
  games_upserted: z.number().int(),
  games_skipped: z.number().int(),
  error_message: z.string().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});

export type SyncRun = z.infer<typeof syncRunSchema>;

export const syncStatusSchema = z.object({
  status: z.string(),
  last_run: syncRunSchema.nullable(),
});

export type SyncStatus = z.infer<typeof syncStatusSchema>;

export const gameSchema = z.object({
  id: z.number().int(),
  uuid: z.string(),
  chesscom_url: z.string(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  time_control: z.string().nullable(),
  time_class: z.string().nullable(),
  rated: z.boolean().nullable(),
  rules: z.string().nullable(),
  white_username: z.string().nullable(),
  black_username: z.string().nullable(),
  white_rating_post: z.number().int().nullable(),
  black_rating_post: z.number().int().nullable(),
  result_white: z.string().nullable(),
  result_black: z.string().nullable(),
  eco_url: z.string().nullable(),
  created_at: z.string(),
});

export type Game = z.infer<typeof gameSchema>;

export const gamePgnSchema = z.object({
  game_id: z.number().int(),
  pgn: z.string(),
});

export type GamePgnResponse = z.infer<typeof gamePgnSchema>;

export const moveSchema = z.object({
  id: z.number().int(),
  game_id: z.number().int(),
  ply: z.number().int(),
  move_san: z.string(),
  move_uci: z.string(),
  fen_before: z.string(),
  fen_after: z.string(),
  is_check: z.boolean(),
  is_mate: z.boolean(),
  capture_piece: z.string().nullable(),
  promotion: z.string().nullable(),
  clock_remaining_ms: z.number().int().nullable(),
  time_spent_ms: z.number().int().nullable(),
  created_at: z.string(),
});

export type Move = z.infer<typeof moveSchema>;

export const gameParseResponseSchema = z.object({
  status: z.string(),
  moves_created: z.number().int(),
  moves_existing: z.number().int(),
});

export type GameParseResponse = z.infer<typeof gameParseResponseSchema>;

export const evaluationSchema = z.object({
  eval_cp: z.number().int().nullable(),
  eval_mate: z.number().int().nullable(),
});

export type Evaluation = z.infer<typeof evaluationSchema>;

export const analyzeGameResponseSchema = z.object({
  status: z.string(),
  analysis_version: z.string(),
  engine_name: z.string(),
  engine_version: z.string(),
  analysis_depth: z.number().int(),
  analysis_time_ms: z.number().int(),
  analysis_multipv: z.number().int(),
  moves_analyzed: z.number().int(),
  moves_skipped: z.number().int(),
});

export type AnalyzeGameResponse = z.infer<typeof analyzeGameResponseSchema>;

export const analyzeAllResponseSchema = z.object({
  status: z.string(),
  player_username: z.string(),
  analysis_version: z.string(),
  engine_name: z.string(),
  engine_version: z.string(),
  analysis_depth: z.number().int(),
  analysis_time_ms: z.number().int(),
  analysis_multipv: z.number().int(),
  games_total: z.number().int(),
  games_analyzed: z.number().int(),
  games_skipped: z.number().int(),
  games_failed: z.number().int(),
  moves_analyzed: z.number().int(),
  moves_skipped: z.number().int(),
});

export type AnalyzeAllResponse = z.infer<typeof analyzeAllResponseSchema>;

export const criticalMomentSchema = z.object({
  move_id: z.number().int(),
  ply: z.number().int(),
  move_san: z.string(),
  fen_before: z.string(),
  cpl: z.number().int().nullable(),
  classification: z.string(),
  best_move_uci: z.string().nullable(),
  eval_before: evaluationSchema,
  eval_after: evaluationSchema,
});

export type CriticalMoment = z.infer<typeof criticalMomentSchema>;

export const gameAnalysisResponseSchema = z.object({
  status: z.string(),
  analysis_version: z.string(),
  engine_name: z.string(),
  engine_version: z.string(),
  analysis_depth: z.number().int(),
  analysis_time_ms: z.number().int(),
  analysis_multipv: z.number().int(),
  move_count: z.number().int(),
  critical_moments: z.array(criticalMomentSchema),
});

export type GameAnalysisResponse = z.infer<typeof gameAnalysisResponseSchema>;

export const analysisSeriesPointSchema = z.object({
  move_id: z.number().int(),
  ply: z.number().int(),
  move_san: z.string(),
  move_uci: z.string(),
  fen_before: z.string(),
  fen_after: z.string(),
  eval_before: evaluationSchema,
  eval_after: evaluationSchema,
  cpl: z.number().int().nullable(),
  classification: z.string(),
  best_move_uci: z.string().nullable(),
  clock_remaining_ms: z.number().int().nullable(),
  time_spent_ms: z.number().int().nullable(),
});

export const gameAnalysisSeriesSchema = z.object({
  status: z.string(),
  analysis_version: z.string(),
  series: z.array(analysisSeriesPointSchema),
});

export type GameAnalysisSeriesResponse = z.infer<typeof gameAnalysisSeriesSchema>;

export const moveAnalysisSchema = z.object({
  id: z.number().int(),
  move_id: z.number().int(),
  analysis_version: z.string(),
  eval_before: evaluationSchema,
  eval_after: evaluationSchema,
  cpl: z.number().int().nullable(),
  best_move_uci: z.string().nullable(),
  best_eval: evaluationSchema,
  classification: z.string(),
  tags: z.array(z.string()),
  created_at: z.string(),
});

export type MoveAnalysis = z.infer<typeof moveAnalysisSchema>;

export const coachEvidenceSchema = z.object({
  best_move_uci: z.string().nullable(),
  eval_before_cp: z.number().int().nullable(),
  eval_before_mate: z.number().int().nullable(),
  eval_after_cp: z.number().int().nullable(),
  eval_after_mate: z.number().int().nullable(),
});

export const coachCriticalMomentSchema = z.object({
  move_id: z.number().int(),
  ply: z.number().int(),
  fen_hash: z.string(),
  move_san: z.string(),
  classification: z.string(),
  cpl: z.number().int().nullable(),
  explanation: z.string(),
  evidence: coachEvidenceSchema,
  what_to_train: z.array(z.string()),
});

export const coachPhaseAdviceSchema = z.object({
  opening: z.array(z.string()),
  middlegame: z.array(z.string()),
  endgame: z.array(z.string()),
});

export const coachTrainingItemSchema = z.object({
  title: z.string(),
  description: z.string(),
  focus_tags: z.array(z.string()),
  related_move_ids: z.array(z.number().int()),
  time_estimate_min: z.number().int(),
});

export const coachReportSchema = z.object({
  summary: z.array(z.string()),
  phase_advice: coachPhaseAdviceSchema,
  critical_moments: z.array(coachCriticalMomentSchema),
  themes: z.array(z.string()),
  training_plan: z.array(coachTrainingItemSchema),
  limitations: z.array(z.string()),
});

export type CoachReport = z.infer<typeof coachReportSchema>;

export const coachQueryResponseSchema = z.object({
  status: z.string(),
  scope_type: z.string(),
  scope_id: z.number().int(),
  analysis_version: z.string(),
  model: z.string(),
  prompt_version: z.string(),
  schema_version: z.string(),
  output_id: z.number().int(),
  cached: z.boolean(),
  created_at: z.string(),
  report: coachReportSchema,
});

export type CoachQueryResponse = z.infer<typeof coachQueryResponseSchema>;

export const moveCommentaryEvidenceSchema = z.object({
  best_move_uci: z.string().nullable(),
  eval_before_cp: z.number().int().nullable(),
  eval_before_mate: z.number().int().nullable(),
  eval_after_cp: z.number().int().nullable(),
  eval_after_mate: z.number().int().nullable(),
});

export const moveCommentarySchema = z.object({
  move_id: z.number().int(),
  ply: z.number().int(),
  move_san: z.string(),
  move_uci: z.string(),
  fen_hash: z.string(),
  classification: z.string(),
  cpl: z.number().int().nullable(),
  clock_remaining_ms: z.number().int().nullable(),
  time_spent_ms: z.number().int().nullable(),
  explanation: z.string(),
  best_move_explanation: z.string().nullable().optional(),
  focus_tags: z.array(z.string()),
  evidence: moveCommentaryEvidenceSchema,
});

export const moveCommentaryReportSchema = z.object({
  game_id: z.number().int(),
  analysis_version: z.string(),
  summary: z.array(z.string()),
  themes: z.array(z.string()),
  moves: z.array(moveCommentarySchema),
  limitations: z.array(z.string()),
});

export const moveCommentaryResponseSchema = z.object({
  status: z.string(),
  scope_type: z.string(),
  scope_id: z.number().int(),
  analysis_version: z.string(),
  model: z.string(),
  prompt_version: z.string(),
  schema_version: z.string(),
  output_id: z.number().int(),
  cached: z.boolean(),
  created_at: z.string(),
  report: moveCommentaryReportSchema,
});

export type MoveCommentaryResponse = z.infer<typeof moveCommentaryResponseSchema>;

export const commentaryWizardSegmentSchema = z.object({
  type: z.enum(['text', 'move']),
  text: z.string().nullable().optional(),
  san: z.string().nullable().optional(),
});

export const commentaryWizardReportSchema = z.object({
  game_id: z.number().int(),
  move_id: z.number().int(),
  analysis_version: z.string(),
  question: z.string(),
  segments: z.array(commentaryWizardSegmentSchema),
  limitations: z.array(z.string()),
});

export const commentaryWizardResponseSchema = z.object({
  status: z.string(),
  scope_type: z.string(),
  scope_id: z.number().int(),
  analysis_version: z.string(),
  model: z.string(),
  prompt_version: z.string(),
  schema_version: z.string(),
  output_id: z.number().int(),
  cached: z.boolean(),
  created_at: z.string(),
  report: commentaryWizardReportSchema,
});

export type CommentaryWizardResponse = z.infer<typeof commentaryWizardResponseSchema>;

export const gameRecapMomentSchema = z.object({
  move_id: z.number().int(),
  ply: z.number().int(),
  move_san: z.string(),
  classification: z.string(),
  cpl: z.number().int().nullable(),
  explanation: z.string(),
  evidence: moveCommentaryEvidenceSchema,
});

export const gameRecapReportSchema = z.object({
  game_id: z.number().int(),
  analysis_version: z.string(),
  summary: z.array(z.string()),
  key_moments: z.array(gameRecapMomentSchema),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  training_focus: z.array(z.string()),
  limitations: z.array(z.string()),
});

export const gameRecapResponseSchema = z.object({
  status: z.string(),
  scope_type: z.string(),
  scope_id: z.number().int(),
  analysis_version: z.string(),
  model: z.string(),
  prompt_version: z.string(),
  schema_version: z.string(),
  output_id: z.number().int(),
  cached: z.boolean(),
  created_at: z.string(),
  report: gameRecapReportSchema,
});

export type GameRecapResponse = z.infer<typeof gameRecapResponseSchema>;

export const insightsCoachGuidelineSchema = z.object({
  title: z.string(),
  description: z.string(),
  focus_tags: z.array(z.string()),
  evidence_game_ids: z.array(z.number().int()),
  evidence_move_ids: z.array(z.number().int()),
});

export const insightsCoachReportSchema = z.object({
  player_username: z.string(),
  analysis_version: z.string().nullable(),
  summary: z.array(z.string()),
  focus_areas: z.array(z.string()),
  guidelines: z.array(insightsCoachGuidelineSchema),
  training_plan: z.array(z.string()),
  limitations: z.array(z.string()),
});

export const insightsCoachResponseSchema = z.object({
  status: z.string(),
  scope_type: z.string(),
  scope_id: z.number().int(),
  analysis_version: z.string().nullable(),
  model: z.string(),
  prompt_version: z.string(),
  schema_version: z.string(),
  output_id: z.number().int(),
  cached: z.boolean(),
  created_at: z.string(),
  report: insightsCoachReportSchema,
});

export type InsightsCoachResponse = z.infer<typeof insightsCoachResponseSchema>;

export const dataPurgeResponseSchema = z.object({
  status: z.string(),
  deleted: z.record(z.string(), z.number().int()),
});

export type DataPurgeResponse = z.infer<typeof dataPurgeResponseSchema>;

export const insightsOverviewSchema = z.object({
  status: z.string(),
  player_username: z.string(),
  analysis_version: z.string().nullable(),
  games: z.number().int(),
  moves_analyzed: z.number().int(),
  average_cpl: z.number().nullable(),
  blunders: z.number().int(),
  mistakes: z.number().int(),
  inaccuracies: z.number().int(),
  last_sync: z.string().nullable(),
});

export type InsightsOverviewResponse = z.infer<typeof insightsOverviewSchema>;

export const openingInsightSchema = z.object({
  opening: z.string(),
  games: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
  draws: z.number().int(),
  win_rate: z.number(),
  average_cpl: z.number().nullable(),
});

export const insightsOpeningsSchema = z.object({
  status: z.string(),
  player_username: z.string(),
  analysis_version: z.string().nullable(),
  openings: z.array(openingInsightSchema),
});

export type InsightsOpeningsResponse = z.infer<typeof insightsOpeningsSchema>;

export const insightsTimeSchema = z.object({
  status: z.string(),
  player_username: z.string(),
  analysis_version: z.string().nullable(),
  time_trouble_threshold_ms: z.number().int(),
  avg_time_spent_ms: z.number().nullable(),
  time_trouble_moves: z.number().int(),
  time_trouble_blunders: z.number().int(),
  avg_cpl_time_trouble: z.number().nullable(),
  avg_cpl_normal: z.number().nullable(),
});

export type InsightsTimeResponse = z.infer<typeof insightsTimeSchema>;

export const patternInsightSchema = z.object({
  pattern_key: z.string(),
  title: z.string(),
  description: z.string(),
  occurrences: z.number().int(),
  average_cpl: z.number().nullable(),
  severity_score: z.number(),
  examples: z.array(
    z.object({
      game_id: z.number().int(),
      move_id: z.number().int(),
      fen: z.string(),
      notes: z.string().nullable(),
    }),
  ),
});

export const insightsPatternsSchema = z.object({
  status: z.string(),
  player_username: z.string(),
  analysis_version: z.string().nullable(),
  patterns: z.array(patternInsightSchema),
});

export type InsightsPatternsResponse = z.infer<typeof insightsPatternsSchema>;

// Deep Insights Schemas - Elite Level Analysis

export const criticalMomentDeepSchema = z.object({
  move_id: z.number().int(),
  game_id: z.number().int(),
  ply: z.number().int(),
  move_san: z.string(),
  move_uci: z.string(),
  fen_before: z.string(),
  fen_hash: z.string(),
  classification: z.string(),
  cpl: z.number().int().nullable(),
  best_move_uci: z.string().nullable(),
  eval_before_cp: z.number().int().nullable(),
  eval_before_mate: z.number().int().nullable(),
  eval_after_cp: z.number().int().nullable(),
  eval_after_mate: z.number().int().nullable(),
  clock_remaining_ms: z.number().int().nullable(),
  time_spent_ms: z.number().int().nullable(),
  phase: z.string(),
  is_tactical: z.boolean(),
});

export const phaseStatsSchema = z.object({
  phase: z.string(),
  moves: z.number().int(),
  avg_cpl: z.number().nullable(),
  blunders: z.number().int(),
  mistakes: z.number().int(),
  inaccuracies: z.number().int(),
  excellent_moves: z.number().int(),
  avg_time_spent_ms: z.number().nullable(),
  time_trouble_moves: z.number().int(),
});

export const gameDeepAnalysisSchema = z.object({
  game_id: z.number().int(),
  result: z.string(),
  player_color: z.string(),
  opponent_username: z.string().nullable(),
  opponent_rating: z.number().int().nullable(),
  opening: z.string().nullable(),
  time_control: z.string().nullable(),
  played_at: z.string().nullable(),
  total_moves: z.number().int(),
  avg_cpl: z.number().nullable(),
  phases: z.record(z.string(), phaseStatsSchema),
  critical_moments: z.array(criticalMomentDeepSchema),
  time_trouble_entered_at: z.number().int().nullable(),
  blunders: z.number().int(),
  mistakes: z.number().int(),
  inaccuracies: z.number().int(),
  excellent_moves: z.number().int(),
});

export const openingDeepAnalysisSchema = z.object({
  opening_name: z.string(),
  eco_url: z.string().nullable(),
  games: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
  draws: z.number().int(),
  win_rate: z.number(),
  avg_cpl: z.number().nullable(),
  avg_cpl_opening_phase: z.number().nullable(),
  common_mistakes: z.array(criticalMomentDeepSchema),
  best_games: z.array(z.number().int()),
  worst_games: z.array(z.number().int()),
});

export const timeManagementDeepSchema = z.object({
  avg_time_per_move_ms: z.number().nullable(),
  opening_avg_time_ms: z.number().nullable(),
  middlegame_avg_time_ms: z.number().nullable(),
  endgame_avg_time_ms: z.number().nullable(),
  games_with_time_trouble: z.number().int(),
  total_games: z.number().int(),
  time_trouble_rate: z.number(),
  avg_ply_entering_time_trouble: z.number().nullable(),
  blunders_in_time_trouble: z.number().int(),
  blunders_total: z.number().int(),
  time_trouble_blunder_rate: z.number(),
  avg_cpl_fast_moves: z.number().nullable(),
  avg_cpl_normal_moves: z.number().nullable(),
  avg_cpl_slow_moves: z.number().nullable(),
  fastest_blunders: z.array(criticalMomentDeepSchema),
});

export const phaseTrendSchema = z.object({
  avg_cpl: z.number().nullable(),
  blunders: z.number().int(),
  mistakes: z.number().int(),
  excellent: z.number().int(),
  moves: z.number().int(),
  error_rate: z.number(),
  excellence_rate: z.number(),
});

export const signalSchema = z.object({
  type: z.string(),
  description: z.string(),
  magnitude: z.number().nullable().optional(),
  severity: z.string().nullable().optional(),
  game_ids: z.array(z.number().int()).nullable().optional(),
});

export const overallStatsSchema = z.object({
  games: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
  draws: z.number().int(),
  win_rate: z.number(),
  avg_cpl: z.number().nullable(),
  total_blunders: z.number().int(),
  total_mistakes: z.number().int(),
  total_excellent: z.number().int(),
});

export const deepInsightsDataSchema = z.object({
  status: z.string(),
  player_username: z.string(),
  analysis_version: z.string().nullable(),
  date_range_start: z.string().nullable(),
  date_range_end: z.string().nullable(),
  games_analyzed: z.number().int(),
  overall_stats: overallStatsSchema,
  game_analyses: z.array(gameDeepAnalysisSchema),
  opening_analyses: z.array(openingDeepAnalysisSchema),
  time_management: timeManagementDeepSchema,
  phase_trends: z.record(z.string(), phaseTrendSchema),
  improvement_signals: z.array(signalSchema),
  regression_signals: z.array(signalSchema),
});

export type DeepInsightsDataResponse = z.infer<typeof deepInsightsDataSchema>;

// Deep Insights Coach Report Schemas

export const trainingPrioritySchema = z.object({
  title: z.string(),
  description: z.string(),
  urgency: z.string(),
  evidence_game_ids: z.array(z.number().int()),
  evidence_move_ids: z.array(z.number().int()),
  recommended_focus_hours: z.number().nullable().optional(),
  specific_exercises: z.array(z.string()),
});

export const phaseAnalysisSchema = z.object({
  phase: z.string(),
  performance_summary: z.string(),
  avg_cpl: z.number().nullable(),
  key_patterns: z.array(z.string()),
  weaknesses: z.array(z.string()),
  strengths: z.array(z.string()),
  training_focus: z.array(z.string()),
});

export const gameByGameInsightSchema = z.object({
  game_id: z.number().int(),
  headline: z.string(),
  key_lesson: z.string(),
  critical_moment_ids: z.array(z.number().int()),
});

export const deepInsightsCoachReportSchema = z.object({
  player_username: z.string(),
  analysis_version: z.string().nullable(),
  games_analyzed: z.number().int(),
  executive_summary: z.string(),
  performance_trajectory: z.string(),
  overall_assessment: z.string(),
  phase_analyses: z.array(phaseAnalysisSchema),
  training_priorities: z.array(trainingPrioritySchema),
  game_insights: z.array(gameByGameInsightSchema),
  recurring_patterns: z.array(z.string()),
  improvement_signals: z.array(z.string()),
  regression_warnings: z.array(z.string()),
  immediate_focus: z.array(z.string()),
  short_term_plan: z.array(z.string()),
  long_term_development: z.array(z.string()),
  limitations: z.array(z.string()),
});

export const deepInsightsCoachResponseSchema = z.object({
  status: z.string(),
  scope_type: z.string(),
  scope_id: z.number().int(),
  analysis_version: z.string().nullable(),
  model: z.string(),
  prompt_version: z.string(),
  schema_version: z.string(),
  output_id: z.number().int(),
  cached: z.boolean(),
  created_at: z.string(),
  report: deepInsightsCoachReportSchema,
});

export type DeepInsightsCoachResponse = z.infer<typeof deepInsightsCoachResponseSchema>;

// Opening Insights Schemas

export const openingRecommendationSchema = z.object({
  opening_name: z.string(),
  recommendation: z.string(),
  reasoning: z.string(),
  current_performance: z.string(),
  suggested_improvements: z.array(z.string()),
});

export const openingInsightsReportSchema = z.object({
  player_username: z.string(),
  games_analyzed: z.number().int(),
  repertoire_health: z.string(),
  strongest_openings: z.array(z.string()),
  weakest_openings: z.array(z.string()),
  opening_recommendations: z.array(openingRecommendationSchema),
  opening_error_patterns: z.array(z.string()),
  immediate_study_priorities: z.array(z.string()),
  theory_gaps: z.array(z.string()),
  positional_understanding_gaps: z.array(z.string()),
  critical_positions_to_review: z.array(z.number().int()),
  limitations: z.array(z.string()),
});

export const openingInsightsResponseSchema = z.object({
  status: z.string(),
  scope_type: z.string(),
  scope_id: z.number().int(),
  analysis_version: z.string().nullable(),
  model: z.string(),
  prompt_version: z.string(),
  schema_version: z.string(),
  output_id: z.number().int(),
  cached: z.boolean(),
  created_at: z.string(),
  report: openingInsightsReportSchema,
});

export type OpeningInsightsResponse = z.infer<typeof openingInsightsResponseSchema>;

// Time Insights Schemas

export const timeStrategyRecommendationSchema = z.object({
  phase: z.string(),
  current_pattern: z.string(),
  recommended_change: z.string(),
  expected_benefit: z.string(),
});

export const timeInsightsReportSchema = z.object({
  player_username: z.string(),
  games_analyzed: z.number().int(),
  time_management_assessment: z.string(),
  time_trouble_frequency: z.string(),
  correlation_with_errors: z.string(),
  opening_time_usage: z.string(),
  middlegame_time_usage: z.string(),
  endgame_time_usage: z.string(),
  impulsive_move_patterns: z.array(z.string()),
  overthinking_patterns: z.array(z.string()),
  time_trouble_consequences: z.array(z.string()),
  fastest_blunders_analysis: z.array(z.string()),
  time_pressure_game_ids: z.array(z.number().int()),
  strategy_recommendations: z.array(timeStrategyRecommendationSchema),
  clock_management_drills: z.array(z.string()),
  psychological_observations: z.array(z.string()),
  limitations: z.array(z.string()),
});

export const timeInsightsResponseSchema = z.object({
  status: z.string(),
  scope_type: z.string(),
  scope_id: z.number().int(),
  analysis_version: z.string().nullable(),
  model: z.string(),
  prompt_version: z.string(),
  schema_version: z.string(),
  output_id: z.number().int(),
  cached: z.boolean(),
  created_at: z.string(),
  report: timeInsightsReportSchema,
});

export type TimeInsightsResponse = z.infer<typeof timeInsightsResponseSchema>;
