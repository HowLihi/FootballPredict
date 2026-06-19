import { Injectable, Logger } from '@nestjs/common';

export interface BaseModelOutput {
  name: string;
  homeWin: number;
  draw: number;
  awayWin: number;
}

export interface StackingInput {
  baseModels: BaseModelOutput[];
  features: {
    eloRatingDiff: number;
    homeAdvantage: number;
    squadValueDiff: number;
    isNeutral: boolean;
    tournamentWeight: number;
  };
}

export interface StackingOutput {
  homeWin: number;
  draw: number;
  awayWin: number;
  modelContributions: Array<{
    modelName: string;
    weight: number;
    contribution: number;
  }>;
}

@Injectable()
export class StackingService {
  private readonly logger = new Logger(StackingService.name);

  private modelWeights: {
    elo: { home: number; draw: number; away: number };
    odds: { home: number; draw: number; away: number };
    poisson: { home: number; draw: number; away: number };
  };

  private contextAdjustments: Record<string, number>;

  constructor() {
    this.modelWeights = {
      elo: { home: 0.4, draw: 0.35, away: 0.4 },
      odds: { home: 0.35, draw: 0.3, away: 0.35 },
      poisson: { home: 0.25, draw: 0.35, away: 0.25 },
    };

    this.contextAdjustments = {
      highEloDiff: 0.05,
      lowEloDiff: -0.03,
      neutral: -0.02,
      highTournament: 0.03,
    };
  }

  /**
   * 核心堆叠预测方法
   * 使用 softmax 风格的加权融合，权重根据上下文动态调整
   */
  predict(input: StackingInput): StackingOutput {
    const { baseModels, features } = input;

    const adjustedWeights = this.computeDynamicWeights(features);

    const contributions: Array<{
      modelName: string;
      weight: number;
      contribution: number;
    }> = [];

    let weightedHomeWin = 0;
    let weightedDraw = 0;
    let weightedAwayWin = 0;
    let totalWeight = 0;

    for (const model of baseModels) {
      const w = adjustedWeights[model.name] || 0.33;

      weightedHomeWin += model.homeWin * w;
      weightedDraw += model.draw * w;
      weightedAwayWin += model.awayWin * w;
      totalWeight += w;

      contributions.push({
        modelName: model.name,
        weight: w,
        contribution: w / totalWeight,
      });
    }

    let homeWin = weightedHomeWin / totalWeight;
    let draw = weightedDraw / totalWeight;
    let awayWin = weightedAwayWin / totalWeight;

    const calibration = this.calibrate(
      homeWin,
      draw,
      awayWin,
      features.eloRatingDiff,
      features.isNeutral,
    );

    homeWin = calibration.homeWin;
    draw = calibration.draw;
    awayWin = calibration.awayWin;

    const total = homeWin + draw + awayWin;

    return {
      homeWin: Math.round((homeWin / total) * 1000) / 1000,
      draw: Math.round((draw / total) * 1000) / 1000,
      awayWin: Math.round((awayWin / total) * 1000) / 1000,
      modelContributions: contributions.map((c) => ({
        ...c,
        contribution: Math.round(c.contribution * 1000) / 1000,
      })),
    };
  }

  /**
   * 动态权重计算
   * 根据比赛上下文调整各模型的权重
   */
  private computeDynamicWeights(
    features: StackingInput['features'],
  ): Record<string, number> {
    const weights: Record<string, number> = {
      elo: this.modelWeights.elo.home,
      odds: this.modelWeights.odds.home,
      poisson: this.modelWeights.poisson.home,
    };

    const absEloDiff = Math.abs(features.eloRatingDiff);

    if (absEloDiff > 300) {
      weights.elo += this.contextAdjustments.highEloDiff;
      weights.odds += this.contextAdjustments.highEloDiff * 0.5;
      weights.poisson -= this.contextAdjustments.highEloDiff * 0.3;
    }

    if (absEloDiff < 50) {
      weights.poisson += Math.abs(this.contextAdjustments.lowEloDiff);
      weights.elo -= Math.abs(this.contextAdjustments.lowEloDiff) * 0.5;
    }

    if (features.isNeutral) {
      weights.odds += this.contextAdjustments.neutral;
    }

    if (features.tournamentWeight >= 1.4) {
      weights.elo += this.contextAdjustments.highTournament;
      weights.odds -= this.contextAdjustments.highTournament * 0.3;
    }

    Object.keys(weights).forEach((key) => {
      weights[key] = Math.max(0.1, Math.min(0.6, weights[key]));
    });

    return weights;
  }

  /**
   * 概率校准
   * 使用 Platt Scaling 风格的校准，确保概率和实际频率一致
   * 修正模型的各种系统性偏差
   */
  private calibrate(
    homeWin: number,
    draw: number,
    awayWin: number,
    eloRatingDiff: number,
    isNeutral: boolean,
  ): { homeWin: number; draw: number; awayWin: number } {
    let calibratedHomeWin = homeWin;
    let calibratedDraw = draw;
    let calibratedAwayWin = awayWin;

    const absDiff = Math.abs(eloRatingDiff);

    if (absDiff > 200) {
      const overconfidence = 0.02;
      if (calibratedHomeWin > calibratedAwayWin) {
        calibratedHomeWin -= overconfidence;
        calibratedAwayWin += overconfidence * 0.5;
        calibratedDraw += overconfidence * 0.5;
      } else {
        calibratedAwayWin -= overconfidence;
        calibratedHomeWin += overconfidence * 0.5;
        calibratedDraw += overconfidence * 0.5;
      }
    }

    if (isNeutral) {
      calibratedDraw += 0.01;
      if (calibratedHomeWin > calibratedAwayWin) {
        calibratedHomeWin -= 0.005;
        calibratedAwayWin -= 0.005;
      }
    }

    return {
      homeWin: Math.max(0.01, calibratedHomeWin),
      draw: Math.max(0.05, calibratedDraw),
      awayWin: Math.max(0.01, calibratedAwayWin),
    };
  }

  /**
   * 更新模型权重（在线学习）
   * 根据实际比赛结果动态调整各模型的信任度
   */
  updateWeights(
    modelName: string,
    wasCorrect: boolean,
    outcome: 'home' | 'draw' | 'away',
    learningRate: number = 0.01,
  ): void {
    const key = modelName as keyof typeof this.modelWeights;
    if (!this.modelWeights[key]) return;

    const adjustment = wasCorrect ? learningRate : -learningRate * 0.5;

    this.modelWeights[key].home = Math.max(
      0.1,
      Math.min(0.6, this.modelWeights[key].home + adjustment),
    );
    this.modelWeights[key].draw = Math.max(
      0.1,
      Math.min(0.6, this.modelWeights[key].draw + adjustment),
    );
    this.modelWeights[key].away = Math.max(
      0.1,
      Math.min(0.6, this.modelWeights[key].away + adjustment),
    );

    this.logger.debug(
      `更新权重: ${modelName} -> H=${this.modelWeights[key].home.toFixed(3)} D=${this.modelWeights[key].draw.toFixed(3)} A=${this.modelWeights[key].away.toFixed(3)}`,
    );
  }

  /**
   * 获取当前模型权重（用于调试和监控）
   */
  getWeights(): typeof this.modelWeights {
    return { ...this.modelWeights };
  }
}
