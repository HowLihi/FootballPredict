import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

/**
 * 赔率实体 - 对应数据库中的 odds 表
 * 存储各博彩公司的赔率数据
 * 赔率是预测模型的核心特征，因为赔率反映了市场对比赛结果的预期概率
 * 隐含概率 = 1 / 赔率，例如赔率2.0 → 隐含概率50%
 */
@Entity('odds')
// 复合唯一索引: 同一场比赛同一个赔率来源只能有一条记录
// 这是 upsert 操作的前提条件，TypeORM 需要唯一索引来判断冲突
@Unique('UQ_ODDS_MATCH_SOURCE', ['matchExternalId', 'source'])
export class Odds {
  @PrimaryGeneratedColumn()
  id: number;

  // 关联的比赛外部ID，用于与 matches 表关联查询
  @Index()
  @Column({ name: 'match_external_id' })
  matchExternalId: string;

  // 赔率来源 (如 'B365' = Bet365, 'PS' = Pinnacle)
  @Column({ length: 20 })
  source: string;

  // 比赛日期
  @Column({ type: 'date' })
  date: string;

  // 主队名称
  @Column({ name: 'home_team', length: 100 })
  homeTeam: string;

  // 客队名称
  @Column({ name: 'away_team', length: 100 })
  awayTeam: string;

  // 主胜赔率 (如 1.53 表示投100元可赢53元)
  @Column({ name: 'home_win', type: 'float', nullable: true })
  homeWin: number | null;

  // 平局赔率
  @Column({ type: 'float', nullable: true })
  draw: number | null;

  // 客胜赔率
  @Column({ name: 'away_win', type: 'float', nullable: true })
  awayWin: number | null;

  // 记录创建时间
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // 记录更新时间
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
