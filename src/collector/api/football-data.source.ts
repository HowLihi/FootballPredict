import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { IDataSource } from '../interfaces/data-source.interface';
import { MatchData } from '../interfaces/match.interface';

/**
 * football-data.org API 数据源
 *
 * 这是免费的足球数据API，提供欧洲主流联赛数据
 * 官网: https://www.football-data.org
 * 免费额度: 10次/分钟
 * 覆盖联赛: 英超、西甲、德甲、意甲、法甲等12个联赛
 *
 * 使用前需要到官网注册获取免费 API Token
 */
@Injectable()
export class FootballDataApiDataSource implements IDataSource {
  readonly name = 'football-data';

  // NestJS Logger，自动带上类名前缀，方便在日志中定位来源
  private readonly logger = new Logger(FootballDataApiDataSource.name);

  // axios 实例，配置了基础URL和认证头，避免每次请求都重复设置
  private readonly apiClient: AxiosInstance;

  /**
   * 联赛代码映射表
   * football-data.org 使用特定的联赛代码，这里做中英文映射
   * 后续调用 fetchMatches 时传入英文代码即可
   */
  private readonly leagueMap: Record<string, string> = {
    PL: 'Premier League', // 英超
    BL1: 'Bundesliga', // 德甲
    SA: 'Serie A', // 意甲
    PD: 'La Liga', // 西甲
    FL1: 'Ligue 1', // 法甲
    CL: 'Champions League', // 欧冠
    ELC: 'Championship', // 英冠
    DED: 'Eredivisie', // 荷甲
    PPL: 'Primeira Liga', // 葡超
    BSA: 'Serie A Brazil', // 巴甲
    WC: 'World Cup', // 世界杯
    EC: 'European Championship', // 欧洲杯
  };

  constructor() {
    // 从环境变量读取 API Token，不要硬编码在代码中
    const apiKey = process.env.FOOTBALL_DATA_API_KEY || '';

    // 创建 axios 实例，统一配置基础URL和请求头
    this.apiClient = axios.create({
      baseURL: 'https://api.football-data.org/v4',
      headers: {
        'X-Auth-Token': apiKey, // football-data.org 的认证方式
      },
      // 设置超时时间，避免请求卡死
      timeout: 10000,
    });

    // 如果没有配置 API Key，给出警告提示
    if (!apiKey) {
      this.logger.warn(
        'FOOTBALL_DATA_API_KEY 未设置！请到 https://www.football-data.org 注册获取免费Token，并设置环境变量',
      );
    }
  }

  /**
   * 获取指定联赛和赛季的比赛数据
   *
   * @param league 联赛代码 (如 'PL' 代表英超)
   * @param season 赛季年份 (如 '2023' 代表 2023-24 赛季)
   * @returns 标准化的比赛数据数组
   *
   * API 调用示例:
   * GET https://api.football-data.org/v4/competitions/PL/matches?season=2023
   */
  async fetchMatches(league: string, season: string): Promise<MatchData[]> {
    try {
      this.logger.log(`开始获取 ${league} ${season} 赛季比赛数据...`);

      // 调用 football-data.org API
      const response = await this.apiClient.get(
        `/competitions/${league}/matches`,
        { params: { season } },
      );

      // API 返回的数据在 response.data.matches 数组中
      const rawMatches = response.data.matches || [];
      this.logger.log(`获取到 ${rawMatches.length} 场比赛数据`);

      // 将 API 原始数据转换为我们定义的统一格式
      return rawMatches.map((match: any) => this.transformMatch(match));
    } catch (error) {
      // 记录错误日志，但不中断程序运行
      this.logger.error(`获取比赛数据失败: ${error.message}`, error.stack);
      // 返回空数组，避免上层调用出错
      return [];
    }
  }

