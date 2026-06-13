import { Controller, Get, Query, Logger } from '@nestjs/common';
import { CollectorService } from './collector.service';

/**
 * 数据采集控制器 - 提供 HTTP API 接口手动触发数据采集
 *
 * 接口列表:
 * GET /collector/matches     - 采集比赛数据
 * GET /collector/odds        - 采集赔率数据
 * GET /collector/all         - 一键采集所有联赛
 * GET /collector/status      - 查看采集状态
 *
 * 这些接口主要用于:
 * 1. 首次导入历史数据
 * 2. 手动补充缺失数据
 * 3. 开发调试
 */
@Controller('collector')
export class CollectorController {
  private readonly logger = new Logger(CollectorController.name);

  constructor(private readonly collectorService: CollectorService) {}

  /**
   * 采集比赛数据
   *
   * GET /collector/matches?source=csv&league=E0&season=2023
   *
   * @param source 数据源名称 (默认: 'csv')
   * @param league 联赛代码 (默认: 'E0' 英超)
   * @param season 赛季年份 (默认: 当前赛季)
   * @returns 保存的记录数
   */
  @Get('matches')
  async collectMatches(
    @Query('source') source: string = 'csv',
    @Query('league') league: string = 'E0',
    @Query('season') season?: string,
  ): Promise<{
    source: string;
    league: string;
    season: string;
    count: number;
  }> {
    // 如果没有传赛季参数，自动计算当前赛季
    const currentSeason = season || this.getCurrentSeason();

    this.logger.log(
      `手动触发采集: source=${source}, league=${league}, season=${currentSeason}`,
    );

    const count = await this.collectorService.collectMatches(
      source,
      league,
      currentSeason,
    );

    return {
      source,
      league,
      season: currentSeason,
      count,
    };
  }

  /**
   * 采集赔率数据
   *
   * GET /collector/odds?league=E0&season=2023
   *
   * @param league 联赛代码 (CSV格式)
   * @param season 赛季年份
   * @returns 保存的赔率记录数
   */
  @Get('odds')
  async collectOdds(
    @Query('league') league: string = 'E0',
    @Query('season') season?: string,
  ): Promise<{ league: string; season: string; count: number }> {
    const currentSeason = season || this.getCurrentSeason();

    const count = await this.collectorService.collectOdds(
      league,
      currentSeason,
    );

    return {
      league,
      season: currentSeason,
      count,
    };
  }

  /**
   * 一键采集所有联赛数据
   *
   * GET /collector/all?season=2023&source=csv
   *
   * @param season 赛季年份
   * @param source 数据源名称
   * @returns 各联赛的采集结果
   */
  @Get('all')
  async collectAll(
    @Query('season') season?: string,
    @Query('source') source: string = 'csv',
  ): Promise<{
    season: string;
    source: string;
    results: Record<string, number>;
  }> {
    const currentSeason = season || this.getCurrentSeason();

    this.logger.log(
      `手动触发全量采集: season=${currentSeason}, source=${source}`,
    );

    const results = await this.collectorService.collectAllLeagues(
      currentSeason,
      source,
    );

    return {
      season: currentSeason,
      source,
      results,
    };
  }

  /**
   * 查看采集状态
   * 返回系统配置信息，方便调试
   *
   * GET /collector/status
   */
  @Get('status')
  getStatus(): {
    status: string;
    currentSeason: string;
    supportedLeagues: string[];
    availableSources: string[];
  } {
    return {
      status: 'running',
      currentSeason: this.getCurrentSeason(),
      supportedLeagues: ['E0', 'D1', 'I1', 'SP1', 'F1'],
      availableSources: ['csv', 'football-data'],
    };
  }

  /**
   * 计算当前赛季年份
   * 足球赛季跨年，8月-次年5月为一个赛季
   * 所以1-6月属于上一年开始的赛季
   *
   * @returns 赛季年份字符串 (如 '2023')
   */
  private getCurrentSeason(): string {
    const now = new Date();
    return now.getMonth() < 6
      ? (now.getFullYear() - 1).toString()
      : now.getFullYear().toString();
  }
}
