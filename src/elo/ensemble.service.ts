import { Injectable, Logger } from '@nestjs/common';
import { EloService } from './elo.service';
import { OddsService } from './odds.service';
import { PoissonService } from './poisson.service';
import { StackingService, BaseModelOutput } from './stacking.service';
import { MatchParams } from './match-params.entity';

export interface ParamWeights {
  formWeight: number;
  starPowerWeight: number;
  tacticsWeight: number;
  fatigueWeight: number;
  pressureWeight: number;
  injuryWeight: number;
  stakesWeight: number;
  weatherWeight: number;
  refereeWeight: number;
}

export interface EnsemblePrediction {
  homeTeam: string;
  awayTeam: string;
  homeRating: number;
  awayRating: number;
  homeAdvantage: number;

  finalHomeWin: number;
  finalDraw: number;
  finalAwayWin: number;

  predictedHomeScore: number;
  predictedAwayScore: number;

  individualModels: {
    elo: { homeWin: number; draw: number; awayWin: number };
    odds: { homeWin: number; draw: number; awayWin: number };
    poisson: {
      homeWin: number;
      draw: number;
      awayWin: number;
      homeGoalsExpected: number;
      awayGoalsExpected: number;
      mostLikelyScore: string;
    };
  };

  modelContributions: Array<{
    modelName: string;
    weight: number;
    contribution: number;
  }>;

  confidence: 'high' | 'medium' | 'low';
}

@Injectable()
export class EnsembleService {
  private readonly logger = new Logger(EnsembleService.name);

  private readonly teamNameMap: Record<string, string> = {
    USA: 'United States',
    'Bosnia & Herzegovina': 'Bosnia and Herzegovina',
    'South Korea': 'South Korea',
    "Côte d'Ivoire": 'Ivory Coast',
    'Cape Verde Islands': 'Cape Verde',
    'Kyrgyz Republic': 'Kyrgyzstan',
    Macedonia: 'North Macedonia',
    Eswatini: 'Swaziland',
    Türkiye: 'Turkey',
  };

  resolveTeamName(name: string): string {
    return this.teamNameMap[name] || name;
  }

  constructor(
    private readonly eloService: EloService,
    private readonly oddsService: OddsService,
    private readonly poissonService: PoissonService,
    private readonly stackingService: StackingService,
  ) {}

  /**
   * 三模型集成预测主入口
   * 集成 ELO + 赔率 + Dixon-Coles 泊松
   */
  async predict(
    homeTeam: string,
    awayTeam: string,
    neutral: boolean = false,
  ): Promise<EnsemblePrediction | null> {
    const resolvedHome = this.resolveTeamName(homeTeam);
    const resolvedAway = this.resolveTeamName(awayTeam);
    const homeAdvantage = neutral ? 0 : 100;

    const eloPrediction = await this.eloService.predictMatch(
      resolvedHome,
      resolvedAway,
      neutral,
    );

    if (!eloPrediction) {
      this.logger.warn(`ELO 预测失败: ${homeTeam} vs ${awayTeam}`);
      return null;
    }

    const homeRating = eloPrediction.homeRating;
    const awayRating = eloPrediction.awayRating;

    const oddsProbability = this.oddsService.oddsImpliedFromElo(
      homeRating,
      awayRating,
      homeAdvantage,
    );

    const poissonStrengths = this.poissonService.estimateStrengthsFromElo(
      homeRating,
      awayRating,
    );

    const poissonPrediction = this.poissonService.predict(
      poissonStrengths.home.attack,
      poissonStrengths.home.defense,
      poissonStrengths.away.attack,
      poissonStrengths.away.defense,
      neutral,
    );

    const baseModels: BaseModelOutput[] = [
      {
        name: 'elo',
        homeWin: eloPrediction.homeWinProbability,
        draw: eloPrediction.drawProbability,
        awayWin: eloPrediction.awayWinProbability,
      },
      {
        name: 'odds',
        homeWin: oddsProbability.homeWin,
        draw: oddsProbability.draw,
        awayWin: oddsProbability.awayWin,
      },
      {
        name: 'poisson',
        homeWin: poissonPrediction.homeWinProb,
        draw: poissonPrediction.drawProb,
        awayWin: poissonPrediction.awayWinProb,
      },
    ];

    const stackingResult = this.stackingService.predict({
      baseModels,
      features: {
        eloRatingDiff: homeRating - awayRating,
        homeAdvantage,
        squadValueDiff: 0,
        isNeutral: neutral,
        tournamentWeight: 1.5,
      },
    });

    const { homeGoals, awayGoals } = this.predictScore(
      stackingResult.homeWin,
      stackingResult.draw,
      stackingResult.awayWin,
      homeRating,
      awayRating,
      poissonPrediction.homeGoalsExpected,
      poissonPrediction.awayGoalsExpected,
    );

    const confidence = this.computeConfidence(
      baseModels,
      stackingResult,
      homeRating,
      awayRating,
    );

    return {
      homeTeam,
      awayTeam,
      homeRating,
      awayRating,
      homeAdvantage,

      finalHomeWin: stackingResult.homeWin,
      finalDraw: stackingResult.draw,
      finalAwayWin: stackingResult.awayWin,

      predictedHomeScore: homeGoals,
      predictedAwayScore: awayGoals,

      individualModels: {
        elo: {
          homeWin: eloPrediction.homeWinProbability,
          draw: eloPrediction.drawProbability,
          awayWin: eloPrediction.awayWinProbability,
        },
        odds: {
          homeWin: oddsProbability.homeWin,
          draw: oddsProbability.draw,
          awayWin: oddsProbability.awayWin,
        },
        poisson: {
          homeWin: poissonPrediction.homeWinProb,
          draw: poissonPrediction.drawProb,
          awayWin: poissonPrediction.awayWinProb,
          homeGoalsExpected: poissonPrediction.homeGoalsExpected,
          awayGoalsExpected: poissonPrediction.awayGoalsExpected,
          mostLikelyScore: poissonPrediction.mostLikelyScore,
        },
      },

      modelContributions: stackingResult.modelContributions,
      confidence,
    };
  }

