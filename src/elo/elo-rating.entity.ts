import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('elo_ratings')
export class EloRating {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ name: 'team_name', length: 100 })
  teamName: string;

  @Column({ name: 'rating', type: 'float', default: 1500 })
  rating: number;

  @Column({ name: 'games_played', type: 'integer', default: 0 })
  gamesPlayed: number;

  @Column({ name: 'wins', type: 'integer', default: 0 })
  wins: number;

  @Column({ name: 'draws', type: 'integer', default: 0 })
  draws: number;

  @Column({ name: 'losses', type: 'integer', default: 0 })
  losses: number;

  @Column({ name: 'goals_for', type: 'integer', default: 0 })
  goalsFor: number;

  @Column({ name: 'goals_against', type: 'integer', default: 0 })
  goalsAgainst: number;

  @Column({ name: 'last_match_date', type: 'date', nullable: true })
  lastMatchDate: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
