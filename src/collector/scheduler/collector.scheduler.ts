import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CollectorService } from '../collector.service';

/**
 * 数据采集定时任务
 *
 * 使用 NestJS 的 @nestjs/schedule 模块实现定时任务
 * 定时从各数据源采集最新的比赛数据
 *
 * Cron表达式说明:
 * 格式: 秒 分 时 日 月 星期
 * 示例:
 *   每天2点     = 0 0 2 * * *
 *   每30分钟    = 0 每30分 * * * *
 *   每6小时     = 0 0 每6时 * * *
 *
 * 注意: 定时任务需要在 AppModule 中注册 ScheduleModule 才能生效
 */
@Injectable()
export class CollectorScheduler {
  private readonly logger = new Logger(CollectorScheduler.name);

  constructor(
    // 注入数据采集服务
    private readonly collectorService: CollectorService,
  ) {}

  /**
   * 每天凌晨2点采集最新比赛数据
   *
   * 采集逻辑:
   * 1. 获取当前赛季年份
   * 2. 从 API 数据源获取最新比赛数据（比分更新等）
   * 3. 记录采集结果
   *
   * Cron: 每天 02:00:00 执行
   */
  @Cron('0 0 2 * * *', {
    name: 'daily-match-collection', // 任务名称，方便日志追踪
  })
  async handleDailyCollection(): Promise<void> {
    this.logger.log('⏰ 定时任务触发: 每日比赛数据采集');

    // 计算当前赛季年份
    // 足球赛季跨年，如 2023-24 赛季，我们用起始年份表示
    const now = new Date();
    // 如果月份在1-6月，赛季从去年开始 (如2024年1月属于2023-24赛季)
    const season =
      now.getMonth() < 6
        ? (now.getFullYear() - 1).toString()
        : now.getFullYear().toString();

    try {
      // 从 football-data.org API 采集最新数据
      const results = await this.collectorService.collectAllLeagues(
        season,
        'football-data',
      );

      this.logger.log(`✅ 每日采集完成: ${JSON.stringify(results)}`);
    } catch (error: any) {
      this.logger.error(`❌ 每日采集失败: ${error.message}`, error.stack);
    }
  }

  /**
   * 每30分钟采集进行中的比赛数据
   *
   * 比赛进行时比分会实时变化，需要更频繁地更新
   * 只采集当天进行中的比赛，减少 API 调用次数
   *
   * Cron: 每30分钟执行一次
   */
  @Cron('0 */30 * * * *', {
    name: 'live-match-collection',
  })
  async handleLiveCollection(): Promise<void> {
    this.logger.log('⏰ 定时任务触发: 实时比赛数据采集');

    try {
      // 获取今天的日期范围
      const today = new Date().toISOString().split('T')[0];

      // 获取 API 数据源
      const matches = await this.collectorService.collectMatches(
        'football-data',
        'PL', // 只采集英超，减少API调用
        today.split('-')[0],
      );

      this.logger.log(`✅ 实时采集完成: 更新 ${matches} 条数据`);
    } catch (error: any) {
      this.logger.error(`❌ 实时采集失败: ${error.message}`, error.stack);
    }
  }
}