  /**
   * 快速集成预测（仅 ELO + 赔率，跳过泊松以提升性能）
   */
  async predictQuick(
    homeTeam: string,
    awayTeam: string,
    neutral: boolean = false,
  ): Promise<{
    homeWin: number;
    draw: number;
    awayWin: number;
  } | null> {
    const resolvedHome = this.resolveTeamName(homeTeam);
    const resolvedAway = this.resolveTeamName(awayTeam);

    const eloPrediction = await this.eloService.predictMatch(
      resolvedHome,
      resolvedAway,
      neutral,
    );

    if (!eloPrediction) {
      return null;
    }

    const homeAdvantage = neutral ? 0 : 100;
    const oddsProbability = this.oddsService.oddsImpliedFromElo(
      eloPrediction.homeRating,
      eloPrediction.awayRating,
      homeAdvantage,
    );

    return this.oddsService.combineWithElo(
      eloPrediction.homeWinProbability,
      eloPrediction.drawProbability,
      eloPrediction.awayWinProbability,
      oddsProbability.homeWin,
      oddsProbability.draw,
      oddsProbability.awayWin,
    );
  }

  /**
   * 带调参参数的集成预测
   * 将 MatchParams 中的量化参数融入比分预测
   */
  async predictWithParams(
    homeTeam: string,
    awayTeam: string,
    neutral: boolean = false,
    params: MatchParams | null = null,
  ): Promise<EnsemblePrediction | null> {
    const basePrediction = await this.predict(homeTeam, awayTeam, neutral);
    if (!basePrediction) return null;

    if (!params) return basePrediction;

    const poissonHomeExpected =
      basePrediction.individualModels.poisson.homeGoalsExpected;
    const poissonAwayExpected =
      basePrediction.individualModels.poisson.awayGoalsExpected;

    const { homeGoals, awayGoals } = this.predictScoreWithParams(
      basePrediction.finalHomeWin,
      basePrediction.finalDraw,
      basePrediction.finalAwayWin,
      basePrediction.homeRating,
      basePrediction.awayRating,
      poissonHomeExpected,
      poissonAwayExpected,
      params,
      neutral,
    );

    const total = homeGoals + awayGoals;
    const homeWinAdj =
      total > 0 ? homeGoals / total : basePrediction.finalHomeWin;
    const awayWinAdj =
      total > 0 ? awayGoals / total : basePrediction.finalAwayWin;
    const drawAdj = Math.max(0, 1 - homeWinAdj - awayWinAdj);

    const finalTotal = homeWinAdj + drawAdj + awayWinAdj;

    return {
      ...basePrediction,
      finalHomeWin: Math.round((homeWinAdj / finalTotal) * 1000) / 1000,
      finalDraw: Math.round((drawAdj / finalTotal) * 1000) / 1000,
      finalAwayWin: Math.round((awayWinAdj / finalTotal) * 1000) / 1000,
      predictedHomeScore: homeGoals,
      predictedAwayScore: awayGoals,
    };
  }

