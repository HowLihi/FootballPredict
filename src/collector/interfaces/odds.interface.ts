/**
 * 赔率数据接口 - 定义从外部数据源获取的赔率数据结构
 * 赔率是预测模型中最重要的特征之一，因为赔率反映了市场对比赛结果的预期
 */
export interface OddsData {
  // 关联的比赛外部ID，用于和比赛数据关联
  matchExternalId: string;
  // 赔率来源 (如 'B365' = Bet365, 'PS' = Pinnacle)
  source: string;
  // 比赛日期
  date: string;
  // 主队名称
  homeTeam: string;
  // 客队名称
  awayTeam: string;
  // 主胜赔率 (如 1.53 表示投100元赢53元)
  homeWin: number | null;
  // 平局赔率
  draw: number | null;
  // 客胜赔率
  awayWin: number | null;
}
