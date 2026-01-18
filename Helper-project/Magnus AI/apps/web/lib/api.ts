import {
  analyzeAllResponseSchema,
  gameRecapResponseSchema,
  gameAnalysisResponseSchema,
  gameAnalysisSeriesSchema,
  gamePgnSchema,
  gameSchema,
  healthResponseSchema,
  insightsCoachResponseSchema,
  insightsOpeningsSchema,
  insightsOverviewSchema,
  insightsPatternsSchema,
  insightsTimeSchema,
  moveSchema,
  moveCommentaryResponseSchema,
  commentaryWizardResponseSchema,
  deepInsightsDataSchema,
  deepInsightsCoachResponseSchema,
  openingInsightsResponseSchema,
  timeInsightsResponseSchema,
  type GameRecapResponse,
  type Game,
  type AnalyzeAllResponse,
  type GameAnalysisResponse,
  type GameAnalysisSeriesResponse,
  type HealthResponse,
  type InsightsCoachResponse,
  type InsightsOpeningsResponse,
  type InsightsOverviewResponse,
  type InsightsPatternsResponse,
  type InsightsTimeResponse,
  type Move,
  type MoveCommentaryResponse,
  type CommentaryWizardResponse,
  type DeepInsightsDataResponse,
  type DeepInsightsCoachResponse,
  type OpeningInsightsResponse,
  type TimeInsightsResponse,
} from '@magnus/shared';

const DEFAULT_API_BASE_URL = 'http://localhost:8000';

function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  // No timeout - let operations complete naturally with loading states in UI
  return await fetch(input, init);
}

async function fetchJson<T>(path: string, schema: { parse: (data: unknown) => T }): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const response = await fetchWithTimeout(`${baseUrl}${path}`, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  const payload = await response.json();
  return schema.parse(payload);
}

async function extractErrorMessage(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    if (!text) {
      return null;
    }
    try {
      const parsed = JSON.parse(text) as {
        detail?: string;
        message?: string;
        error?: { message?: string };
      };
      if (parsed.detail) return parsed.detail;
      if (parsed.message) return parsed.message;
      if (parsed.error?.message) return parsed.error.message;
    } catch {
      // non-JSON response
    }
    return text;
  } catch {
    return null;
  }
}

async function fetchJsonOptional<T>(
  path: string,
  schema: { parse: (data: unknown) => T },
): Promise<T | null> {
  const baseUrl = getApiBaseUrl();
  const response = await fetchWithTimeout(`${baseUrl}${path}`, { cache: 'no-store' });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  const payload = await response.json();
  return schema.parse(payload);
}

export async function fetchHealth(): Promise<HealthResponse> {
  return fetchJson('/api/health', healthResponseSchema);
}

export async function fetchGames(query: Record<string, string | undefined>): Promise<Game[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      params.set(key, value);
    }
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const data = await fetchJson(`/api/games${suffix}`, { parse: gameSchema.array().parse });
  return data;
}

export async function fetchGame(
  gameId: number,
  query?: Record<string, string | undefined>,
): Promise<Game> {
  const params = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value) {
        params.set(key, value);
      }
    }
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return fetchJson(`/api/games/${gameId}${suffix}`, gameSchema);
}

export async function fetchGameMoves(gameId: number): Promise<Move[]> {
  const data = await fetchJson(`/api/games/${gameId}/moves`, { parse: moveSchema.array().parse });
  return data;
}

export async function fetchGamePgn(gameId: number): Promise<string> {
  const data = await fetchJson(`/api/games/${gameId}/pgn`, gamePgnSchema);
  return data.pgn;
}

export async function fetchGameAnalysis(gameId: number): Promise<GameAnalysisResponse | null> {
  return fetchJsonOptional(`/api/games/${gameId}/analysis`, gameAnalysisResponseSchema);
}

export async function fetchGameAnalysisSeries(
  gameId: number,
): Promise<GameAnalysisSeriesResponse | null> {
  return fetchJsonOptional(`/api/games/${gameId}/analysis/series`, gameAnalysisSeriesSchema);
}

