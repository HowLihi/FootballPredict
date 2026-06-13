import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('wc_predictions')
export class WcPrediction {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'match_date', type: 'date' })
  matchDate: string;

  @Column({ name: 'group_name', length: 2 })
  groupName: string;

  @Column({ name: 'home_team', length: 100 })
  homeTeam: string;

  @Column({ name: 'away_team', length: 100 })
  awayTeam: string;

  @Column({ name: 'round', type: 'integer' })
  round: number;

  @Column({ name: 'home_rating', type: 'float' })
  homeRating: number;

  @Column({ name: 'away_rating', type: 'float' })
  awayRating: number;

  @Column({ name: 'home_win_prob', type: 'float' })
  homeWinProb: number;

  @Column({ name: 'draw_prob', type: 'float' })
  drawProb: number;

  @Column({ name: 'away_win_prob', type: 'float' })
  awayWinProb: number;

  @Column({ name: 'predicted_result', length: 1 })
  predictedResult: string;

  @Column({ name: 'predicted_score_home', type: 'float' })
  predictedScoreHome: number;

  @Column({ name: 'predicted_score_away', type: 'float' })
  predictedScoreAway: number;

  @Column({ name: 'home_advantage', type: 'float' })
  homeAdvantage: number;

  @Column({ name: 'venue', type: 'varchar', length: 200, nullable: true })
  venue: string | null;

  @Column({ name: 'neutral', type: 'boolean' })
  neutral: boolean;

  @Column({ name: 'actual_home_score', type: 'integer', nullable: true })
  actualHomeScore: number | null;

  @Column({ name: 'actual_away_score', type: 'integer', nullable: true })
  actualAwayScore: number | null;

  @Column({ name: 'result_correct', type: 'boolean', nullable: true })
  resultCorrect: boolean | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