  /**
   * 获取指定日期范围的比赛数据
   *
   * @param dateFrom 开始日期 (格式: 'YYYY-MM-DD')
   * @param dateTo 结束日期 (格式: 'YYYY-MM-DD')
   * @returns 标准化的比赛数据数组
   *
   * API 调用示例:
   * GET https://api.football-data.org/v4/matches?dateFrom=2023-08-01&dateTo=2023-08-31
   */
  async fetchMatchesByDate(
    dateFrom: string,
    dateTo: string,
  ): Promise<MatchData[]> {
    try {
      this.logger.log(`开始获取 ${dateFrom} ~ ${dateTo} 的比赛数据...`);

      const response = await this.apiClient.get('/matches', {
        params: { dateFrom, dateTo },
      });

      const rawMatches = response.data.matches || [];
      this.logger.log(`获取到 ${rawMatches.length} 场比赛数据`);

      return rawMatches.map((match: any) => this.transformMatch(match));
    } catch (error) {
      this.logger.error(`获取比赛数据失败: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * 将 football-data.org API 的原始数据转换为系统统一格式
   *
   * 这是数据标准化的核心方法，每个数据源都需要一个类似的转换方法
   * 将不同格式的原始数据映射到统一的 MatchData 接口
   *
   * @param rawMatch API 返回的原始比赛对象
   * @returns 标准化的 MatchData 对象
   */
  private transformMatch(rawMatch: any): MatchData {
    // 从 API 返回的 competition 对象中提取联赛信息
    const leagueCode = rawMatch.competition?.code || '';
    const leagueName =
      this.leagueMap[leagueCode] || rawMatch.competition?.name || 'Unknown';

    // 从 API 返回的 season 对象中提取赛季年份
    const seasonYear = rawMatch.season?.startDate
      ? new Date(rawMatch.season.startDate).getFullYear().toString()
      : '';

    // 解析比分信息
    // 优先取 fullTime，若为空则依次 fallback 到 extraTime / penalties
    const fullTime = rawMatch.score?.fullTime;
    const extraTime = rawMatch.score?.extraTime;
    const penalties = rawMatch.score?.penalties;

    const homeScore =
      fullTime?.home ?? extraTime?.home ?? penalties?.home ?? null;
    const awayScore =
      fullTime?.away ?? extraTime?.away ?? penalties?.away ?? null;

    // 将 API 的状态码映射为我们的统一状态
    const status = this.mapStatus(rawMatch.status);

    return {
      // 使用 API 返回的 id 作为外部ID，拼接来源前缀确保唯一性
      externalId: `fd-${rawMatch.id}`,
      source: this.name,
      league: leagueName,
      season: seasonYear,
      // 将 UTC 时间转换为日期字符串
      date: rawMatch.utcDate
        ? new Date(rawMatch.utcDate).toISOString().split('T')[0]
        : '',
      homeTeam: rawMatch.homeTeam?.name || 'Unknown',
      awayTeam: rawMatch.awayTeam?.name || 'Unknown',
      homeScore,
      awayScore,
      status,
      // football-data.org 免费版不提供详细技术统计，设为 null
      homeShots: null,
      awayShots: null,
      homeShotsOnTarget: null,
      awayShotsOnTarget: null,
      homeCorners: null,
      awayCorners: null,
      homeFouls: null,
      awayFouls: null,
      homeYellowCards: null,
      awayYellowCards: null,
      homeRedCards: null,
      awayRedCards: null,
    };
  }

  /**
   * 将 football-data.org 的状态码映射为系统统一状态
   *
   * API 返回的状态码有很多种，我们简化为三种:
   * - SCHEDULED: 未开始
   * - LIVE: 进行中
   * - FINISHED: 已结束
   *
   * @param apiStatus API 返回的原始状态码
   * @returns 统一的状态码
   */
  async searchTeam(name: string): Promise<{
    id: number;
    name: string;
    shortName: string;
    crest: string;
  } | null> {
    try {
      this.logger.log(`搜索球队: ${name}`);
      const response = await this.apiClient.get('/teams', {
        params: { name },
      });
      const teams = response.data.teams || [];
      if (teams.length === 0) {
        this.logger.warn(`未找到球队: ${name}`);
        return null;
      }

      const nameLower = name.toLowerCase();
      const exactMatch = teams.find(
        (t: any) =>
          t.name?.toLowerCase() === nameLower ||
          t.shortName?.toLowerCase() === nameLower ||
          t.tla?.toLowerCase() === nameLower,
      );
      const team = exactMatch || teams[0];

      return {
        id: team.id,
        name: team.name,
        shortName: team.shortName || team.tla || team.name,
        crest: team.crest || '',
      };
    } catch (error: any) {
      this.logger.error(`搜索球队失败: ${error.message}`);
      return null;
    }
  }

  async fetchTeamSquad(teamId: number): Promise<
    Array<{
      id: number;
      name: string;
      position: string;
      dateOfBirth: string;
      nationality: string;
    }>
  > {
    try {
      this.logger.log(`获取球队阵容: teamId=${teamId}`);
      const response = await this.apiClient.get(`/teams/${teamId}`);
      return response.data.squad || [];
    } catch (error: any) {
      this.logger.error(
        `获取球队阵容失败(teamId=${teamId}): ${error.message}，尝试通过联赛接口获取`,
      );
      return this.fetchSquadViaCompetitions(teamId);
    }
  }

  private async fetchSquadViaCompetitions(teamId: number): Promise<
    Array<{
      id: number;
      name: string;
      position: string;
      dateOfBirth: string;
      nationality: string;
    }>
  > {
    const currentYear = new Date().getFullYear();
    const season = currentYear - 1;
    const competitions = ['PL', 'BL1', 'SA', 'PD', 'FL1', 'CL'];

    for (const code of competitions) {
      try {
        this.logger.log(`通过联赛 ${code} 搜索 teamId=${teamId} 的阵容...`);
        const response = await this.apiClient.get(
          `/competitions/${code}/teams`,
          { params: { season } },
        );
        const teams = response.data.teams || [];
        const team = teams.find((t: any) => t.id === teamId);
        if (team && team.squad && team.squad.length > 0) {
          this.logger.log(
            `在联赛 ${code} 中找到 teamId=${teamId} 的阵容: ${team.squad.length} 名球员`,
          );
          return team.squad;
        }
      } catch (error: any) {
        this.logger.warn(`联赛 ${code} 查询失败: ${error.message}`);
      }
    }

    this.logger.warn(`在所有联赛中均未找到 teamId=${teamId} 的阵容`);
    return [];
  }

  async fetchAllCompetitionTeams(): Promise<
    Array<{
      id: number;
      name: string;
      shortName: string;
      crest: string;
      squad: Array<{
        id: number;
        name: string;
        position: string;
        dateOfBirth: string;
        nationality: string;
      }>;
    }>
  > {
    const currentYear = new Date().getFullYear();
    const season = currentYear - 1;
    const competitions = ['PL', 'BL1', 'SA', 'PD', 'FL1'];
    const allTeams: any[] = [];
    const seenIds = new Set<number>();

    for (const code of competitions) {
      try {
        this.logger.log(`获取联赛 ${code} 的球队和阵容...`);
        const response = await this.apiClient.get(
          `/competitions/${code}/teams`,
          { params: { season } },
        );
        const teams = response.data.teams || [];
        for (const team of teams) {
          if (!seenIds.has(team.id)) {
            seenIds.add(team.id);
            allTeams.push({
              id: team.id,
              name: team.name,
              shortName: team.shortName || team.tla || team.name,
              crest: team.crest || '',
              squad: team.squad || [],
            });
          }
        }
        this.logger.log(`联赛 ${code}: 获取 ${teams.length} 支球队`);
      } catch (error: any) {
        this.logger.warn(`联赛 ${code} 获取失败: ${error.message}`);
      }
    }

    this.logger.log(`共获取 ${allTeams.length} 支球队的阵容数据`);
    return allTeams;
  }

  async fetchWorldCupTeams(): Promise<
    Array<{
      id: number;
      name: string;
      shortName: string;
      crest: string;
      squad: Array<{
        id: number;
        name: string;
        position: string;
        dateOfBirth: string;
        nationality: string;
      }>;
    }>
  > {
    try {
      this.logger.log('获取世界杯国家队阵容...');
      const response = await this.apiClient.get('/competitions/WC/teams', {
        params: { season: 2026 },
      });
      const teams = response.data.teams || [];
      this.logger.log(`获取到 ${teams.length} 支世界杯国家队`);
      return teams.map((team: any) => ({
        id: team.id,
        name: team.name,
        shortName: team.shortName || team.tla || team.name,
        crest: team.crest || '',
        squad: team.squad || [],
      }));
    } catch (error: any) {
      this.logger.error(`获取世界杯国家队失败: ${error.message}`);
      return [];
    }
  }

  private mapStatus(apiStatus: string): 'SCHEDULED' | 'LIVE' | 'FINISHED' {
    switch (apiStatus) {
      case 'FINISHED':
        return 'FINISHED';
      case 'IN_PLAY':
      case 'PAUSED':
      case 'HALFTIME':
      case 'EXTRA_TIME':
      case 'PENALTY_SHOOTOUT':
        return 'LIVE';
      case 'SCHEDULED':
      case 'TIMED':
      case 'POSTPONED':
      case 'SUSPENDED':
      case 'CANCELED':
      default:
        return 'SCHEDULED';
    }
  }
}
