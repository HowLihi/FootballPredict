const API_BASE = '';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API Error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export interface EloRating {
  id: number;
  teamName: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  lastMatchDate: string | null;
}

export interface EloHistory {
  id: number;
  teamName: string;
  rating: number;
  ratingChange: number;
  opponentName: string;
  opponentRating: number;
  result: string;
  homeScore: number;
  awayScore: number;
  isHome: boolean;
  tournament: string | null;
  matchDate: string;
  calculationDate: string;
}

export interface MatchPrediction {
  homeTeam: string;
  awayTeam: string;
  homeRating: number;
  awayRating: number;
  homeWinProbability: number;
  drawProbability: number;
  awayWinProbability: number;
  homeAdvantage: number;
}

export interface WcPrediction {
  id: number;
  matchDate: string;
  groupName: string;
  homeTeam: string;
  awayTeam: string;
  round: number;
  homeRating: number;
  awayRating: number;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  predictedResult: string;
  predictedScoreHome: number;
  predictedScoreAway: number;
  homeAdvantage: number;
  venue: string | null;
  neutral: boolean;
  actualHomeScore: number | null;
  actualAwayScore: number | null;
  resultCorrect: boolean | null;
}

export interface GroupPrediction {
  group: string;
  teams: GroupTeamPrediction[];
}

export interface GroupTeamPrediction {
  team: string;
  rating: number;
  avgWinProb: number;
  avgDrawProb: number;
  avgLossProb: number;
  predictedPoints: number;
  predictedGoalsFor: number;
  predictedGoalsAgainst: number;
}

export interface KnockoutPrediction {
  round: string;
  match: string;
  homeTeam: string;
  awayTeam: string;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  predictedWinner: string;
}

export interface PredictionAccuracy {
  total: number;
  correct: number;
  accuracy: number;
  homeWins: number;
  draws: number;
  awayWins: number;
}

export interface CollectorStatus {
  status: string;
  currentSeason: string;
  supportedLeagues: string[];
  availableSources: string[];
}

export const api = {
  elo: {
    calculate: (
      startDate?: string,
      endDate?: string,
      kFactor?: string,
      homeAdvantage?: string,
    ) =>
      request<{
        totalMatches: number;
        totalTeams: number;
        topTeams: EloRating[];
      }>(
        `/elo/calculate${buildQuery({ startDate, endDate, kFactor, homeAdvantage })}`,
        { method: 'POST' },
      ),
    getRankings: (page = 1, limit = 50) =>
      request<{ data: EloRating[]; total: number }>(
        `/elo/rankings?page=${page}&limit=${limit}`,
      ),
    getTeamRating: (name: string) =>
      request<EloRating | { error: string } | null>(
        `/elo/team?name=${encodeURIComponent(name)}`,
      ),
    getTeamHistory: (name: string, limit = 50) =>
      request<EloHistory[] | { error: string }>(
        `/elo/history?name=${encodeURIComponent(name)}&limit=${limit}`,
      ),
    predictMatch: (home: string, away: string, neutral = false) =>
      request<MatchPrediction | { error: string } | null>(
        `/elo/predict?home=${encodeURIComponent(home)}&away=${encodeURIComponent(away)}&neutral=${neutral}`,
      ),
    recalculate: () =>
      request<{
        totalMatches: number;
        totalTeams: number;
        topTeams: EloRating[];
      }>('/elo/recalculate', { method: 'POST' }),
  },
  wc: {
    generatePredictions: () =>
      request<{
        totalMatches: number;
        predictions: WcPrediction[];
        groupPredictions: GroupPrediction[];
      }>('/wc/predict', { method: 'POST' }),
    getPredictions: (group?: string, round?: number) =>
      request<WcPrediction[]>(
        `/wc/predictions${buildQuery({ group, round: round?.toString() })}`,
      ),
    getGroupPredictions: () => request<GroupPrediction[]>('/wc/groups'),
    getKnockoutPredictions: () => request<KnockoutPrediction[]>('/wc/knockout'),
    getAccuracy: () => request<PredictionAccuracy>('/wc/accuracy'),
    updateResult: (
      homeTeam: string,
      awayTeam: string,
      homeScore: number,
      awayScore: number,
    ) =>
      request<any>('/wc/result', {
        method: 'POST',
        body: JSON.stringify({ homeTeam, awayTeam, homeScore, awayScore }),
      }),
  },
  collector: {
    getStatus: () => request<CollectorStatus>('/collector/status'),
    collectAll: (season?: string, source = 'csv') =>
      request<{
        season: string;
        source: string;
        results: Record<string, number>;
      }>(`/collector/all${buildQuery({ season, source })}`),
  },
};

function buildQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, value);
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}