export async function fetchMoveCommentary(
  gameId: number,
  analysisVersion?: string,
): Promise<MoveCommentaryResponse | null> {
  const params = new URLSearchParams();
  if (analysisVersion) {
    params.set('analysis_version', analysisVersion);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return fetchJsonOptional(
    `/api/games/${gameId}/commentary${suffix}`,
    moveCommentaryResponseSchema,
  );
}

export async function generateMoveCommentary(
  gameId: number,
  analysisVersion?: string,
  force?: boolean,
): Promise<MoveCommentaryResponse> {
  const baseUrl = getApiBaseUrl();
  const response = await fetchWithTimeout(`${baseUrl}/api/games/${gameId}/commentary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      analysis_version: analysisVersion ?? null,
      force: Boolean(force),
    }),
  });

  if (!response.ok) {
    const message = await extractErrorMessage(response);
    throw new Error(message ?? `API request failed: ${response.status}`);
  }

  const payload = await response.json();
  return moveCommentaryResponseSchema.parse(payload);
}

export async function generateCommentaryWizard(
  gameId: number,
  moveId: number,
  question: string,
  analysisVersion?: string,
  force?: boolean,
): Promise<CommentaryWizardResponse> {
  const baseUrl = getApiBaseUrl();
  const response = await fetchWithTimeout(
    `${baseUrl}/api/games/${gameId}/commentary/wizard`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        move_id: moveId,
        analysis_version: analysisVersion ?? null,
        force: Boolean(force),
      }),
    },
  );

  if (!response.ok) {
    const message = await extractErrorMessage(response);
    throw new Error(message ?? `API request failed: ${response.status}`);
  }

  const payload = await response.json();
  return commentaryWizardResponseSchema.parse(payload);
}

export async function fetchGameRecap(
  gameId: number,
  analysisVersion?: string,
): Promise<GameRecapResponse | null> {
  const params = new URLSearchParams();
  if (analysisVersion) {
    params.set('analysis_version', analysisVersion);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return fetchJsonOptional(`/api/games/${gameId}/recap${suffix}`, gameRecapResponseSchema);
}

export async function generateGameRecap(
  gameId: number,
  analysisVersion?: string,
  force?: boolean,
): Promise<GameRecapResponse> {
  const baseUrl = getApiBaseUrl();
  const response = await fetchWithTimeout(`${baseUrl}/api/games/${gameId}/recap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      analysis_version: analysisVersion ?? null,
      force: Boolean(force),
    }),
  });

  if (!response.ok) {
    const message = await extractErrorMessage(response);
    throw new Error(message ?? `API request failed: ${response.status}`);
  }

  const payload = await response.json();
  return gameRecapResponseSchema.parse(payload);
}

export async function analyzeAllGames(
  username: string,
  maxPlies?: number,
): Promise<AnalyzeAllResponse> {
  const baseUrl = getApiBaseUrl();
  const response = await fetchWithTimeout(`${baseUrl}/api/games/analyze-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      max_plies: maxPlies ?? null,
    }),
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  const payload = await response.json();
  return analyzeAllResponseSchema.parse(payload);
}

export async function fetchInsightsCoach(
  username: string,
  gameId?: number,
  thresholdMs?: number,
  analysisVersion?: string,
): Promise<InsightsCoachResponse | null> {
  const params = new URLSearchParams({ username });
  if (typeof gameId === 'number') {
    params.set('game_id', String(gameId));
  }
  if (typeof thresholdMs === 'number') {
    params.set('threshold_ms', String(thresholdMs));
  }
  if (analysisVersion) {
    params.set('analysis_version', analysisVersion);
  }
  return fetchJsonOptional(`/api/insights/coach?${params.toString()}`, insightsCoachResponseSchema);
}

export async function generateInsightsCoach(
  username: string,
  gameId?: number,
  thresholdMs?: number,
  analysisVersion?: string,
  force?: boolean,
): Promise<InsightsCoachResponse> {
  const baseUrl = getApiBaseUrl();
  const response = await fetchWithTimeout(`${baseUrl}/api/insights/coach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      game_id: typeof gameId === 'number' ? gameId : null,
      threshold_ms: thresholdMs ?? 30000,
      analysis_version: analysisVersion ?? null,
      force: Boolean(force),
    }),
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  const payload = await response.json();
  return insightsCoachResponseSchema.parse(payload);
}

export async function fetchInsightsOverview(
  username: string,
): Promise<InsightsOverviewResponse> {
  return fetchJson(
    `/api/insights/overview?username=${encodeURIComponent(username)}`,
    insightsOverviewSchema,
  );
}

