import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Match } from '../match/match.entity';
import { Odds } from '../odds/odds.entity';
import { MatchData } from './interfaces/match.interface';
import { OddsData } from './interfaces/odds.interface';
import { IDataSource } from './interfaces/data-source.interface';
import { FootballDataApiDataSource } from './api/football-data.source';
import { CsvDataSource } from './csv/csv-data.source';

/**
 * 数据采集服务 - 整个数据采集模块的核心
 *
 * 职责:
 * 1. 管理多个数据源 (API、CSV等)
 * 2. 从数据源获取数据并保存到数据库
 * 3. 处理数据去重 (同一比赛不重复导入)
 * 4. 提供手动触发采集的接口
 *
 * 设计思路:
 * - 使用策略模式，通过 IDataSource 接口统一不同数据源
 * - 新增数据源只需实现 IDataSource 接口并注册到 dataSources 数组
 * - 使用 upsert 策略处理数据去重，避免重复导入
 */
@Injectable()
export class CollectorService {
  private readonly logger = new Logger(CollectorService.name);

  // 存储所有已注册的数据源，通过 name 属性索引
  private readonly dataSources: Map<string, IDataSource> = new Map();

  /**
   * 要采集的联赛配置
   * 可以根据需要增减联赛
   * 每个联赛包含: API代码 和 CSV代码
   */
  private readonly leagues = [
    { name: 'Premier League', apiCode: 'PL', csvCode: 'E0' },
    { name: 'Bundesliga', apiCode: 'BL1', csvCode: 'D1' },
    { name: 'Serie A', apiCode: 'SA', csvCode: 'I1' },
    { name: 'La Liga', apiCode: 'PD', csvCode: 'SP1' },
    { name: 'Ligue 1', apiCode: 'FL1', csvCode: 'F1' },
  ];

  constructor(
    // 注入 Match 实体的 Repository，用于数据库操作
    @InjectRepository(Match)
    private readonly matchRepository: Repository<Match>,

    // 注入 Odds 实体的 Repository
    @InjectRepository(Odds)
    private readonly oddsRepository: Repository<Odds>,

    // 注入 API 数据源
    private readonly footballDataApi: FootballDataApiDataSource,

    // 注入 CSV 数据源
    private readonly csvDataSource: CsvDataSource,
  ) {
    // 注册所有数据源到 Map 中，方便按名称查找
    this.registerDataSource(this.footballDataApi);
    this.registerDataSource(this.csvDataSource);
  }

  /**
   * 注册数据源
   * 将数据源添加到 Map 中，以 name 为 key
   *
   * @param dataSource 实现 IDataSource 接口的数据源实例
   */
  private registerDataSource(dataSource: IDataSource): void {
    this.dataSources.set(dataSource.name, dataSource);
    this.logger.log(`已注册数据源: ${dataSource.name}`);
  }

  /**
   * 从指定数据源获取比赛数据并保存到数据库
   *
   * 流程:
   * 1. 根据名称查找数据源
   * 2. 从数据源获取原始数据
   * 3. 将原始数据转换为数据库实体
   * 4. 使用 upsert 保存（存在则更新，不存在则插入）
   *
   * @param sourceName 数据源名称 (如 'football-data', 'csv')
   * @param league 联赛代码
   * @param season 赛季
   * @returns 保存的比赛记录数
   */
  async collectMatches(
    sourceName: string,
    league: string,
    season: string,
  ): Promise<number> {
    // 查找数据源
    const dataSource = this.dataSources.get(sourceName);
    if (!dataSource) {
      this.logger.error(`数据源不存在: ${sourceName}`);
      return 0;
    }

    this.logger.log(
      `开始从 ${sourceName} 采集 ${league} ${season} 赛季比赛数据...`,
    );

    // 从数据源获取比赛数据
    const matchesData = await dataSource.fetchMatches(league, season);
    this.logger.log(`获取到 ${matchesData.length} 条比赛数据`);

    if (matchesData.length === 0) {
      return 0;
    }

    // 将 MatchData 转换为 Match 实体
    const entities = matchesData.map((data) => this.toMatchEntity(data));

    // 批量保存到数据库（upsert 策略）
    const savedCount = await this.upsertMatches(entities);
    this.logger.log(`成功保存 ${savedCount} 条比赛数据`);

    return savedCount;
  }

  /**
   * 从 CSV 数据源获取赔率数据并保存到数据库
   *
   * 目前只有 CSV 数据源支持赔率数据
   * 后续可以扩展其他赔率数据源
   *
   * @param league 联赛代码 (CSV格式，如 'E0')
   * @param season 赛季
   * @returns 保存的赔率记录数
   */
  async collectOdds(league: string, season: string): Promise<number> {
    this.logger.log(`开始采集 ${league} ${season} 赛季赔率数据...`);

    // 检查 CSV 数据源是否支持赔率
    if (!this.csvDataSource.fetchOdds) {
      this.logger.warn('CSV 数据源不支持赔率数据');
      return 0;
    }

    // 获取赔率数据
    const oddsData = await this.csvDataSource.fetchOdds(league, season);
    this.logger.log(`获取到 ${oddsData.length} 条赔率数据`);

    if (oddsData.length === 0) {
      return 0;
    }

    // 转换为实体并保存
    const entities = oddsData.map((data) => this.toOddsEntity(data));
    const savedCount = await this.upsertOdds(entities);
    this.logger.log(`成功保存 ${savedCount} 条赔率数据`);

    return savedCount;
  }

