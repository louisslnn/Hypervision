"""Schemas for Deep Insights - Elite Level Analysis."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class CriticalMomentOut(BaseModel):
    """A critical moment in a game."""
    move_id: int
    game_id: int
    ply: int
    move_san: str
    move_uci: str
    fen_before: str
    fen_hash: str
    classification: str
    cpl: Optional[int] = None
    best_move_uci: Optional[str] = None
    eval_before_cp: Optional[int] = None
    eval_before_mate: Optional[int] = None
    eval_after_cp: Optional[int] = None
    eval_after_mate: Optional[int] = None
    clock_remaining_ms: Optional[int] = None
    time_spent_ms: Optional[int] = None
    phase: str
    is_tactical: bool = False


class PhaseStatsOut(BaseModel):
    """Statistics for a game phase."""
    phase: str
    moves: int
    avg_cpl: Optional[float] = None
    blunders: int
    mistakes: int
    inaccuracies: int
    excellent_moves: int
    avg_time_spent_ms: Optional[float] = None
    time_trouble_moves: int


class GameDeepAnalysisOut(BaseModel):
    """Deep analysis for a single game."""
    game_id: int
    result: str
    player_color: str
    opponent_username: Optional[str] = None
    opponent_rating: Optional[int] = None
    opening: Optional[str] = None
    time_control: Optional[str] = None
    played_at: Optional[datetime] = None
    total_moves: int
    avg_cpl: Optional[float] = None
    phases: dict[str, PhaseStatsOut]
    critical_moments: list[CriticalMomentOut]
    time_trouble_entered_at: Optional[int] = None
    blunders: int
    mistakes: int
    inaccuracies: int
    excellent_moves: int


class OpeningDeepAnalysisOut(BaseModel):
    """Deep analysis for an opening."""
    opening_name: str
    eco_url: Optional[str] = None
    games: int
    wins: int
    losses: int
    draws: int
    win_rate: float
    avg_cpl: Optional[float] = None
    avg_cpl_opening_phase: Optional[float] = None
    common_mistakes: list[CriticalMomentOut]
    best_games: list[int]
    worst_games: list[int]


class TimeManagementDeepAnalysisOut(BaseModel):
    """Deep time management analysis."""
    avg_time_per_move_ms: Optional[float] = None
    opening_avg_time_ms: Optional[float] = None
    middlegame_avg_time_ms: Optional[float] = None
    endgame_avg_time_ms: Optional[float] = None
    games_with_time_trouble: int
    total_games: int
    time_trouble_rate: float
    avg_ply_entering_time_trouble: Optional[float] = None
    blunders_in_time_trouble: int
    blunders_total: int
    time_trouble_blunder_rate: float
    avg_cpl_fast_moves: Optional[float] = None
    avg_cpl_normal_moves: Optional[float] = None
    avg_cpl_slow_moves: Optional[float] = None
    fastest_blunders: list[CriticalMomentOut]


class PhaseTrendOut(BaseModel):
    """Trend data for a game phase."""
    avg_cpl: Optional[float] = None
    blunders: int
    mistakes: int
    excellent: int
    moves: int
    error_rate: float
    excellence_rate: float


class SignalOut(BaseModel):
    """Improvement or regression signal."""
    type: str
    description: str
    magnitude: Optional[float] = None
    severity: Optional[str] = None
    game_ids: Optional[list[int]] = None


class OverallStatsOut(BaseModel):
    """Overall statistics."""
    games: int
    wins: int
    losses: int
    draws: int
    win_rate: float
    avg_cpl: Optional[float] = None
    total_blunders: int
    total_mistakes: int
    total_excellent: int


class DeepInsightsDataResponse(BaseModel):
    """Raw deep insights data response."""
    status: str
    player_username: str
    analysis_version: Optional[str] = None
    date_range_start: Optional[datetime] = None
    date_range_end: Optional[datetime] = None
    games_analyzed: int
    overall_stats: OverallStatsOut
    game_analyses: list[GameDeepAnalysisOut]
    opening_analyses: list[OpeningDeepAnalysisOut]
    time_management: TimeManagementDeepAnalysisOut
    phase_trends: dict[str, PhaseTrendOut]
    improvement_signals: list[SignalOut]
    regression_signals: list[SignalOut]


class DeepInsightsRequest(BaseModel):
    """Request for deep insights analysis."""
    username: str
    game_limit: int = Field(default=10, ge=1, le=25)
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    force: bool = False


# LLM Coach Report Schemas

class TrainingPriorityOut(BaseModel):
    """A specific training priority with evidence."""
    title: str
    description: str
    urgency: str  # critical, high, medium, low
    evidence_game_ids: list[int]
    evidence_move_ids: list[int]
    recommended_focus_hours: Optional[float] = None
    specific_exercises: list[str]


class PhaseAnalysisOut(BaseModel):
    """Analysis for a specific game phase."""
    phase: str  # opening, middlegame, endgame
    performance_summary: str
    avg_cpl: Optional[float] = None
    key_patterns: list[str]
    weaknesses: list[str]
    strengths: list[str]
    training_focus: list[str]


class GameByGameInsightOut(BaseModel):
    """Insight for a specific game."""
    game_id: int
    headline: str
    key_lesson: str
    critical_moment_ids: list[int]


class DeepInsightsCoachReport(BaseModel):
    """Elite-level coaching report."""
    player_username: str
    analysis_version: Optional[str] = None
    games_analyzed: int
    
    # Executive Summary
    executive_summary: str
    performance_trajectory: str  # improving, declining, stable, inconsistent
    overall_assessment: str
    
    # Phase-by-phase analysis
    phase_analyses: list[PhaseAnalysisOut]
    
    # Training priorities (ranked)
    training_priorities: list[TrainingPriorityOut]
    
    # Game-by-game insights
    game_insights: list[GameByGameInsightOut]
    
    # Patterns
    recurring_patterns: list[str]
    improvement_signals: list[str]
    regression_warnings: list[str]
    
    # Actionable plan
    immediate_focus: list[str]  # This week
    short_term_plan: list[str]  # Next 2-4 weeks
    long_term_development: list[str]  # Next 3-6 months
    
    # Transparency
    limitations: list[str]


class DeepInsightsCoachResponse(BaseModel):
    """Response with LLM-generated coaching report."""
    status: str
    scope_type: str
    scope_id: int
    analysis_version: Optional[str] = None
    model: str
    prompt_version: str
    schema_version: str
    output_id: int
    cached: bool
    created_at: datetime
    report: DeepInsightsCoachReport


# Opening-specific insights

class OpeningRecommendationOut(BaseModel):
    """Recommendation for an opening."""
    opening_name: str
    recommendation: str  # keep, drop, study, expand
    reasoning: str
    current_performance: str
    suggested_improvements: list[str]


class OpeningInsightsCoachReport(BaseModel):
    """Opening-specific coaching report."""
    player_username: str
    games_analyzed: int
    
    # Repertoire overview
    repertoire_health: str
    strongest_openings: list[str]
    weakest_openings: list[str]
    
    # Detailed recommendations
    opening_recommendations: list[OpeningRecommendationOut]
    
    # Common error patterns in openings
    opening_error_patterns: list[str]
    
    # Study priorities
    immediate_study_priorities: list[str]
    theory_gaps: list[str]
    positional_understanding_gaps: list[str]
    
    # Specific positions to study
    critical_positions_to_review: list[int]  # move_ids
    
    limitations: list[str]


class OpeningInsightsRequest(BaseModel):
    """Request for opening insights."""
    username: str
    game_limit: int = Field(default=10, ge=1, le=25)
    force: bool = False


class OpeningInsightsCoachResponse(BaseModel):
    """Response with opening coaching report."""
    status: str
    scope_type: str
    scope_id: int
    analysis_version: Optional[str] = None
    model: str
    prompt_version: str
    schema_version: str
    output_id: int
    cached: bool
    created_at: datetime
    report: OpeningInsightsCoachReport


# Time management-specific insights

class TimeStrategyRecommendationOut(BaseModel):
    """Time management strategy recommendation."""
    phase: str
    current_pattern: str
    recommended_change: str
    expected_benefit: str


class TimeInsightsCoachReport(BaseModel):
    """Time management coaching report."""
    player_username: str
    games_analyzed: int
    
    # Overview
    time_management_assessment: str
    time_trouble_frequency: str
    correlation_with_errors: str
    
    # Phase analysis
    opening_time_usage: str
    middlegame_time_usage: str
    endgame_time_usage: str
    
    # Problem patterns
    impulsive_move_patterns: list[str]
    overthinking_patterns: list[str]
    time_trouble_consequences: list[str]
    
    # Evidence
    fastest_blunders_analysis: list[str]
    time_pressure_game_ids: list[int]
    
    # Recommendations
    strategy_recommendations: list[TimeStrategyRecommendationOut]
    clock_management_drills: list[str]
    
    # Mental aspects
    psychological_observations: list[str]
    
    limitations: list[str]


class TimeInsightsRequest(BaseModel):
    """Request for time insights."""
    username: str
    game_limit: int = Field(default=10, ge=1, le=25)
    force: bool = False


class TimeInsightsCoachResponse(BaseModel):
    """Response with time management coaching report."""
    status: str
    scope_type: str
    scope_id: int
    analysis_version: Optional[str] = None
    model: str
    prompt_version: str
    schema_version: str
    output_id: int
    cached: bool
    created_at: datetime
    report: TimeInsightsCoachReport