export async function fetchInsightsOpenings(
  username: string,
): Promise<InsightsOpeningsResponse> {
  return fetchJson(
    `/api/insights/openings?username=${encodeURIComponent(username)}`,
    insightsOpeningsSchema,
  );
}

export async function fetchInsightsTime(
  username: string,
  thresholdMs: number,
): Promise<InsightsTimeResponse> {
  return fetchJson(
    `/api/insights/time?username=${encodeURIComponent(username)}&threshold_ms=${thresholdMs}`,
    insightsTimeSchema,
  );
}

export async function fetchInsightsPatterns(
  username: string,
): Promise<InsightsPatternsResponse> {
  return fetchJson(
    `/api/insights/patterns?username=${encodeURIComponent(username)}`,
    insightsPatternsSchema,
  );
}

// Deep Insights API - Elite Level Analysis

export async function fetchDeepInsightsData(
  username: string,
  gameLimit: number = 10,
): Promise<DeepInsightsDataResponse> {
  const params = new URLSearchParams({
    username,
    game_limit: String(gameLimit),
  });
  return fetchJson(`/api/deep-insights/data?${params.toString()}`, deepInsightsDataSchema);
}

export async function fetchDeepInsightsCoach(
  username: string,
  gameLimit: number = 10,
): Promise<DeepInsightsCoachResponse | null> {
  const params = new URLSearchParams({
    username,
    game_limit: String(gameLimit),
  });
  return fetchJsonOptional(
    `/api/deep-insights/coach?${params.toString()}`,
    deepInsightsCoachResponseSchema,
  );
}

export async function generateDeepInsightsCoach(
  username: string,
  gameLimit: number = 10,
  force?: boolean,
): Promise<DeepInsightsCoachResponse> {
  const baseUrl = getApiBaseUrl();
  const response = await fetchWithTimeout(
    `${baseUrl}/api/deep-insights/coach`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        game_limit: gameLimit,
        force: Boolean(force),
      }),
    },
  );

  if (!response.ok) {
    const message = await extractErrorMessage(response);
    throw new Error(message ?? `API request failed: ${response.status}`);
  }

  const payload = await response.json();
  return deepInsightsCoachResponseSchema.parse(payload);
}

export async function fetchOpeningInsights(
  username: string,
  gameLimit: number = 10,
): Promise<OpeningInsightsResponse | null> {
  const params = new URLSearchParams({
    username,
    game_limit: String(gameLimit),
  });
  return fetchJsonOptional(
    `/api/deep-insights/openings?${params.toString()}`,
    openingInsightsResponseSchema,
  );
}

export async function generateOpeningInsights(
  username: string,
  gameLimit: number = 10,
  force?: boolean,
): Promise<OpeningInsightsResponse> {
  const baseUrl = getApiBaseUrl();
  const response = await fetchWithTimeout(
    `${baseUrl}/api/deep-insights/openings`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        game_limit: gameLimit,
        force: Boolean(force),
      }),
    },
  );

  if (!response.ok) {
    const message = await extractErrorMessage(response);
    throw new Error(message ?? `API request failed: ${response.status}`);
  }

  const payload = await response.json();
  return openingInsightsResponseSchema.parse(payload);
}

export async function fetchTimeInsights(
  username: string,
  gameLimit: number = 10,
): Promise<TimeInsightsResponse | null> {
  const params = new URLSearchParams({
    username,
    game_limit: String(gameLimit),
  });
  return fetchJsonOptional(
    `/api/deep-insights/time?${params.toString()}`,
    timeInsightsResponseSchema,
  );
}

export async function generateTimeInsights(
  username: string,
  gameLimit: number = 10,
  force?: boolean,
): Promise<TimeInsightsResponse> {
  const baseUrl = getApiBaseUrl();
  const response = await fetchWithTimeout(
    `${baseUrl}/api/deep-insights/time`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        game_limit: gameLimit,
        force: Boolean(force),
      }),
    },
  );

  if (!response.ok) {
    const message = await extractErrorMessage(response);
    throw new Error(message ?? `API request failed: ${response.status}`);
  }

  const payload = await response.json();
  return timeInsightsResponseSchema.parse(payload);
}