  /**
   * 一键采集所有配置联赛的数据
   * 同时采集比赛数据和赔率数据
   *
   * @param season 赛季
   * @param sourceName 数据源名称
   * @returns 各联赛的采集结果
   */
  async collectAllLeagues(
    season: string,
    sourceName: string = 'csv',
  ): Promise<Record<string, number>> {
    const results: Record<string, number> = {};

    this.logger.log(
      `开始采集 ${season} 赛季所有联赛数据 (数据源: ${sourceName})`,
    );

    for (const league of this.leagues) {
      try {
        // 根据数据源选择对应的联赛代码
        const leagueCode =
          sourceName === 'csv' ? league.csvCode : league.apiCode;

        // 采集比赛数据
        const matchCount = await this.collectMatches(
          sourceName,
          leagueCode,
          season,
        );

        // 如果是 CSV 数据源，同时采集赔率数据
        let oddsCount = 0;
        if (sourceName === 'csv') {
          oddsCount = await this.collectOdds(leagueCode, season);
        }

        results[league.name] = matchCount;
        this.logger.log(
          `${league.name}: 比赛=${matchCount}, 赔率=${oddsCount}`,
        );
      } catch (error: any) {
        this.logger.error(`采集 ${league.name} 数据失败: ${error.message}`);
        results[league.name] = 0;
      }
    }

    return results;
  }

  /**
   * 批量保存比赛数据 (Upsert 策略)
   *
   * Upsert = Update + Insert
   * 如果 externalId 已存在则更新，不存在则插入
   * 这样可以安全地重复采集，不会产生重复数据
   *
   * @param entities Match 实体数组
   * @returns 保存的记录数
   */
  private async upsertMatches(entities: Match[]): Promise<number> {
    if (entities.length === 0) return 0;

    const BATCH_SIZE = 100;
    let totalSaved = 0;

    try {
      for (let i = 0; i < entities.length; i += BATCH_SIZE) {
        const batch = entities.slice(i, i + BATCH_SIZE);

        await this.matchRepository.upsert(batch, {
          conflictPaths: ['externalId'],
        });

        totalSaved += batch.length;
      }

      return totalSaved;
    } catch (error: any) {
      this.logger.error(`保存比赛数据失败: ${error.message}`, error.stack);
      return 0;
    }
  }

  /**
   * 批量保存赔率数据 (Upsert 策略)
   *
   * 由于赔率数据量可能很大(一场比赛有6家博彩公司赔率)，
   * SQLite 对单次 SQL 的表达式深度有限制(最大1000)，
   * 所以需要分批插入，每批100条
   *
   * @param entities Odds 实体数组
   * @returns 保存的记录数
   */
  private async upsertOdds(entities: Odds[]): Promise<number> {
    if (entities.length === 0) return 0;

    // 每批处理的最大条数，避免 SQLite 表达式树过深
    const BATCH_SIZE = 100;
    let totalSaved = 0;

    try {
      // 将数据分批处理
      for (let i = 0; i < entities.length; i += BATCH_SIZE) {
        const batch = entities.slice(i, i + BATCH_SIZE);

        await this.oddsRepository.upsert(batch, {
          conflictPaths: ['matchExternalId', 'source'],
        });

        totalSaved += batch.length;
      }

      return totalSaved;
    } catch (error: any) {
      this.logger.error(`保存赔率数据失败: ${error.message}`, error.stack);
      return totalSaved;
    }
  }

  /**
   * 将 MatchData 接口转换为 Match 数据库实体
   * 这是接口层到持久化层的转换
   *
   * @param data 标准化的比赛数据
   * @returns Match 实体
   */
  private toMatchEntity(data: MatchData): Match {
    const entity = new Match();
    entity.externalId = data.externalId;
    entity.source = data.source;
    entity.league = data.league;
    entity.season = data.season;
    entity.date = data.date;
    entity.homeTeam = data.homeTeam;
    entity.awayTeam = data.awayTeam;
    entity.homeScore = data.homeScore;
    entity.awayScore = data.awayScore;
    entity.status = data.status;
    entity.homeShots = data.homeShots;
    entity.awayShots = data.awayShots;
    entity.homeShotsOnTarget = data.homeShotsOnTarget;
    entity.awayShotsOnTarget = data.awayShotsOnTarget;
    entity.homeCorners = data.homeCorners;
    entity.awayCorners = data.awayCorners;
    entity.homeFouls = data.homeFouls;
    entity.awayFouls = data.awayFouls;
    entity.homeYellowCards = data.homeYellowCards;
    entity.awayYellowCards = data.awayYellowCards;
    entity.homeRedCards = data.homeRedCards;
    entity.awayRedCards = data.awayRedCards;
    return entity;
  }

  /**
   * 将 OddsData 接口转换为 Odds 数据库实体
   *
   * @param data 标准化的赔率数据
   * @returns Odds 实体
   */
  private toOddsEntity(data: OddsData): Odds {
    const entity = new Odds();
    entity.matchExternalId = data.matchExternalId;
    entity.source = data.source;
    entity.date = data.date;
    entity.homeTeam = data.homeTeam;
    entity.awayTeam = data.awayTeam;
    entity.homeWin = data.homeWin;
    entity.draw = data.draw;
    entity.awayWin = data.awayWin;
    return entity;
  }
}