  /**
   * 参数权重配置（可调优）
   * 每个参数对应一个权重，控制其对预期进球的影响程度
   */
  paramWeights: ParamWeights = {
    formWeight: 0.12,
    starPowerWeight: 0.1,
    tacticsWeight: 0.15,
    fatigueWeight: 0.1,
    pressureWeight: 0.06,
    injuryWeight: 0.12,
    stakesWeight: 0.05,
    weatherWeight: 0.08,
    refereeWeight: 0.06,
  };

  /**
   * 带 MatchParams 的比分预测
   * 将量化参数转化为对预期进球的调整
   */
  private predictScoreWithParams(
    homeWinProb: number,
    drawProb: number,
    awayWinProb: number,
    homeRating: number,
    awayRating: number,
    poissonHomeExpected: number,
    poissonAwayExpected: number,
    params: MatchParams,
    _neutral: boolean,
  ): { homeGoals: number; awayGoals: number } {
    const ratingDiff = homeRating - awayRating;
    const baseGoals = 1.3;

    let homeExpected = baseGoals + ratingDiff / 800;
    let awayExpected = baseGoals - ratingDiff / 800;

    homeExpected = homeExpected * 0.5 + poissonHomeExpected * 0.5;
    awayExpected = awayExpected * 0.5 + poissonAwayExpected * 0.5;

    if (homeWinProb > awayWinProb + 0.1) {
      homeExpected += 0.3;
    } else if (awayWinProb > homeWinProb + 0.1) {
      awayExpected += 0.3;
    }

    if (drawProb > 0.28) {
      const avg = (homeExpected + awayExpected) / 2;
      homeExpected = homeExpected * 0.6 + avg * 0.4;
      awayExpected = awayExpected * 0.6 + avg * 0.4;
    }

    const w = this.paramWeights;

    // 近期状态：状态越好，进球越多，对手进球越少
    homeExpected += (params.homeForm - 5) * w.formWeight * 0.1;
    awayExpected -= (params.homeForm - 5) * w.formWeight * 0.04;
    awayExpected += (params.awayForm - 5) * w.formWeight * 0.1;
    homeExpected -= (params.awayForm - 5) * w.formWeight * 0.04;

    // 球星影响力：球星越多，进球能力越强
    homeExpected += (params.homeStarPower - 5) * w.starPowerWeight * 0.08;
    awayExpected += (params.awayStarPower - 5) * w.starPowerWeight * 0.08;

    // 战术风格：进攻型增加双方进球，防守型减少
    const tacticsGoalImpact: Record<string, { home: number; away: number }> = {
      attacking: { home: 0.2, away: 0.1 },
      defensive: { home: -0.15, away: -0.1 },
      possession: { home: 0.05, away: -0.05 },
      high_press: { home: 0.1, away: 0.05 },
      balanced: { home: 0, away: 0 },
    };
    const homeTacticsImpact = tacticsGoalImpact[params.homeTactics] || {
      home: 0,
      away: 0,
    };
    const awayTacticsImpact = tacticsGoalImpact[params.awayTactics] || {
      home: 0,
      away: 0,
    };
    homeExpected += homeTacticsImpact.home * w.tacticsWeight;
    awayExpected -= homeTacticsImpact.away * w.tacticsWeight;
    awayExpected += awayTacticsImpact.home * w.tacticsWeight;
    homeExpected -= awayTacticsImpact.away * w.tacticsWeight;

    // 疲劳程度：越疲劳，进球越少，防守越差
    homeExpected += (3 - params.homeFatigue) * w.fatigueWeight * 0.08;
    awayExpected += (params.homeFatigue - 3) * w.fatigueWeight * 0.04;
    awayExpected += (3 - params.awayFatigue) * w.fatigueWeight * 0.08;
    homeExpected += (params.awayFatigue - 3) * w.fatigueWeight * 0.04;

    // 心理压力：压力越大，发挥越差
    homeExpected += (5 - params.homePressure) * w.pressureWeight * 0.05;
    awayExpected += (5 - params.awayPressure) * w.pressureWeight * 0.05;

    // 伤病影响：伤病越严重，进球越少，防守越差
    homeExpected += (1 - params.homeInjuryImpact) * w.injuryWeight * 0.1;
    awayExpected += (params.homeInjuryImpact - 1) * w.injuryWeight * 0.05;
    awayExpected += (1 - params.awayInjuryImpact) * w.injuryWeight * 0.1;
    homeExpected += (params.awayInjuryImpact - 1) * w.injuryWeight * 0.05;

    // 比赛重要性：重要性越高，进球可能略多（更拼）
    homeExpected += (params.homeStakes - 5) * w.stakesWeight * 0.05;
    awayExpected += (params.awayStakes - 5) * w.stakesWeight * 0.05;

    // 分组强弱：强组比赛进球预期略高（强强对话更开放）
    const groupStrengthFactor = (params.groupStrength - 5) * 0.03;
    homeExpected += groupStrengthFactor;
    awayExpected += groupStrengthFactor;

    // 轮次压力：越往后轮次，防守越谨慎，进球预期降低
    const roundPressureFactor = (params.roundNumber - 1) * 0.04;
    homeExpected -= roundPressureFactor * 0.5;
    awayExpected -= roundPressureFactor * 0.5;

    // 晋级形势：必须赢的比赛进攻更激进，已出线/已淘汰则进攻意愿下降
    const qualificationFactors: Record<string, { home: number; away: number }> =
      {
        must_win: { home: 0.15, away: 0.05 },
        can_draw: { home: 0.05, away: 0.05 },
        already_qualified: { home: -0.05, away: -0.05 },
        eliminated: { home: -0.1, away: -0.1 },
        neutral: { home: 0, away: 0 },
      };
    const qf = qualificationFactors[params.qualificationScenario] || {
      home: 0,
      away: 0,
    };
    homeExpected += qf.home;
    awayExpected += qf.away;

    // 天气影响：雨天/雪天/酷热减少进球
    const weatherGoalFactor: Record<string, number> = {
      sunny: 0,
      cloudy: -0.02,
      rainy: -0.15,
      snowy: -0.2,
      windy: -0.1,
      hot: -0.1,
    };
    const weatherImpact = weatherGoalFactor[params.weatherCondition] || 0;
    homeExpected += weatherImpact * w.weatherWeight;
    awayExpected += weatherImpact * w.weatherWeight;

    // 裁判影响：严格裁判减少进球（更多中断），宽松裁判增加身体对抗
    const refereeGoalFactor: Record<string, number> = {
      lenient: 0.05,
      average: 0,
      strict: -0.05,
      very_strict: -0.1,
    };
    const refereeImpact = refereeGoalFactor[params.refereeStrictness] || 0;
    homeExpected += refereeImpact * w.refereeWeight;
    awayExpected += refereeImpact * w.refereeWeight;

    return {
      homeGoals: Math.max(0, Math.round(homeExpected * 10) / 10),
      awayGoals: Math.max(0, Math.round(awayExpected * 10) / 10),
    };
  }

