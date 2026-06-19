import { Injectable, Logger } from '@nestjs/common';

export interface PoissonPrediction {
  homeGoalsExpected: number;
  awayGoalsExpected: number;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  scoreProbs: Record<string, number>;
  mostLikelyScore: string;
}

export interface TeamStrength {
  attack: number;
  defense: number;
}

@Injectable()
export class PoissonService {
  private readonly logger = new Logger(PoissonService.name);

  private readonly DEFAULT_ATTACK = 1.0;
  private readonly DEFAULT_DEFENSE = 1.0;
  private readonly HOME_ADVANTAGE_FACTOR = 1.15;
  private readonly RHO = -0.13; // Dixon-Coles 低比分修正参数

  /**
   * Dixon-Coles 双泊松模型核心预测
   * @param homeAttack 主队进攻力
   * @param homeDefense 主队防守力
   * @param awayAttack 客队进攻力
   * @param awayDefense 客队防守力
   * @param neutral 是否中立场地
   * @param maxGoals 最大进球数（计算截断）
   */
  predict(
    homeAttack: number,
    homeDefense: number,
    awayAttack: number,
    awayDefense: number,
    neutral: boolean = false,
    maxGoals: number = 8,
  ): PoissonPrediction {
    const homeAdv = neutral ? 1.0 : this.HOME_ADVANTAGE_FACTOR;

    const homeLambda = homeAttack * awayDefense * homeAdv;
    const awayLambda = awayAttack * homeDefense;

    const homeWinProb = this.calculateHomeWinProb(
      homeLambda,
      awayLambda,
      maxGoals,
    );
    const awayWinProb = this.calculateHomeWinProb(
      awayLambda,
      homeLambda,
      maxGoals,
    );
    const drawProb = Math.max(
      0,
      Math.round((1 - homeWinProb - awayWinProb) * 1000) / 1000,
    );

    const scoreProbs: Record<string, number> = {};
    let maxProb = 0;
    let mostLikelyScore = '0-0';

    for (let i = 0; i <= maxGoals; i++) {
      for (let j = 0; j <= maxGoals; j++) {
        const prob = this.scoreProbability(i, j, homeLambda, awayLambda);
        const key = `${i}-${j}`;
        scoreProbs[key] = Math.round(prob * 10000) / 10000;

        if (prob > maxProb) {
          maxProb = prob;
          mostLikelyScore = key;
        }
      }
    }

    return {
      homeGoalsExpected: Math.round(homeLambda * 100) / 100,
      awayGoalsExpected: Math.round(awayLambda * 100) / 100,
      homeWinProb: Math.round(homeWinProb * 1000) / 1000,
      drawProb: Math.round(drawProb * 1000) / 1000,
      awayWinProb: Math.round(awayWinProb * 1000) / 1000,
      scoreProbs,
      mostLikelyScore,
    };
  }

  /**
   * 从 ELO 评分估计进攻/防守力
   * 将 ELO 评分映射到进攻/防守参数
   */
  estimateStrengthsFromElo(
    homeRating: number,
    awayRating: number,
    _homeGoalsForAvg: number = 1.5,
    _homeGoalsAgainstAvg: number = 1.0,
    _awayGoalsForAvg: number = 1.5,
    _awayGoalsAgainstAvg: number = 1.0,
  ): {
    home: TeamStrength;
    away: TeamStrength;
  } {
    const avgRating = 1500;
    const ratingScale = 800;

    const homeAttack = Math.exp((homeRating - avgRating) / ratingScale);
    const homeDefense = Math.exp(-(homeRating - avgRating) / ratingScale);
    const awayAttack = Math.exp((awayRating - avgRating) / ratingScale);
    const awayDefense = Math.exp(-(awayRating - avgRating) / ratingScale);

    return {
      home: { attack: homeAttack, defense: homeDefense },
      away: { attack: awayAttack, defense: awayDefense },
    };
  }

  /**
   * 计算特定比分的概率（含 Dixon-Coles 修正）
   */
  private scoreProbability(
    homeGoals: number,
    awayGoals: number,
    homeLambda: number,
    awayLambda: number,
  ): number {
    const prob =
      this.poissonPmf(homeGoals, homeLambda) *
      this.poissonPmf(awayGoals, awayLambda);

    if (homeGoals <= 1 && awayGoals <= 1) {
      return (
        prob * this.tauCorrection(homeGoals, awayGoals, homeLambda, awayLambda)
      );
    }

    return prob;
  }

  /**
   * Dixon-Coles τ 修正函数
   * 修正低比分（0-0, 1-0, 0-1, 1-1）的泊松偏差
   */
  private tauCorrection(
    homeGoals: number,
    awayGoals: number,
    homeLambda: number,
    awayLambda: number,
  ): number {
    if (homeGoals === 0 && awayGoals === 0) {
      return 1 - homeLambda * awayLambda * this.RHO;
    }
    if (homeGoals === 1 && awayGoals === 0) {
      return 1 + homeLambda * this.RHO;
    }
    if (homeGoals === 0 && awayGoals === 1) {
      return 1 + awayLambda * this.RHO;
    }
    if (homeGoals === 1 && awayGoals === 1) {
      return 1 - this.RHO;
    }
    return 1;
  }

  /**
   * 泊松概率质量函数
   */
  private poissonPmf(k: number, lambda: number): number {
    if (lambda <= 0) {
      return k === 0 ? 1 : 0;
    }
    return (Math.exp(-lambda) * Math.pow(lambda, k)) / this.factorial(k);
  }

  private factorial(n: number): number {
    if (n <= 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) {
      result *= i;
    }
    return result;
  }

  /**
   * 计算主队获胜概率（通过枚举所有比分）
   */
  private calculateHomeWinProb(
    homeLambda: number,
    awayLambda: number,
    maxGoals: number,
  ): number {
    let prob = 0;
    for (let i = 0; i <= maxGoals; i++) {
      for (let j = 0; j < i; j++) {
        prob += this.scoreProbability(i, j, homeLambda, awayLambda);
      }
    }
    return prob;
  }

  /**
   * 带时间衰减的进攻/防守力估计
   * 近期比赛权重更高
   */
  estimateStrengthsWithTimeDecay(
    matches: Array<{
      goalsFor: number;
      goalsAgainst: number;
      opponentRating: number;
      daysAgo: number;
      isHome: boolean;
    }>,
    halfLifeDays: number = 365,
  ): TeamStrength {
    if (matches.length === 0) {
      return { attack: this.DEFAULT_ATTACK, defense: this.DEFAULT_DEFENSE };
    }

    let totalWeight = 0;
    let weightedAttack = 0;
    let weightedDefense = 0;

    for (const match of matches) {
      const weight = Math.pow(0.5, match.daysAgo / halfLifeDays);

      const homeAdvMult = match.isHome ? 1 / this.HOME_ADVANTAGE_FACTOR : 1;
      weightedAttack += match.goalsFor * weight * homeAdvMult;
      weightedDefense += match.goalsAgainst * weight;

      totalWeight += weight;
    }

    return {
      attack: Math.max(0.3, weightedAttack / totalWeight),
      defense: Math.max(0.3, weightedDefense / totalWeight),
    };
  }
}
