import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';
import { IDataSource } from '../interfaces/data-source.interface';
import { MatchData } from '../interfaces/match.interface';
import { OddsData } from '../interfaces/odds.interface';

/**
 * football-data.co.uk CSV 数据源
 *
 * 这是获取历史比赛数据+赔率数据的最佳免费来源
 * 官网: https://www.football-data.co.uk
 * 数据: 1993年至今，欧洲22个联赛
 * 格式: CSV文件，每行一场比赛
 * 特点: 包含多家博彩公司赔率数据（这是最核心的价值）
 *
 * CSV 文件中的列名说明:
 * - Div: 联赛代码 (如 E0=英超)
 * - Date: 比赛日期 (DD/MM/YYYY 格式)
 * - HomeTeam: 主队
 * - AwayTeam: 客队
 * - FTHG/FTAG: 全场主/客队进球
 * - FTR: 全场结果 (H=主胜, D=平, A=客胜)
 * - HS/AS: 主/客队射门数
 * - HST/AST: 主/客队射正数
 * - HC/AC: 主/客队角球数
 * - HF/AF: 主/客队犯规数
 * - HY/AY: 主/客队黄牌数
 * - HR/AR: 主/客队红牌数
 * - B365H/B365D/B365A: Bet365 主胜/平/客胜赔率
 * - PSH/PSD/PSA: Pinnacle 主胜/平/客胜赔率
 */
@Injectable()
export class CsvDataSource implements IDataSource {
  readonly name = 'csv';

  private readonly logger = new Logger(CsvDataSource.name);

  /**
   * CSV 联赛代码到联赛名称的映射
   * football-data.co.uk 使用简短的联赛代码
   */
  private readonly leagueCodeMap: Record<string, string> = {
    E0: 'Premier League', // 英超
    E1: 'Championship', // 英冠
    E2: 'League One', // 英甲
    E3: 'League Two', // 英乙
    SC0: 'Scottish Premiership', // 苏超
    D1: 'Bundesliga', // 德甲
    D2: 'Bundesliga 2', // 德乙
    SP1: 'La Liga', // 西甲
    SP2: 'La Liga 2', // 西乙
    I1: 'Serie A', // 意甲
    I2: 'Serie B', // 意乙
    F1: 'Ligue 1', // 法甲
    F2: 'Ligue 2', // 法乙
    N1: 'Eredivisie', // 荷甲
    B1: 'Jupiler League', // 比甲
    P1: 'Primeira Liga', // 葡超
    T1: 'Super Lig', // 土超
    G1: 'Super League', // 希超
  };

  /**
   * 赔率列名配置
   * 定义了 CSV 中哪些列是赔率数据
   * 每个赔率来源包含三个字段: 主胜、平局、客胜
   */
  private readonly oddsColumns = [
    { source: 'B365', home: 'B365H', draw: 'B365D', away: 'B365A' }, // Bet365
    { source: 'BW', home: 'BWH', draw: 'BWD', away: 'BWA' }, // Bet&Win
    { source: 'IW', home: 'IWH', draw: 'IWD', away: 'IWA' }, // Interwetten
    { source: 'PS', home: 'PSH', draw: 'PSD', away: 'PSA' }, // Pinnacle
    { source: 'WH', home: 'WHH', draw: 'WHD', away: 'WHA' }, // William Hill
    { source: 'VC', home: 'VCH', draw: 'VCD', away: 'VCA' }, // VC Bet
  ];

  /**
   * 从本地 CSV 文件获取比赛数据
   *
   * CSV 文件需要从 https://www.football-data.co.uk 手动下载
   * 下载后放到项目的 data/csv/ 目录下
   * 文件命名格式: {联赛代码}_{赛季}.csv (如 E0_2023.csv)
   *
   * @param league 联赛代码 (如 'E0' 代表英超)
   * @param season 赛季 (如 '2023')
   * @returns 标准化的比赛数据数组
   */
  async fetchMatches(league: string, season: string): Promise<MatchData[]> {
    // 构建 CSV 文件路径
    const filePath = this.getCsvFilePath(league, season);

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      this.logger.warn(
        `CSV 文件不存在: ${filePath}，请先从 football-data.co.uk 下载`,
      );
      return [];
    }

