import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';
import { EloRating } from './elo-rating.entity';
import { EloHistory } from './elo-history.entity';

export interface EloCalculationConfig {
  initialRating: number;
  kFactor: number;
  homeAdvantage: number;
  tournamentWeights: Record<string, number>;
  goalMultiplier: boolean;
}

export interface InternationalMatch {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  tournament: string;
  city: string;
  country: string;
  neutral: boolean;
}

export interface TeamEloSnapshot {
  teamName: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
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

const DEFAULT_CONFIG: EloCalculationConfig = {
  initialRating: 1500,
  kFactor: 32,
  homeAdvantage: 100,
  tournamentWeights: {
    'FIFA World Cup': 1.5,
    'FIFA World Cup qualification': 1.2,
    'UEFA Euro': 1.4,
    'UEFA Euro qualification': 1.15,
    'Copa América': 1.4,
    'African Cup of Nations': 1.3,
    'AFC Asian Cup': 1.3,
    'CONCACAF Gold Cup': 1.2,
    'UEFA Nations League': 1.1,
    Friendly: 0.7,
  },
  goalMultiplier: true,
};

@Injectable()
export class EloService {
  private readonly logger = new Logger(EloService.name);
  private config: EloCalculationConfig = DEFAULT_CONFIG;

  private ratings: Map<string, TeamEloSnapshot> = new Map();

  constructor(
    @InjectRepository(EloRating)
    private readonly eloRatingRepository: Repository<EloRating>,
    @InjectRepository(EloHistory)
    private readonly eloHistoryRepository: Repository<EloHistory>,
  ) {}

  async calculateFromInternationalData(
    startDate?: string,
    endDate?: string,
    config?: Partial<EloCalculationConfig>,
  ): Promise<{
    totalMatches: number;
    totalTeams: number;
    topTeams: TeamEloSnapshot[];
  }> {
    if (config) {
      this.config = { ...DEFAULT_CONFIG, ...config };
    }

    this.ratings = new Map();

    const matches = await this.loadInternationalMatches();
    this.logger.log(`加载了 ${matches.length} 场国际比赛数据`);

    const filteredMatches = matches.filter((m) => {
      if (startDate && m.date < startDate) return false;
      if (endDate && m.date > endDate) return false;
      return true;
    });

    this.logger.log(`过滤后剩余 ${filteredMatches.length} 场比赛`);

    const sortedMatches = filteredMatches.sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    const historyBatch: Partial<EloHistory>[] = [];
    const BATCH_SIZE = 500;

    for (const match of sortedMatches) {
      const result = this.processMatch(match);
      if (result) {
        historyBatch.push(result);

        if (historyBatch.length >= BATCH_SIZE) {
          await this.saveHistoryBatch(historyBatch);
          historyBatch.length = 0;
        }
      }
    }

    if (historyBatch.length > 0) {
      await this.saveHistoryBatch(historyBatch);
    }

    await this.saveRatingsToDb();

    const topTeams = this.getTopTeams(20);

    return {
      totalMatches: sortedMatches.length,
      totalTeams: this.ratings.size,
      topTeams,
    };
  }

