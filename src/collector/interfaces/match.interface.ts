/**
 * 比赛数据接口 - 定义从外部数据源获取的原始比赛数据结构
 * 不同数据源的数据都会被转换为这个统一格式，方便后续统一处理
 */
export interface MatchData {
  // 外部数据源的唯一标识，用于去重
  externalId: string;
  // 数据来源标识 (如 'football-data', 'api-football', 'csv')
  source: string;
  // 联赛名称 (如 'Premier League')
  league: string;
  // 赛季 (如 '2023')
  season: string;
  // 比赛日期 (ISO 格式，如 '2023-08-13')
  date: string;
  // 主队名称
  homeTeam: string;
  // 客队名称
  awayTeam: string;
  // 主队进球数 (未开始时为 null)
  homeScore: number | null;
  // 客队进球数 (未开始时为 null)
  awayScore: number | null;
  // 比赛状态: SCHEDULED(未开始) / LIVE(进行中) / FINISHED(已结束)
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED';
  // 主队射门数
  homeShots: number | null;
  // 客队射门数
  awayShots: number | null;
  // 主队射正数
  homeShotsOnTarget: number | null;
  // 客队射正数
  awayShotsOnTarget: number | null;
  // 主队角球数
  homeCorners: number | null;
  // 客队角球数
  awayCorners: number | null;
  // 主队犯规数
  homeFouls: number | null;
  // 客队犯规数
  awayFouls: number | null;
  // 主队黄牌数
  homeYellowCards: number | null;
  // 客队黄牌数
  awayYellowCards: number | null;
  // 主队红牌数
  homeRedCards: number | null;
  // 客队红牌数
  awayRedCards: number | null;
}
