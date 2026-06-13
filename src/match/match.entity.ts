import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 比赛实体 - 对应数据库中的 matches 表
 * 存储从各数据源采集并标准化后的比赛数据
 * 使用 TypeORM 装饰器定义表结构和索引
 */
@Entity('matches')
export class Match {
  // 自增主键
  @PrimaryGeneratedColumn()
  id: number;

  // 外部数据源ID，与 source 组合创建唯一索引，防止重复导入同一条数据
  @Index({ unique: true })
  @Column({ name: 'external_id' })
  externalId: string;

  // 数据来源 (如 'football-data', 'csv')
  @Column({ name: 'source', length: 50 })
  source: string;

  // 联赛名称 (如 'Premier League')
  @Column({ length: 100 })
  league: string;

  // 赛季 (如 '2023')
  @Column({ length: 10 })
  season: string;

  // 比赛日期
  @Column({ type: 'date' })
  date: string;

  // 主队名称
  @Column({ name: 'home_team', length: 100 })
  homeTeam: string;

  // 客队名称
  @Column({ name: 'away_team', length: 100 })
  awayTeam: string;

  // 主队进球 (可为空，比赛未开始时)
  @Column({ name: 'home_score', type: 'integer', nullable: true })
  homeScore: number | null;

  // 客队进球 (可为空，比赛未开始时)
  @Column({ name: 'away_score', type: 'integer', nullable: true })
  awayScore: number | null;

  // 比赛状态: SCHEDULED / LIVE / FINISHED
  @Column({ length: 20, default: 'SCHEDULED' })
  status: string;

  // 主队射门数
  @Column({ name: 'home_shots', type: 'integer', nullable: true })
  homeShots: number | null;

  // 客队射门数
  @Column({ name: 'away_shots', type: 'integer', nullable: true })
  awayShots: number | null;

  // 主队射正数
  @Column({ name: 'home_shots_on_target', type: 'integer', nullable: true })
  homeShotsOnTarget: number | null;

  // 客队射正数
  @Column({ name: 'away_shots_on_target', type: 'integer', nullable: true })
  awayShotsOnTarget: number | null;

  // 主队角球数
  @Column({ name: 'home_corners', type: 'integer', nullable: true })
  homeCorners: number | null;

  // 客队角球数
  @Column({ name: 'away_corners', type: 'integer', nullable: true })
  awayCorners: number | null;

  // 主队犯规数
  @Column({ name: 'home_fouls', type: 'integer', nullable: true })
  homeFouls: number | null;

  // 客队犯规数
  @Column({ name: 'away_fouls', type: 'integer', nullable: true })
  awayFouls: number | null;

  // 主队黄牌数
  @Column({ name: 'home_yellow_cards', type: 'integer', nullable: true })
  homeYellowCards: number | null;

  // 客队黄牌数
  @Column({ name: 'away_yellow_cards', type: 'integer', nullable: true })
  awayYellowCards: number | null;

  // 主队红牌数
  @Column({ name: 'home_red_cards', type: 'integer', nullable: true })
  homeRedCards: number | null;

  // 客队红牌数
  @Column({ name: 'away_red_cards', type: 'integer', nullable: true })
  awayRedCards: number | null;

  // 记录创建时间，自动管理
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // 记录更新时间，自动管理
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