  private processMatch(match: InternationalMatch): Partial<EloHistory> | null {
    const homeSnapshot = this.getOrCreateTeam(match.homeTeam);
    const awaySnapshot = this.getOrCreateTeam(match.awayTeam);

    const homeRatingBefore = homeSnapshot.rating;
    const awayRatingBefore = awaySnapshot.rating;

    const effectiveHomeRating = match.neutral
      ? homeRatingBefore
      : homeRatingBefore + this.config.homeAdvantage;

    const expectedHome = this.expectedScore(
      effectiveHomeRating,
      awayRatingBefore,
    );
    const expectedAway = 1 - expectedHome;

    let actualHome: number;
    let actualAway: number;
    let resultChar: string;

    if (match.homeScore > match.awayScore) {
      actualHome = 1;
      actualAway = 0;
      resultChar = 'W';
    } else if (match.homeScore < match.awayScore) {
      actualHome = 0;
      actualAway = 1;
      resultChar = 'L';
    } else {
      actualHome = 0.5;
      actualAway = 0.5;
      resultChar = 'D';
    }

    const tournamentWeight = this.getTournamentWeight(match.tournament);
    const goalFactor = this.config.goalMultiplier
      ? this.goalMultiplierFactor(match.homeScore, match.awayScore)
      : 1;

    const effectiveK = this.config.kFactor * tournamentWeight * goalFactor;

    const homeRatingChange = effectiveK * (actualHome - expectedHome);
    const awayRatingChange = effectiveK * (actualAway - expectedAway);

    homeSnapshot.rating = homeRatingBefore + homeRatingChange;
    awaySnapshot.rating = awayRatingBefore + awayRatingChange;

    homeSnapshot.gamesPlayed++;
    awaySnapshot.gamesPlayed++;

    homeSnapshot.goalsFor += match.homeScore;
    homeSnapshot.goalsAgainst += match.awayScore;
    awaySnapshot.goalsFor += match.awayScore;
    awaySnapshot.goalsAgainst += match.homeScore;

    if (resultChar === 'W') {
      homeSnapshot.wins++;
      awaySnapshot.losses++;
    } else if (resultChar === 'L') {
      homeSnapshot.losses++;
      awaySnapshot.wins++;
    } else {
      homeSnapshot.draws++;
      awaySnapshot.draws++;
    }

    homeSnapshot.rating = Math.round(homeSnapshot.rating * 10) / 10;
    awaySnapshot.rating = Math.round(awaySnapshot.rating * 10) / 10;

    this.ratings.set(match.homeTeam, homeSnapshot);
    this.ratings.set(match.awayTeam, awaySnapshot);

    return {
      teamName: match.homeTeam,
      rating: homeSnapshot.rating,
      ratingChange: Math.round(homeRatingChange * 10) / 10,
      opponentName: match.awayTeam,
      opponentRating: awayRatingBefore,
      result: resultChar === 'W' ? 'W' : resultChar === 'L' ? 'L' : 'D',
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      isHome: true,
      tournament: match.tournament,
      matchDate: match.date,
      calculationDate: new Date().toISOString().split('T')[0],
    };
  }

  private getOrCreateTeam(teamName: string): TeamEloSnapshot {
    let snapshot = this.ratings.get(teamName);
    if (!snapshot) {
      snapshot = {
        teamName,
        rating: this.config.initialRating,
        gamesPlayed: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
      };
    }
    return { ...snapshot };
  }

  expectedScore(ratingA: number, ratingB: number): number {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  }

  private getTournamentWeight(tournament: string): number {
    for (const [key, weight] of Object.entries(this.config.tournamentWeights)) {
      if (tournament.includes(key)) {
        return weight;
      }
    }
    return 1.0;
  }

  private goalMultiplierFactor(homeScore: number, awayScore: number): number {
    const goalDiff = Math.abs(homeScore - awayScore);
    if (goalDiff <= 1) return 1;
    if (goalDiff === 2) return 1.5;
    return (11 + goalDiff) / 8;
  }

  private async loadInternationalMatches(): Promise<InternationalMatch[]> {
    const filePath = path.join(
      process.cwd(),
      'data',
      'csv',
      'international_results.csv',
    );

    if (!fs.existsSync(filePath)) {
      this.logger.error(
        `国际比赛数据文件不存在: ${filePath}，请先从 Kaggle 下载`,
      );
      return [];
    }

    return new Promise((resolve, reject) => {
      const matches: InternationalMatch[] = [];

      fs.createReadStream(filePath, { encoding: 'utf-8' })
        .pipe(
          parse({
            columns: true,
            skip_empty_lines: true,
            trim: true,
          }),
        )
        .on('data', (record: Record<string, string>) => {
          const homeScore = parseInt(record['home_score'], 10);
          const awayScore = parseInt(record['away_score'], 10);

          if (isNaN(homeScore) || isNaN(awayScore)) return;

          matches.push({
            date: record['date'],
            homeTeam: record['home_team']?.trim() || '',
            awayTeam: record['away_team']?.trim() || '',
            homeScore,
            awayScore,
            tournament: record['tournament']?.trim() || 'Unknown',
            city: record['city']?.trim() || '',
            country: record['country']?.trim() || '',
            neutral: record['neutral']?.toUpperCase() === 'TRUE',
          });
        })
        .on('end', () => resolve(matches))
        .on('error', (error: Error) => reject(error));
    });
  }

  private async saveHistoryBatch(
    historyBatch: Partial<EloHistory>[],
  ): Promise<void> {
    try {
      const entities = historyBatch.map((h) => {
        const entity = new EloHistory();
        Object.assign(entity, h);
        return entity;
      });
      await this.eloHistoryRepository.insert(entities);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`保存历史记录失败: ${msg}`);
    }
  }

