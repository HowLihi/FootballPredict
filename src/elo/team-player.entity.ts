import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('team_players')
export class TeamPlayer {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'team_name', type: 'varchar', length: 150 })
  teamName: string;

  @Column({ name: 'player_name', type: 'varchar', length: 200 })
  playerName: string;

  @Column({ name: 'position', type: 'varchar', length: 50 })
  position: string;

  @Column({ name: 'position_code', type: 'varchar', length: 10 })
  positionCode: string;

  @Column({ name: 'jersey_number', type: 'integer', nullable: true })
  jerseyNumber: number | null;

  @Column({
    name: 'date_of_birth',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  dateOfBirth: string | null;

  @Column({ name: 'age', type: 'integer', nullable: true })
  age: number | null;

  @Column({ name: 'nationality', type: 'varchar', length: 100, nullable: true })
  nationality: string | null;

  @Column({ name: 'overall', type: 'integer' })
  overall: number;

  @Column({ name: 'market_value', type: 'float', nullable: true })
  marketValue: number | null;

  @Column({ name: 'is_star', type: 'boolean', default: false })
  isStar: boolean;

  @Column({ name: 'strengths', type: 'simple-array', nullable: true })
  strengths: string[];

  @Column({ name: 'weaknesses', type: 'simple-array', nullable: true })
  weaknesses: string[];

  @Column({ name: 'photo_url', type: 'varchar', length: 500, nullable: true })
  photoUrl: string | null;

  @Column({ name: 'source', type: 'varchar', length: 50, default: 'api' })
  source: string;

  @Index()
  @Column({ name: 'team_api_id', type: 'integer', nullable: true })
  teamApiId: number | null;

  @Column({ name: 'player_api_id', type: 'integer', nullable: true })
  playerApiId: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
