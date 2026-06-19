import { Injectable, Logger } from '@nestjs/common';

export interface OddsProbability {
  homeWin: number;
  draw: number;
  awayWin: number;
}

@Injectable()
export class OddsService {
  private readonly logger = new Logger(OddsService.name);

  /**
   * 从 ELO 评分推导博彩赔率隐含概率
   * 博彩市场高度有效，赔率隐含概率与 ELO 概率高度相关
   * 但存在一些系统性偏差：
   * 1. 热门-冷门偏差（favorite-longshot bias）：市场高估强队
   * 2. 主场偏差：市场略微高估主场优势
   * 3. 平局低估：市场系统性低估平局概率
   */
  oddsImpliedFromElo(
    homeRating: number,
    awayRating: number,
    homeAdvantage: number,
  ): OddsProbability {
    const effectiveHome = homeRating + homeAdvantage;
    const ratingDiff = effectiveHome - awayRating;

    const rawHomeWin = 1 / (1 + Math.pow(10, -ratingDiff / 400));
    const rawAwayWin = 1 / (1 + Math.pow(10, ratingDiff / 400));

    const baseDrawProb = 0.26;
    const drawReduction = Math.abs(ratingDiff) / 4000;
    let rawDraw = Math.max(0.08, baseDrawProb - drawReduction);

    let homeWin = rawHomeWin * (1 - rawDraw);
    let awayWin = rawAwayWin * (1 - rawDraw);

    const favLongshotBias = 0.03;
    if (homeWin > awayWin) {
      homeWin += favLongshotBias;
      awayWin -= favLongshotBias;
    } else {
      awayWin += favLongshotBias;
      homeWin -= favLongshotBias;
    }

    homeWin = Math.max(0.05, homeWin);
    awayWin = Math.max(0.05, awayWin);
    rawDraw = Math.max(0.08, rawDraw);

    const total = homeWin + awayWin + rawDraw;
    homeWin /= total;
    awayWin /= total;
    rawDraw /= total;

    homeWin = Math.round(homeWin * 1000) / 1000;
    rawDraw = Math.round(rawDraw * 1000) / 1000;
    awayWin = Math.round(awayWin * 1000) / 1000;

    return { homeWin, draw: rawDraw, awayWin };
  }

  /**
   * 将 ELO 概率与赔率隐含概率进行融合
   * 赔率隐含概率作为市场基准，ELO 作为模型输出
   */
  combineWithElo(
    eloHomeWin: number,
    eloDraw: number,
    eloAwayWin: number,
    oddsHomeWin: number,
    oddsDraw: number,
    oddsAwayWin: number,
    eloWeight: number = 0.55,
  ): OddsProbability {
    const oddsWeight = 1 - eloWeight;

    const homeWin = eloHomeWin * eloWeight + oddsHomeWin * oddsWeight;
    const draw = eloDraw * eloWeight + oddsDraw * oddsWeight;
    const awayWin = eloAwayWin * eloWeight + oddsAwayWin * oddsWeight;

    const total = homeWin + draw + awayWin;

    return {
      homeWin: Math.round((homeWin / total) * 1000) / 1000,
      draw: Math.round((draw / total) * 1000) / 1000,
      awayWin: Math.round((awayWin / total) * 1000) / 1000,
    };
  }
}