  private async saveRatingsToDb(): Promise<void> {
    const entities: EloRating[] = [];

    for (const snapshot of this.ratings.values()) {
      const entity = new EloRating();
      entity.teamName = snapshot.teamName;
      entity.rating = snapshot.rating;
      entity.gamesPlayed = snapshot.gamesPlayed;
      entity.wins = snapshot.wins;
      entity.draws = snapshot.draws;
      entity.losses = snapshot.losses;
      entity.goalsFor = snapshot.goalsFor;
      entity.goalsAgainst = snapshot.goalsAgainst;
      entities.push(entity);
    }

    const BATCH_SIZE = 100;
    for (let i = 0; i < entities.length; i += BATCH_SIZE) {
      const batch = entities.slice(i, i + BATCH_SIZE);
      await this.eloRatingRepository.upsert(batch, {
        conflictPaths: ['teamName'],
      });
    }

    this.logger.log(`已保存 ${entities.length} 支球队的 ELO 积分`);
  }

  getTopTeams(limit: number = 20): TeamEloSnapshot[] {
    return Array.from(this.ratings.values())
      .sort((a, b) => b.rating - a.rating)
      .slice(0, limit);
  }

  async getTeamRating(teamName: string): Promise<TeamEloSnapshot | null> {
    const entity = await this.eloRatingRepository.findOne({
      where: { teamName },
    });

    if (!entity) return null;

    return {
      teamName: entity.teamName,
      rating: entity.rating,
      gamesPlayed: entity.gamesPlayed,
      wins: entity.wins,
      draws: entity.draws,
      losses: entity.losses,
      goalsFor: entity.goalsFor,
      goalsAgainst: entity.goalsAgainst,
    };
  }

  async getTeamHistory(
    teamName: string,
    limit: number = 50,
  ): Promise<EloHistory[]> {
    return this.eloHistoryRepository.find({
      where: { teamName },
      order: { matchDate: 'DESC' },
      take: limit,
    });
  }

  async getAllRatings(
    page: number = 1,
    limit: number = 50,
  ): Promise<{ data: EloRating[]; total: number }> {
    const [data, total] = await this.eloRatingRepository.findAndCount({
      order: { rating: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total };
  }

  async predictMatch(
    homeTeam: string,
    awayTeam: string,
    neutral: boolean = false,
  ): Promise<MatchPrediction | null> {
    const homeRatingEntity = await this.eloRatingRepository.findOne({
      where: { teamName: homeTeam },
    });
    const awayRatingEntity = await this.eloRatingRepository.findOne({
      where: { teamName: awayTeam },
    });

    if (!homeRatingEntity || !awayRatingEntity) {
      return null;
    }

    const homeRating = homeRatingEntity.rating;
    const awayRating = awayRatingEntity.rating;

    const homeAdvantage = neutral ? 0 : this.config.homeAdvantage;
    const effectiveHomeRating = homeRating + homeAdvantage;

    const homeWinProb = this.expectedScore(effectiveHomeRating, awayRating);
    const awayWinProb = this.expectedScore(awayRating, effectiveHomeRating);

    const drawProb = this.estimateDrawProbability(
      homeWinProb,
      awayWinProb,
      homeRating,
      awayRating,
    );

    const scaledHomeWin = homeWinProb * (1 - drawProb);
    const scaledAwayWin = awayWinProb * (1 - drawProb);

    return {
      homeTeam,
      awayTeam,
      homeRating,
      awayRating,
      homeWinProbability: Math.round(scaledHomeWin * 1000) / 1000,
      drawProbability: Math.round(drawProb * 1000) / 1000,
      awayWinProbability: Math.round(scaledAwayWin * 1000) / 1000,
      homeAdvantage,
    };
  }

  private estimateDrawProbability(
    homeWinProb: number,
    awayWinProb: number,
    homeRating: number,
    awayRating: number,
  ): number {
    const ratingDiff = Math.abs(homeRating - awayRating);
    const baseDrawRate = 0.26;

    const drawReduction = ratingDiff / 4000;

    let drawProb = baseDrawRate - drawReduction;

    drawProb = Math.max(0.1, Math.min(0.35, drawProb));

    return drawProb;
  }

  async recalculateFromDbMatches(): Promise<{
    totalMatches: number;
    totalTeams: number;
    topTeams: TeamEloSnapshot[];
  }> {
    this.logger.log('从数据库中的国际比赛数据重新计算 ELO...');

    await this.eloRatingRepository.clear();
    await this.eloHistoryRepository.clear();

    return this.calculateFromInternationalData();
  }
}