    try {
      this.logger.log(`开始解析 CSV 文件: ${filePath}`);

      // 读取并解析 CSV 文件
      const records = await this.parseCsvFile(filePath);
      this.logger.log(`解析到 ${records.length} 条比赛记录`);

      // 将每条 CSV 记录转换为标准格式
      return records
        .filter((record) => this.isValidRecord(record)) // 过滤无效记录
        .map((record) => this.transformRecord(record, season));
    } catch (error) {
      this.logger.error(`解析 CSV 文件失败: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * CSV 数据源不支持按日期范围查询
   * 因为 CSV 是全赛季数据，无法按日期筛选
   * 这里在获取全量数据后做日期过滤
   */
  async fetchMatchesByDate(
    dateFrom: string,
    dateTo: string,
  ): Promise<MatchData[]> {
    // CSV 数据源不支持按日期范围查询，返回空数组
    // 如果需要，可以先获取全量数据再过滤
    this.logger.warn(
      'CSV 数据源不支持按日期范围查询，请使用 fetchMatches 获取全赛季数据',
    );
    return [];
  }

  /**
   * 从 CSV 文件中提取赔率数据
   * 这是 CSV 数据源的核心优势 - 包含多家博彩公司的赔率
   *
   * @param league 联赛代码
   * @param season 赛季
   * @returns 赔率数据数组
   */
  async fetchOdds(league: string, season: string): Promise<OddsData[]> {
    const filePath = this.getCsvFilePath(league, season);

    if (!fs.existsSync(filePath)) {
      this.logger.warn(`CSV 文件不存在: ${filePath}`);
      return [];
    }

    try {
      const records = await this.parseCsvFile(filePath);
      const allOdds: OddsData[] = [];

      // 遍历每条比赛记录
      for (const record of records) {
        if (!this.isValidRecord(record)) continue;

        // 从每条记录中提取所有博彩公司的赔率
        for (const oddsCol of this.oddsColumns) {
          const homeWin = this.parseNumber(record[oddsCol.home]);
          const draw = this.parseNumber(record[oddsCol.draw]);
          const awayWin = this.parseNumber(record[oddsCol.away]);

          // 只有三个赔率都存在时才添加
          if (homeWin !== null && draw !== null && awayWin !== null) {
            allOdds.push({
              matchExternalId: this.buildExternalId(record, season),
              source: oddsCol.source,
              date: this.parseDate(record['Date']),
              homeTeam: record['HomeTeam']?.trim() || '',
              awayTeam: record['AwayTeam']?.trim() || '',
              homeWin,
              draw,
              awayWin,
            });
          }
        }
      }

      this.logger.log(`从 CSV 中提取到 ${allOdds.length} 条赔率数据`);
      return allOdds;
    } catch (error) {
      this.logger.error(`提取赔率数据失败: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * 构建 CSV 文件路径
   * 文件存放在项目的 data/csv/ 目录下
   *
   * @param league 联赛代码
   * @param season 赛季
   * @returns 文件的绝对路径
   */
  private getCsvFilePath(league: string, season: string): string {
    // 使用 process.cwd() 获取项目根目录，确保路径正确
    const dataDir = path.join(process.cwd(), 'data', 'csv');
    return path.join(dataDir, `${league}_${season}.csv`);
  }

  /**
   * 解析 CSV 文件
   *
   * 使用 csv-parse 库解析 CSV 文件
   * 配置说明:
   * - columns: true → 第一行作为列名，每行记录变为对象而非数组
   * - skip_empty_lines: true → 跳过空行
   * - relax_quotes: true → 宽松处理引号，避免格式问题导致解析失败
   * - trim: true → 去除字段首尾空格
   *
   * @param filePath CSV 文件路径
   * @returns 解析后的记录数组，每条记录是一个键值对对象
   */
  private async parseCsvFile(
    filePath: string,
  ): Promise<Record<string, string>[]> {
    return new Promise((resolve, reject) => {
      const records: Record<string, string>[] = [];

      // 创建可读流并管道到 csv 解析器
      fs.createReadStream(filePath, { encoding: 'utf-8' })
        .pipe(
          parse({
            columns: true, // 第一行作为列名
            skip_empty_lines: true, // 跳过空行
            relax_quotes: true, // 宽松引号处理
            trim: true, // 去除空格
          }),
        )
        // 每解析一行就推入数组
        .on('data', (record: Record<string, string>) => {
          records.push(record);
        })
        // 解析完成
        .on('end', () => {
          resolve(records);
        })
        // 解析出错
        .on('error', (error: Error) => {
          reject(error);
        });
    });
  }

  /**
   * 将 CSV 记录转换为标准化的 MatchData 格式
   *
   * @param record CSV 中的一行记录（键值对对象）
   * @param season 赛季年份
   * @returns 标准化的比赛数据
   */
  private transformRecord(
    record: Record<string, string>,
    season: string,
  ): MatchData {
    // 联赛代码转换为联赛名称
    const leagueCode = record['Div'] || '';
    const leagueName = this.leagueCodeMap[leagueCode] || leagueCode;

    return {
      externalId: this.buildExternalId(record, season),
      source: this.name,
      league: leagueName,
      season,
      date: this.parseDate(record['Date']),
      homeTeam: record['HomeTeam']?.trim() || 'Unknown',
      awayTeam: record['AwayTeam']?.trim() || 'Unknown',
      // FTHG = Full Time Home Goals, FTAG = Full Time Away Goals
      homeScore: this.parseNumber(record['FTHG']),
      awayScore: this.parseNumber(record['FTAG']),
      // 有比分说明比赛已结束
      status:
        record['FTHG'] !== undefined && record['FTHG'] !== ''
          ? 'FINISHED'
          : 'SCHEDULED',
      // 技术统计数据
      homeShots: this.parseNumber(record['HS']),
      awayShots: this.parseNumber(record['AS']),
      homeShotsOnTarget: this.parseNumber(record['HST']),
      awayShotsOnTarget: this.parseNumber(record['AST']),
      homeCorners: this.parseNumber(record['HC']),
      awayCorners: this.parseNumber(record['AC']),
      homeFouls: this.parseNumber(record['HF']),
      awayFouls: this.parseNumber(record['AF']),
      homeYellowCards: this.parseNumber(record['HY']),
      awayYellowCards: this.parseNumber(record['AY']),
      homeRedCards: this.parseNumber(record['HR']),
      awayRedCards: this.parseNumber(record['AR']),
    };
  }

  /**
   * 构建外部ID
   * 使用 赛季+日期+主队+客队 组合生成唯一标识
   * 这样即使没有 API 返回的 ID，也能保证唯一性
   */
  private buildExternalId(
    record: Record<string, string>,
    season: string,
  ): string {
    const date = this.parseDate(record['Date']);
    const home = record['HomeTeam']?.trim() || '';
    const away = record['AwayTeam']?.trim() || '';
    // 用下划线连接各部分，生成如 "csv-2023_2023-08-13_Arsenal_Chelsea" 的ID
    return `csv-${season}_${date}_${home}_${away}`;
  }

  /**
   * 解析 CSV 中的日期格式
   * football-data.co.uk 使用 DD/MM/YYYY 格式
   * 需要转换为标准的 YYYY-MM-DD 格式
   *
   * @param dateStr CSV 中的日期字符串 (如 '13/08/2023')
   * @returns 标准格式日期 (如 '2023-08-13')
   */
  private parseDate(dateStr: string): string {
    if (!dateStr) return '';

    // 处理 DD/MM/YYYY 格式
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      // 补零确保两位数格式
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    // 如果已经是 YYYY-MM-DD 格式，直接返回
    return dateStr;
  }

  /**
   * 安全地将字符串解析为数字
   * CSV 中的数字字段可能为空或非数字，需要安全处理
   *
   * @param value CSV 中的原始字符串值
   * @returns 解析后的数字，解析失败返回 null
   */
  private parseNumber(value: string | undefined): number | null {
    if (!value || value.trim() === '') return null;
    const num = Number(value);
    return isNaN(num) ? null : num;
  }

  /**
   * 检查 CSV 记录是否有效
   * 过滤掉缺少关键字段的记录（如空行、标题行等）
   *
   * @param record CSV 记录
   * @returns 是否有效
   */
  private isValidRecord(record: Record<string, string>): boolean {
    // 必须有主队和客队名称
    return !!(record['HomeTeam']?.trim() && record['AwayTeam']?.trim());
  }
}
