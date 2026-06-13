import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('elo_history')
export class EloHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'team_name', length: 100 })
  teamName: string;

  @Column({ name: 'rating', type: 'float' })
  rating: number;

  @Column({ name: 'rating_change', type: 'float' })
  ratingChange: number;

  @Column({ name: 'opponent_name', length: 100 })
  opponentName: string;

  @Column({ name: 'opponent_rating', type: 'float' })
  opponentRating: number;

  @Column({ name: 'result', length: 1 })
  result: string;

  @Column({ name: 'home_score', type: 'integer' })
  homeScore: number;

  @Column({ name: 'away_score', type: 'integer' })
  awayScore: number;

  @Column({ name: 'is_home', type: 'boolean' })
  isHome: boolean;

  @Column({ name: 'tournament', type: 'varchar', length: 100, nullable: true })
  tournament: string | null;

  @Column({ name: 'match_date', type: 'date' })
  matchDate: string;

  @Index()
  @Column({ name: 'calculation_date', type: 'date' })
  calculationDate: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