  /**
   * 预测比分（融合 ELO 和泊松的预期进球）
   */
  private predictScore(
    homeWinProb: number,
    drawProb: number,
    awayWinProb: number,
    homeRating: number,
    awayRating: number,
    poissonHomeExpected: number,
    poissonAwayExpected: number,
  ): { homeGoals: number; awayGoals: number } {
    const ratingDiff = homeRating - awayRating;
    const baseGoals = 1.3;

    let homeExpected = baseGoals + ratingDiff / 800;
    let awayExpected = baseGoals - ratingDiff / 800;

    homeExpected = homeExpected * 0.5 + poissonHomeExpected * 0.5;
    awayExpected = awayExpected * 0.5 + poissonAwayExpected * 0.5;

    if (homeWinProb > awayWinProb + 0.1) {
      homeExpected += 0.3;
    } else if (awayWinProb > homeWinProb + 0.1) {
      awayExpected += 0.3;
    }

    if (drawProb > 0.28) {
      const avg = (homeExpected + awayExpected) / 2;
      homeExpected = homeExpected * 0.6 + avg * 0.4;
      awayExpected = awayExpected * 0.6 + avg * 0.4;
    }

    return {
      homeGoals: Math.max(0, Math.round(homeExpected * 10) / 10),
      awayGoals: Math.max(0, Math.round(awayExpected * 10) / 10),
    };
  }

  /**
   * 计算预测置信度
   * 三模型一致 → 高置信度
   * 两模型一致 → 中等置信度
   * 三模型分歧 → 低置信度
   */
  private computeConfidence(
    baseModels: BaseModelOutput[],
    stackingResult: { homeWin: number; draw: number; awayWin: number },
    homeRating: number,
    awayRating: number,
  ): 'high' | 'medium' | 'low' {
    const predictions = baseModels.map((m) => {
      if (m.homeWin > m.draw && m.homeWin > m.awayWin) return 'H';
      if (m.awayWin > m.draw && m.awayWin > m.homeWin) return 'A';
      return 'D';
    });

    const agreement = new Set(predictions).size;

    if (agreement === 1) return 'high';

    if (agreement === 2) return 'medium';

    return 'low';
  }
}
