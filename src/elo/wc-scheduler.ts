import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { FootballDataApiDataSource } from '../collector/api/football-data.source';
import { MatchData } from '../collector/interfaces/match.interface';
import { WcPredictionService } from './wc-prediction.service';
import { EloService } from './elo.service';
import { beijingDateAddDays } from './beijing-time';

const INTERVAL_LIVE_MS = 5 * 60 * 1000;
const INTERVAL_IDLE_MS = 30 * 60 * 1000;

const TEAM_NAME_MAP: Record<string, string> = {
  "Côte d'Ivoire": 'Ivory Coast',
  "Cote d'Ivoire": 'Ivory Coast',
  'United States': 'USA',
  'Korea Republic': 'South Korea',
  'Korea DPR': 'North Korea',
  'Bosnia-Herzegovina': 'Bosnia & Herzegovina',
  Czechia: 'Czech Republic',
  'Congo DR': 'DR Congo',
  'Cape Verde Islands': 'Cape Verde',
};

@Injectable()
export class WcScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WcScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly footballDataApi: FootballDataApiDataSource,
    private readonly wcPredictionService: WcPredictionService,
    private readonly eloService: EloService,
  ) {}

  private async fetchMatchesInRange(
    dateFrom: string,
    dateTo: string,
  ): Promise<MatchData[]> {
    const allMatches: MatchData[] = [];
    let start = new Date(dateFrom);
    const end = new Date(dateTo);

    while (start <= end) {
      let chunkEnd = new Date(start);
      chunkEnd.setDate(chunkEnd.getDate() + 9);
      if (chunkEnd > end) chunkEnd = end;

      const from = start.toISOString().slice(0, 10);
      const to = chunkEnd.toISOString().slice(0, 10);

      const matches = await this.footballDataApi.fetchMatchesByDate(from, to);
      allMatches.push(...matches);

      start = new Date(chunkEnd);
      start.setDate(start.getDate() + 1);
    }

    return allMatches;
  }

  async refreshNow(): Promise<{ updated: number }> {
    if (this.running) {
      return { updated: 0 };
    }

    this.running = true;
    let updated = 0;

    try {
      const twoDaysLater = beijingDateAddDays(2);
      const tenDaysAgo = beijingDateAddDays(-10);

      this.logger.log(`手动刷新世界杯比分: ${tenDaysAgo} ~ ${twoDaysLater}`);

      const matches = await this.fetchMatchesInRange(tenDaysAgo, twoDaysLater);

      const wcMatches = matches.filter(
        (m) =>
          m.league === 'World Cup' ||
          m.league === 'FIFA World Cup' ||
          m.league === 'World Cup Qualification',
      );

      const finishedMatches = wcMatches.filter((m) => m.status === 'FINISHED');

      if (finishedMatches.length > 0) {
        for (const match of finishedMatches) {
          if (match.homeScore === null || match.awayScore === null) continue;

          const homeTeam = this.normalizeTeamName(match.homeTeam);
          const awayTeam = this.normalizeTeamName(match.awayTeam);

          try {
            const result = await this.wcPredictionService.updateMatchResult(
              homeTeam,
              awayTeam,
              match.homeScore,
              match.awayScore,
            );

            if (result) {
              updated++;
              await this.eloService.updateEloForMatch(
                homeTeam,
                awayTeam,
                match.homeScore,
                match.awayScore,
                true,
                'FIFA World Cup',
              );
            }
          } catch (err: any) {
            this.logger.warn(
              `更新比分失败 ${homeTeam} vs ${awayTeam}: ${err.message}`,
            );
          }
        }
      }

      if (updated > 0) {
        this.logger.log(`手动刷新更新了 ${updated} 场比赛比分`);
        try {
          await this.wcPredictionService.regenerateUpcomingPredictions();
        } catch (err: any) {
          this.logger.error(`重新生成预测失败: ${err.message}`, err.stack);
        }
      }
    } catch (err: any) {
      this.logger.error(`手动刷新失败: ${err.message}`, err.stack);
    } finally {
      this.running = false;
    }

    return { updated };
  }

  onModuleInit() {
    this.logger.log('世界杯数据调度器启动，首次执行将在 30 秒后...');
    this.scheduleNext(30_000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number) {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.tick();
    }, delayMs);
  }

  private async tick() {
    if (this.running) {
      this.scheduleNext(INTERVAL_IDLE_MS);
      return;
    }

    this.running = true;
    let hasLive = false;

    try {
      hasLive = await this.refreshWcData();
    } catch (err: any) {
      this.logger.error(`世界杯数据刷新失败: ${err.message}`, err.stack);
    } finally {
      this.running = false;
    }

    const nextInterval = hasLive ? INTERVAL_LIVE_MS : INTERVAL_IDLE_MS;
    const nextLabel = hasLive ? '5 分钟' : '30 分钟';
    this.logger.log(`下次刷新: ${nextLabel} 后`);
    this.scheduleNext(nextInterval);
  }

  private normalizeTeamName(name: string): string {
    return TEAM_NAME_MAP[name] || name;
  }

  private async refreshWcData(): Promise<boolean> {
    const tenDaysAgo = beijingDateAddDays(-10);
    const twoDaysLater = beijingDateAddDays(2);

    this.logger.log(`开始刷新世界杯数据: ${tenDaysAgo} ~ ${twoDaysLater}`);

    const matches = await this.fetchMatchesInRange(tenDaysAgo, twoDaysLater);

    const wcMatches = matches.filter(
      (m) =>
        m.league === 'World Cup' ||
        m.league === 'FIFA World Cup' ||
        m.league === 'World Cup Qualification',
    );

    if (wcMatches.length === 0) {
      this.logger.log('当前无世界杯比赛数据');
      return false;
    }

    const liveMatches = wcMatches.filter((m) => m.status === 'LIVE');
    const finishedMatches = wcMatches.filter((m) => m.status === 'FINISHED');

    this.logger.log(
      `获取到 ${wcMatches.length} 场世界杯比赛 (进行中: ${liveMatches.length}, 已结束: ${finishedMatches.length})`,
    );

    if (finishedMatches.length > 0) {
      await this.updateFinishedMatches(finishedMatches);
    }

    return liveMatches.length > 0;
  }

  private async updateFinishedMatches(
    finishedMatches: {
      homeTeam: string;
      awayTeam: string;
      homeScore: number | null;
      awayScore: number | null;
    }[],
  ): Promise<void> {
    let updated = 0;

    for (const match of finishedMatches) {
      if (match.homeScore === null || match.awayScore === null) {
        continue;
      }

      const homeTeam = this.normalizeTeamName(match.homeTeam);
      const awayTeam = this.normalizeTeamName(match.awayTeam);

      try {
        const result = await this.wcPredictionService.updateMatchResult(
          homeTeam,
          awayTeam,
          match.homeScore,
          match.awayScore,
        );

        if (result) {
          updated++;

          await this.eloService.updateEloForMatch(
            homeTeam,
            awayTeam,
            match.homeScore,
            match.awayScore,
            true,
            'FIFA World Cup',
          );

          this.logger.log(
            `更新比分: ${homeTeam} ${match.homeScore}-${match.awayScore} ${awayTeam} (预测${result.resultCorrect ? '✅正确' : '❌错误'})`,
          );
        }
      } catch (err: any) {
        this.logger.warn(
          `更新比分失败 ${homeTeam} vs ${awayTeam}: ${err.message}`,
        );
      }
    }

    if (updated > 0) {
      this.logger.log(`✅ 共更新 ${updated} 场已结束比赛的结果`);

      try {
        this.logger.log('开始重新生成未开始比赛的预测...');
        const regenCount =
          await this.wcPredictionService.regenerateUpcomingPredictions();
        this.logger.log(`✅ 已重新生成 ${regenCount} 场比赛的预测`);
      } catch (err: any) {
        this.logger.error(`重新生成预测失败: ${err.message}`, err.stack);
      }
    }
  }
}
