import { MatchData } from './match.interface';
import { OddsData } from './odds.interface';

/**
 * 数据源接口 - 所有数据源(API、CSV等)都必须实现这个接口
 * 这是策略模式的应用，方便切换和扩展不同的数据源
 * 新增数据源时，只需实现这个接口，无需修改已有代码
 */
export interface IDataSource {
  // 数据源名称，用于标识和日志记录
  readonly name: string;

  /**
   * 获取指定联赛和赛季的比赛数据
   * @param league 联赛代码 (如 'PL' 代表英超)
   * @param season 赛季 (如 '2023')
   * @returns 比赛数据数组
   */
  fetchMatches(league: string, season: string): Promise<MatchData[]>;

  /**
   * 获取指定日期范围的比赛数据
   * @param dateFrom 开始日期 (格式: 'YYYY-MM-DD')
   * @param dateTo 结束日期 (格式: 'YYYY-MM-DD')
   * @returns 比赛数据数组
   */
  fetchMatchesByDate(dateFrom: string, dateTo: string): Promise<MatchData[]>;

  /**
   * 获取赔率数据 (可选方法，部分数据源不支持赔率)
   * @param league 联赛代码
   * @param season 赛季
   * @returns 赔率数据数组，不支持时返回空数组
   */
  fetchOdds?(league: string, season: string): Promise<OddsData[]>;
}
