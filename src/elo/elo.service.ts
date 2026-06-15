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

  async predictAdvanced(body: {
    homeTeam: string;
    awayTeam: string;
    neutral: boolean;
    kFactor: number;
    homeAdvantage: number;
    weatherWeight: number;
    refereeWeight: number;
    weatherCondition: string;
    refereeStrictness: string;
    homeForm: number;
    awayForm: number;
    homeStarPower: number;
    awayStarPower: number;
    homeTactics: string;
    awayTactics: string;
    homeFatigue: number;
    awayFatigue: number;
    homePressure: number;
    awayPressure: number;
    fairnessWeight: number;
    fifaWeight: number;
    bookmakerWeight: number;
  }): Promise<{
    homeTeam: string;
    awayTeam: string;
    homeRating: number;
    awayRating: number;
    homeWinProbability: number;
    drawProbability: number;
    awayWinProbability: number;
    homeAdvantage: number;
    predictedHomeScore: number;
    predictedAwayScore: number;
    weatherEffect: number;
    refereeEffect: number;
    formEffect: number;
    starEffect: number;
    tacticsEffect: number;
    fatigueEffect: number;
    pressureEffect: number;
    fairnessEffect: number;
    fifaEffect: number;
    bookmakerEffect: number;
  } | null> {
    const homeRatingEntity = await this.eloRatingRepository.findOne({
      where: { teamName: body.homeTeam },
    });
    const awayRatingEntity = await this.eloRatingRepository.findOne({
      where: { teamName: body.awayTeam },
    });

    if (!homeRatingEntity || !awayRatingEntity) {
      return null;
    }

    const homeRating = homeRatingEntity.rating;
    const awayRating = awayRatingEntity.rating;

    const homeAdv = body.neutral ? 0 : body.homeAdvantage;

    const formEffect = this.calculateFormEffect(body.homeForm, body.awayForm);
    const starEffect = this.calculateStarPowerEffect(
      body.homeStarPower,
      body.awayStarPower,
    );
    const tacticsEffect = this.calculateTacticsEffect(
      body.homeTactics,
      body.awayTactics,
    );
    const fatigueEffect = this.calculateFatigueEffect(
      body.homeFatigue,
      body.awayFatigue,
    );
    const pressureEffect = this.calculatePressureEffect(
      body.homePressure,
      body.awayPressure,
    );

    const effectiveHomeRating =
      homeRating +
      homeAdv +
      formEffect * 50 +
      starEffect * 45 +
      tacticsEffect * 35 +
      fatigueEffect * 35 +
      pressureEffect * 30;
    const effectiveAwayRating =
      awayRating -
      formEffect * 50 -
      starEffect * 45 -
      tacticsEffect * 35 -
      fatigueEffect * 35 -
      pressureEffect * 30;

    const homeWinProb = this.expectedScore(
      effectiveHomeRating,
      effectiveAwayRating,
    );
    const awayWinProb = this.expectedScore(
      effectiveAwayRating,
      effectiveHomeRating,
    );

    let drawProb = this.estimateDrawProbability(
      homeWinProb,
      awayWinProb,
      effectiveHomeRating,
      effectiveAwayRating,
    );

    const weatherEffect = this.calculateWeatherEffect(
      body.weatherCondition,
      body.weatherWeight,
      effectiveHomeRating,
      effectiveAwayRating,
    );

    const refereeEffect = this.calculateRefereeEffect(
      body.refereeStrictness,
      body.refereeWeight,
    );

    let adjustedHomeWin = homeWinProb * (1 - drawProb);
    let adjustedAwayWin = awayWinProb * (1 - drawProb);

    adjustedHomeWin += weatherEffect;
    adjustedAwayWin -= weatherEffect;
    drawProb += refereeEffect;

    const fairnessEffect = this.calculateFairnessEffect(
      body.fairnessWeight,
      adjustedHomeWin,
      adjustedAwayWin,
    );
    const fifaEffect = this.calculateFifaEffect(
      body.fifaWeight,
      homeRating,
      awayRating,
      adjustedHomeWin,
      adjustedAwayWin,
    );
    const bookmakerEffect = this.calculateBookmakerEffect(
      body.bookmakerWeight,
      adjustedHomeWin,
      adjustedAwayWin,
      drawProb,
    );

    adjustedHomeWin += fairnessEffect + fifaEffect + bookmakerEffect.homeShift;
    adjustedAwayWin -= fairnessEffect + fifaEffect + bookmakerEffect.homeShift;
    drawProb += bookmakerEffect.drawShift;

    adjustedHomeWin = Math.max(0.01, adjustedHomeWin);
    adjustedAwayWin = Math.max(0.01, adjustedAwayWin);
    drawProb = Math.max(0.05, Math.min(0.4, drawProb));

    const total = adjustedHomeWin + adjustedAwayWin + drawProb;
    adjustedHomeWin /= total;
    adjustedAwayWin /= total;
    drawProb /= total;

    const { homeGoals, awayGoals } = this.predictScoreAdvanced(
      adjustedHomeWin,
      drawProb,
      adjustedAwayWin,
      effectiveHomeRating,
      effectiveAwayRating,
      weatherEffect,
      refereeEffect,
    );

    return {
      homeTeam: body.homeTeam,
      awayTeam: body.awayTeam,
      homeRating,
      awayRating,
      homeWinProbability: Math.round(adjustedHomeWin * 1000) / 1000,
      drawProbability: Math.round(drawProb * 1000) / 1000,
      awayWinProbability: Math.round(adjustedAwayWin * 1000) / 1000,
      homeAdvantage: homeAdv,
      predictedHomeScore: homeGoals,
      predictedAwayScore: awayGoals,
      weatherEffect: Math.round(weatherEffect * 1000) / 1000,
      refereeEffect: Math.round(refereeEffect * 1000) / 1000,
      formEffect: Math.round(formEffect * 1000) / 1000,
      starEffect: Math.round(starEffect * 1000) / 1000,
      tacticsEffect: Math.round(tacticsEffect * 1000) / 1000,
      fatigueEffect: Math.round(fatigueEffect * 1000) / 1000,
      pressureEffect: Math.round(pressureEffect * 1000) / 1000,
      fairnessEffect: Math.round(fairnessEffect * 1000) / 1000,
      fifaEffect: Math.round(fifaEffect * 1000) / 1000,
      bookmakerEffect: Math.round(bookmakerEffect.homeShift * 1000) / 1000,
    };
  }

  private calculateFormEffect(homeForm: number, awayForm: number): number {
    return (homeForm - awayForm) / 10;
  }

  private calculateStarPowerEffect(
    homeStarPower: number,
    awayStarPower: number,
  ): number {
    return (homeStarPower - awayStarPower) / 10;
  }

  private calculateTacticsEffect(
    homeTactics: string,
    awayTactics: string,
  ): number {
    const tacticsMap: Record<string, number> = {
      attacking: 0.35,
      balanced: 0,
      defensive: -0.25,
    };
    return (tacticsMap[homeTactics] || 0) - (tacticsMap[awayTactics] || 0);
  }

  private calculateFatigueEffect(
    homeFatigue: number,
    awayFatigue: number,
  ): number {
    return (awayFatigue - homeFatigue) / 10;
  }

  private calculatePressureEffect(
    homePressure: number,
    awayPressure: number,
  ): number {
    return (awayPressure - homePressure) / 10;
  }

  private calculateFairnessEffect(
    fairnessWeight: number,
    homeWin: number,
    awayWin: number,
  ): number {
    const imbalance = homeWin - awayWin;
    return -imbalance * 0.15 * fairnessWeight;
  }

  private calculateFifaEffect(
    fifaWeight: number,
    homeRating: number,
    awayRating: number,
    homeWin: number,
    awayWin: number,
  ): number {
    const ratingDiff = homeRating - awayRating;
    const strongerSide = ratingDiff > 0 ? 1 : -1;
    const commercialBoost = strongerSide * 0.06 * fifaWeight;
    const isClose = Math.abs(homeWin - awayWin) < 0.1;
    const excitementBonus = isClose ? 0 : strongerSide * 0.03 * fifaWeight;
    return commercialBoost + excitementBonus;
  }

  private calculateBookmakerEffect(
    bookmakerWeight: number,
    homeWin: number,
    awayWin: number,
    drawProb: number,
  ): { homeShift: number; drawShift: number } {
    const imbalance = homeWin - awayWin;
    const homeShift = -imbalance * 0.08 * bookmakerWeight;
    const drawShift = 0.05 * bookmakerWeight;
    return { homeShift, drawShift };
  }

  private calculateWeatherEffect(
    condition: string,
    weight: number,
    homeRating: number,
    awayRating: number,
  ): number {
    const weatherImpact: Record<string, number> = {
      sunny: 0,
      cloudy: 0,
      rainy: -0.08,
      heavy_rain: -0.15,
      snowy: -0.12,
      windy: -0.1,
      hot: -0.06,
      cold: -0.08,
      humid: -0.05,
    };

    const baseEffect = weatherImpact[condition] || 0;

    const ratingDiff = homeRating - awayRating;
    const direction = ratingDiff > 0 ? -1 : 1;

    return baseEffect * weight * direction;
  }

  private calculateRefereeEffect(strictness: string, weight: number): number {
    const strictnessImpact: Record<string, number> = {
      lenient: 0.06,
      average: 0,
      strict: -0.06,
      very_strict: -0.1,
    };

    return (strictnessImpact[strictness] || 0) * weight;
  }

  private predictScoreAdvanced(
    homeWinProb: number,
    drawProb: number,
    awayWinProb: number,
    homeRating: number,
    awayRating: number,
    weatherEffect: number,
    refereeEffect: number,
  ): { homeGoals: number; awayGoals: number } {
    const ratingDiff = homeRating - awayRating;
    const baseGoals = 1.3;

    let homeExpected = baseGoals + ratingDiff / 800;
    let awayExpected = baseGoals - ratingDiff / 800;

    homeExpected = Math.max(0.3, homeExpected);
    awayExpected = Math.max(0.3, awayExpected);

    if (homeWinProb > awayWinProb + 0.15) {
      homeExpected += 0.4;
    } else if (awayWinProb > homeWinProb + 0.15) {
      awayExpected += 0.4;
    }

    if (drawProb > 0.28) {
      const avg = (homeExpected + awayExpected) / 2;
      homeExpected = homeExpected * 0.6 + avg * 0.4;
      awayExpected = awayExpected * 0.6 + avg * 0.4;
    }

    homeExpected += weatherEffect * 2;
    awayExpected -= weatherEffect * 2;

    if (refereeEffect < 0) {
      homeExpected -= 0.1;
      awayExpected -= 0.1;
    }

    return {
      homeGoals: Math.max(0, Math.round(homeExpected * 10) / 10),
      awayGoals: Math.max(0, Math.round(awayExpected * 10) / 10),
    };
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

  async updateEloForMatch(
    homeTeam: string,
    awayTeam: string,
    homeScore: number,
    awayScore: number,
    neutral: boolean = true,
    tournament: string = 'FIFA World Cup',
  ): Promise<{
    homeRatingBefore: number;
    awayRatingBefore: number;
    homeRatingAfter: number;
    awayRatingAfter: number;
  } | null> {
    const homeEntity = await this.eloRatingRepository.findOne({
      where: { teamName: homeTeam },
    });
    const awayEntity = await this.eloRatingRepository.findOne({
      where: { teamName: awayTeam },
    });

    if (!homeEntity || !awayEntity) {
      this.logger.warn(
        `无法增量更新ELO: ${homeTeam}(${homeEntity ? '✓' : '✗'}) vs ${awayTeam}(${awayEntity ? '✓' : '✗'})`,
      );
      return null;
    }

    const homeRatingBefore = homeEntity.rating;
    const awayRatingBefore = awayEntity.rating;

    const homeAdv = neutral ? 0 : this.config.homeAdvantage;
    const effectiveHomeRating = homeRatingBefore + homeAdv;

    const expectedHome = this.expectedScore(
      effectiveHomeRating,
      awayRatingBefore,
    );
    const expectedAway = 1 - expectedHome;

    let actualHome: number;
    let actualAway: number;
    if (homeScore > awayScore) {
      actualHome = 1;
      actualAway = 0;
    } else if (homeScore < awayScore) {
      actualHome = 0;
      actualAway = 1;
    } else {
      actualHome = 0.5;
      actualAway = 0.5;
    }

    const tournamentWeight = this.getTournamentWeight(tournament);
    const goalFactor = this.goalMultiplierFactor(homeScore, awayScore);
    const effectiveK = this.config.kFactor * tournamentWeight * goalFactor;

    const homeRatingChange = effectiveK * (actualHome - expectedHome);
    const awayRatingChange = effectiveK * (actualAway - expectedAway);

    const homeRatingAfter =
      Math.round((homeRatingBefore + homeRatingChange) * 10) / 10;
    const awayRatingAfter =
      Math.round((awayRatingBefore + awayRatingChange) * 10) / 10;

    homeEntity.rating = homeRatingAfter;
    awayEntity.rating = awayRatingAfter;

    if (homeScore > awayScore) {
      homeEntity.wins++;
      awayEntity.losses++;
    } else if (homeScore < awayScore) {
      homeEntity.losses++;
      awayEntity.wins++;
    } else {
      homeEntity.draws++;
      awayEntity.draws++;
    }
    homeEntity.gamesPlayed++;
    awayEntity.gamesPlayed++;
    homeEntity.goalsFor += homeScore;
    homeEntity.goalsAgainst += awayScore;
    awayEntity.goalsFor += awayScore;
    awayEntity.goalsAgainst += homeScore;

    await this.eloRatingRepository.save([homeEntity, awayEntity]);

    const resultChar =
      homeScore > awayScore ? 'W' : homeScore < awayScore ? 'L' : 'D';
    const history = new EloHistory();
    history.teamName = homeTeam;
    history.rating = homeRatingAfter;
    history.ratingChange = Math.round(homeRatingChange * 10) / 10;
    history.opponentName = awayTeam;
    history.opponentRating = awayRatingBefore;
    history.result = resultChar;
    history.homeScore = homeScore;
    history.awayScore = awayScore;
    history.isHome = !neutral;
    history.tournament = tournament;
    history.matchDate = new Date().toISOString().split('T')[0];
    history.calculationDate = new Date().toISOString().split('T')[0];

    try {
      await this.eloHistoryRepository.insert(history);
    } catch (err: any) {
      this.logger.warn(`保存ELO历史记录失败: ${err.message}`);
    }

    this.logger.log(
      `ELO增量更新: ${homeTeam} ${homeRatingBefore}->${homeRatingAfter} (${homeRatingChange > 0 ? '+' : ''}${Math.round(homeRatingChange * 10) / 10}), ${awayTeam} ${awayRatingBefore}->${awayRatingAfter} (${awayRatingChange > 0 ? '+' : ''}${Math.round(awayRatingChange * 10) / 10})`,
    );

    return {
      homeRatingBefore,
      awayRatingBefore,
      homeRatingAfter,
      awayRatingAfter,
    };
  }
}
