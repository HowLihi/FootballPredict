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

import axios from 'axios';

const INTERVAL_LIVE_MS = 5 * 60 * 1000;
const INTERVAL_IDLE_MS = 30 * 60 * 1000;
const INTERVAL_BACKFILL_MS = 60 * 60 * 1000;
const INTERVAL_LAST_RESORT_MS = 15 * 60 * 1000;
const INTERVAL_DAILY_AUTO_TUNE_MS = 30 * 60 * 1000;

const THESPORTSDB_URL = 'https://www.thesportsdb.com/api/v1/json/3';

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
  private backfillTimer: NodeJS.Timeout | null = null;
  private lastResortTimer: NodeJS.Timeout | null = null;
  private dailyAutoTuneTimer: NodeJS.Timeout | null = null;
  private running = false;
  private lastBackfillTime = 0;
  private lastAutoTuneDate = '';

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
    this.scheduleBackfill(INTERVAL_BACKFILL_MS);
    this.scheduleLastResort(INTERVAL_LAST_RESORT_MS);
    this.scheduleDailyAutoTune(INTERVAL_DAILY_AUTO_TUNE_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.backfillTimer) {
      clearTimeout(this.backfillTimer);
      this.backfillTimer = null;
    }
    if (this.lastResortTimer) {
      clearTimeout(this.lastResortTimer);
      this.lastResortTimer = null;
    }
    if (this.dailyAutoTuneTimer) {
      clearTimeout(this.dailyAutoTuneTimer);
      this.dailyAutoTuneTimer = null;
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

  private scheduleBackfill(delayMs: number) {
    if (this.backfillTimer) {
      clearTimeout(this.backfillTimer);
    }
    this.backfillTimer = setTimeout(() => {
      this.backfillTick();
    }, delayMs);
  }

  private async backfillTick() {
    const now = Date.now();
    if (now - this.lastBackfillTime < INTERVAL_BACKFILL_MS) {
      this.scheduleBackfill(
        INTERVAL_BACKFILL_MS - (now - this.lastBackfillTime),
      );
      return;
    }

    try {
      await this.backfillMissingScores();
    } catch (err: any) {
      this.logger.error(`比分兜底补全失败: ${err.message}`, err.stack);
    }

    this.lastBackfillTime = Date.now();
    this.scheduleBackfill(INTERVAL_BACKFILL_MS);
  }

  private scheduleLastResort(delayMs: number) {
    if (this.lastResortTimer) {
      clearTimeout(this.lastResortTimer);
    }
    this.lastResortTimer = setTimeout(() => {
      this.lastResortTick();
    }, delayMs);
  }

  private async lastResortTick() {
    try {
      await this.lastResortBackfill();
    } catch (err: any) {
      this.logger.error(`尽力兜底失败: ${err.message}`, err.stack);
    }
    this.scheduleLastResort(INTERVAL_LAST_RESORT_MS);
  }

  private scheduleDailyAutoTune(delayMs: number) {
    if (this.dailyAutoTuneTimer) {
      clearTimeout(this.dailyAutoTuneTimer);
    }
    this.dailyAutoTuneTimer = setTimeout(() => {
      this.dailyAutoTuneTick();
    }, delayMs);
  }

  private async dailyAutoTuneTick() {
    try {
      await this.checkAndAutoTune();
    } catch (err: any) {
      this.logger.error(`每日自动调优失败: ${err.message}`, err.stack);
    }
    this.scheduleDailyAutoTune(INTERVAL_DAILY_AUTO_TUNE_MS);
  }

  async checkAndAutoTune(): Promise<{ triggered: boolean; reason?: string }> {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    if (this.lastAutoTuneDate === todayStr) {
      return { triggered: false, reason: `今天已执行过自动调优 (${todayStr})` };
    }

    const allPredictions = await this.wcPredictionService.getRecentMatches();

    const todayMatches = allPredictions.filter((p) => {
      const datePart = p.matchDate.split(' ')[0];
      return datePart === todayStr;
    });

    if (todayMatches.length === 0) {
      return { triggered: false, reason: '今天没有比赛' };
    }

    const unfinished = todayMatches.filter((p) => {
      return p.actualHomeScore === null || p.actualHomeScore === undefined;
    });

    if (unfinished.length > 0) {
      return {
        triggered: false,
        reason: `今天还有 ${unfinished.length} 场比赛未结束: ${unfinished
          .map((m) => `${m.homeTeam} vs ${m.awayTeam}`)
          .join(', ')}`,
      };
    }

    const matchDates = todayMatches.map((p) => {
      return new Date(p.matchDate.replace(' ', 'T') + ':00');
    });
    const latestMatchEnd = new Date(
      Math.max(...matchDates.map((d) => d.getTime())) + 2 * 60 * 60 * 1000,
    );

    const oneHourAfterEnd = new Date(latestMatchEnd.getTime() + 60 * 60 * 1000);

    if (today < oneHourAfterEnd) {
      const remainingMin = Math.ceil(
        (oneHourAfterEnd.getTime() - today.getTime()) / 60000,
      );
      return {
        triggered: false,
        reason: `最后一场比赛结束后还需等待 ${remainingMin} 分钟`,
      };
    }

    this.lastAutoTuneDate = todayStr;
    this.logger.log(
      `[每日自动调优] 今天 ${todayMatches.length} 场已全部结束且超过1小时，开始自动调优...`,
    );

    try {
      const result = await this.wcPredictionService.autoTuneWeights({
        iterations: 10,
        runsPerMatch: 2,
      });

      const maes = result.history
        .map((h: any) => h.testMAE)
        .filter((v: number) => v != null);
      const avgMAE =
        maes.length > 0
          ? (
              maes.reduce((a: number, b: number) => a + b, 0) / maes.length
            ).toFixed(4)
          : 'N/A';

      this.logger.log(
        `[每日自动调优] 完成: testMAE=${result.bestTestMAE}, avgMAE=${avgMAE}, ` +
          `weights=${JSON.stringify(result.bestWeights)}`,
      );

      await this.wcPredictionService.regenerateUpcomingPredictions();
      this.logger.log('[每日自动调优] 已用新权重重新生成未来比赛预测');

      return { triggered: true, reason: `完成: testMAE=${result.bestTestMAE}` };
    } catch (err: any) {
      this.logger.error(`[每日自动调优] 执行失败: ${err.message}`, err.stack);
      throw err;
    }
  }

  async lastResortBackfill(): Promise<{
    scanned: number;
    filled: number;
    failed: number;
  }> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const all = await this.wcPredictionService.getAllMissingScorePredictions();
    if (all.length === 0) {
      return { scanned: 0, filled: 0, failed: 0 };
    }

    const candidates = all.filter((p) => {
      const matchDate = new Date(p.matchDate.replace(' ', 'T') + ':00');
      const matchEnd = new Date(matchDate.getTime() + 2 * 60 * 60 * 1000);
      return matchEnd < oneHourAgo && matchEnd > twentyFourHoursAgo;
    });

    if (candidates.length === 0) {
      return { scanned: 0, filled: 0, failed: 0 };
    }

    this.logger.log(
      `尽力兜底扫描: 发现 ${candidates.length} 场已结束超过1小时但无比分，尝试LLM搜索...`,
    );

    let filled = 0;
    let failed = 0;

    for (const pred of candidates) {
      this.logger.log(
        `尽力兜底(LLM): 查询 ${pred.homeTeam} vs ${pred.awayTeam} (${pred.matchDate})`,
      );

      const score = await this.callLLMForScore(
        pred.homeTeam,
        pred.awayTeam,
        pred.matchDate,
      );

      if (!score) {
        this.logger.warn(
          `尽力兜底(LLM): 无法获取 ${pred.homeTeam} vs ${pred.awayTeam} 的比分`,
        );
        failed++;
        continue;
      }

      try {
        const result = await this.wcPredictionService.updateMatchResult(
          pred.homeTeam,
          pred.awayTeam,
          score.homeScore,
          score.awayScore,
        );

        if (result) {
          filled++;
          await this.eloService.updateEloForMatch(
            pred.homeTeam,
            pred.awayTeam,
            score.homeScore,
            score.awayScore,
            true,
            'FIFA World Cup',
          );
          this.logger.log(
            `尽力兜底补全(LLM): ${pred.homeTeam} ${score.homeScore}-${score.awayScore} ${pred.awayTeam}`,
          );
        } else {
          failed++;
        }
      } catch (err: any) {
        this.logger.warn(
          `尽力兜底(LLM): 更新失败 ${pred.homeTeam} vs ${pred.awayTeam}: ${err.message}`,
        );
        failed++;
      }
    }

    if (filled > 0) {
      this.logger.log(
        `✅ 尽力兜底完成: 扫描 ${candidates.length} 场，补全 ${filled} 场，失败 ${failed} 场`,
      );
      try {
        await this.wcPredictionService.regenerateUpcomingPredictions();
      } catch (err: any) {
        this.logger.error(
          `尽力兜底后重新生成预测失败: ${err.message}`,
          err.stack,
        );
      }
    }

    return { scanned: candidates.length, filled, failed };
  }

  private async callLLMForScore(
    homeTeam: string,
    awayTeam: string,
    matchDate: string,
  ): Promise<{ homeScore: number; awayScore: number } | null> {
    const apiKey = process.env.LLM_API_KEY || '';
    const apiUrl =
      process.env.LLM_API_URL || 'https://api.deepseek.com/v1/chat/completions';
    const model = process.env.LLM_MODEL || 'deepseek-chat';

    if (!apiKey) {
      this.logger.warn('LLM API Key 未配置，跳过尽力兜底');
      return null;
    }

    const prompt = `请查找以下足球比赛的最终比分，只返回JSON格式：

比赛：${homeTeam} vs ${awayTeam}
赛事：2026 FIFA World Cup (美加墨世界杯)
日期：${matchDate}

请按以下JSON格式返回（不要包含任何其他内容）：
{"homeScore": <主队进球数>, "awayScore": <客队进球数>, "source": "<比分来源>"}

如果找不到这场比赛的比分，请返回：
{"homeScore": null, "awayScore": null, "source": "not found"}`;

    try {
      const res = await axios.post(
        apiUrl,
        {
          model,
          messages: [
            {
              role: 'system',
              content:
                '你是一个足球比分查询助手。请根据你的知识返回准确的比赛最终比分。只返回JSON，不要有任何其他文字。',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 200,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 30000,
        },
      );

      const text = res.data?.choices?.[0]?.message?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        this.logger.warn(`LLM返回格式异常: ${text.substring(0, 200)}`);
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (
        parsed.homeScore === null ||
        parsed.awayScore === null ||
        typeof parsed.homeScore !== 'number' ||
        typeof parsed.awayScore !== 'number'
      ) {
        this.logger.warn(
          `LLM未找到比分: ${homeTeam} vs ${awayTeam} (source: ${parsed.source || 'unknown'})`,
        );
        return null;
      }

      this.logger.log(
        `LLM返回比分: ${homeTeam} ${parsed.homeScore}-${parsed.awayScore} ${awayTeam} (source: ${parsed.source || 'unknown'})`,
      );

      return {
        homeScore: parsed.homeScore,
        awayScore: parsed.awayScore,
      };
    } catch (err: any) {
      this.logger.warn(
        `LLM比分查询失败 (${homeTeam} vs ${awayTeam}): ${err.message}`,
      );
      return null;
    }
  }

  async backfillMissingScores(): Promise<{
    scanned: number;
    filled: number;
    failed: number;
  }> {
    const missing = await this.wcPredictionService.getMissingScorePredictions();

    if (missing.length === 0) {
      this.logger.log('比分兜底扫描: 无缺失比分的已结束比赛');
      return { scanned: 0, filled: 0, failed: 0 };
    }

    this.logger.log(
      `比分兜底扫描: 发现 ${missing.length} 场已结束但缺少比分的比赛，开始补全...`,
    );

    const dateGroups = new Map<string, typeof missing>();
    for (const pred of missing) {
      const datePart = pred.matchDate.split(' ')[0];
      if (!dateGroups.has(datePart)) {
        dateGroups.set(datePart, []);
      }
      dateGroups.get(datePart)!.push(pred);
    }

    let filled = 0;
    let failed = 0;

    for (const [datePart, preds] of dateGroups) {
      let apiMatches: MatchData[];
      try {
        apiMatches = await this.footballDataApi.fetchMatchesByDate(
          datePart,
          datePart,
        );
      } catch (err: any) {
        this.logger.warn(
          `比分兜底: 获取 ${datePart} 的比赛数据失败: ${err.message}`,
        );
        failed += preds.length;
        continue;
      }

      const finishedWithScore = apiMatches.filter(
        (m) =>
          m.status === 'FINISHED' &&
          m.homeScore !== null &&
          m.awayScore !== null,
      );

      for (const pred of preds) {
        const match = this.findMatchingMatch(pred, finishedWithScore);
        if (!match) {
          const tsdbMatch = await this.fetchFromTheSportsDB(
            pred.homeTeam,
            pred.awayTeam,
            datePart,
          );
          if (tsdbMatch) {
            const homeTeam = this.normalizeTeamName(tsdbMatch.homeTeam);
            const awayTeam = this.normalizeTeamName(tsdbMatch.awayTeam);
            try {
              const result = await this.wcPredictionService.updateMatchResult(
                homeTeam,
                awayTeam,
                tsdbMatch.homeScore!,
                tsdbMatch.awayScore!,
              );
              if (result) {
                filled++;
                await this.eloService.updateEloForMatch(
                  homeTeam,
                  awayTeam,
                  tsdbMatch.homeScore!,
                  tsdbMatch.awayScore!,
                  true,
                  'FIFA World Cup',
                );
                this.logger.log(
                  `比分兜底补全(TheSportsDB): ${homeTeam} ${tsdbMatch.homeScore}-${tsdbMatch.awayScore} ${awayTeam}`,
                );
                continue;
              }
            } catch (err: any) {
              this.logger.warn(
                `比分兜底(TheSportsDB): 更新失败 ${homeTeam} vs ${awayTeam}: ${err.message}`,
              );
            }
          }
          this.logger.warn(
            `比分兜底: 未找到匹配比赛 ${pred.homeTeam} vs ${pred.awayTeam} (${datePart})`,
          );
          failed++;
          continue;
        }

        const homeTeam = this.normalizeTeamName(match.homeTeam);
        const awayTeam = this.normalizeTeamName(match.awayTeam);

        try {
          const result = await this.wcPredictionService.updateMatchResult(
            homeTeam,
            awayTeam,
            match.homeScore!,
            match.awayScore!,
          );

          if (result) {
            filled++;
            await this.eloService.updateEloForMatch(
              homeTeam,
              awayTeam,
              match.homeScore!,
              match.awayScore!,
              true,
              'FIFA World Cup',
            );
            this.logger.log(
              `比分兜底补全: ${homeTeam} ${match.homeScore}-${match.awayScore} ${awayTeam}`,
            );
          } else {
            this.logger.warn(
              `比分兜底: updateMatchResult 返回 null ${homeTeam} vs ${awayTeam}`,
            );
            failed++;
          }
        } catch (err: any) {
          this.logger.warn(
            `比分兜底: 更新失败 ${homeTeam} vs ${awayTeam}: ${err.message}`,
          );
          failed++;
        }
      }
    }

    if (filled > 0) {
      this.logger.log(
        `✅ 比分兜底完成: 扫描 ${missing.length} 场，补全 ${filled} 场，失败 ${failed} 场`,
      );
      try {
        await this.wcPredictionService.regenerateUpcomingPredictions();
      } catch (err: any) {
        this.logger.error(
          `比分兜底后重新生成预测失败: ${err.message}`,
          err.stack,
        );
      }
    }

    return { scanned: missing.length, filled, failed };
  }

  private async fetchFromTheSportsDB(
    homeTeam: string,
    awayTeam: string,
    date: string,
  ): Promise<{
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
  } | null> {
    try {
      const url = `${THESPORTSDB_URL}/eventsday.php?d=${date}&s=Soccer`;
      const res = await axios.get(url, { timeout: 10000 });
      const events = res.data?.events || [];

      for (const e of events) {
        if (e.strLeague !== 'FIFA World Cup') continue;
        if (e.strStatus !== 'FT') continue;
        const hScore = parseInt(e.intHomeScore, 10);
        const aScore = parseInt(e.intAwayScore, 10);
        if (isNaN(hScore) || isNaN(aScore)) continue;

        if (
          this.fuzzyMatch(e.strHomeTeam, homeTeam) &&
          this.fuzzyMatch(e.strAwayTeam, awayTeam)
        ) {
          return {
            homeTeam: e.strHomeTeam,
            awayTeam: e.strAwayTeam,
            homeScore: hScore,
            awayScore: aScore,
          };
        }
      }
    } catch (err: any) {
      this.logger.warn(`TheSportsDB查询失败 (${date}): ${err.message}`);
    }
    return null;
  }

  private findMatchingMatch(
    pred: { homeTeam: string; awayTeam: string },
    apiMatches: MatchData[],
  ): MatchData | null {
    for (const m of apiMatches) {
      const apiHome = this.normalizeTeamName(m.homeTeam);
      const apiAway = this.normalizeTeamName(m.awayTeam);

      if (
        this.fuzzyMatch(apiHome, pred.homeTeam) &&
        this.fuzzyMatch(apiAway, pred.awayTeam)
      ) {
        return m;
      }
    }
    return null;
  }

  private fuzzyMatch(a: string, b: string): boolean {
    if (a === b) return true;
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalize(a) === normalize(b);
  }
}
