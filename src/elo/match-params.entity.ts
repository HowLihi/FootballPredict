import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export interface MatchSummaryItem {
  category: string;
  icon: string;
  title: string;
  detail: string;
  impact:
    | 'home_positive'
    | 'home_negative'
    | 'away_positive'
    | 'away_negative'
    | 'neutral';
}

export interface MatchSummaryData {
  highlights: MatchSummaryItem[];
  keyEvents: string[];
  refereeNote: string;
  venueNote: string;
  generalNote: string;
}

@Entity('match_params')
export class MatchParams {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ name: 'match_id', type: 'integer' })
  matchId: number;

  @Column({ name: 'k_factor', type: 'integer', default: 32 })
  kFactor: number;

  @Column({ name: 'home_advantage', type: 'integer', default: 100 })
  homeAdvantage: number;

  @Column({ name: 'neutral', type: 'boolean', default: false })
  neutral: boolean;

  @Column({ name: 'weather_weight', type: 'float', default: 0 })
  weatherWeight: number;

  @Column({
    name: 'weather_condition',
    type: 'varchar',
    length: 20,
    default: 'sunny',
  })
  weatherCondition: string;

  @Column({ name: 'referee_weight', type: 'float', default: 0 })
  refereeWeight: number;

  @Column({
    name: 'referee_strictness',
    type: 'varchar',
    length: 20,
    default: 'average',
  })
  refereeStrictness: string;

  @Column({ name: 'home_form', type: 'integer', default: 5 })
  homeForm: number;

  @Column({ name: 'away_form', type: 'integer', default: 5 })
  awayForm: number;

  @Column({ name: 'home_star_power', type: 'integer', default: 5 })
  homeStarPower: number;

  @Column({ name: 'away_star_power', type: 'integer', default: 5 })
  awayStarPower: number;

  @Column({
    name: 'home_tactics',
    type: 'varchar',
    length: 20,
    default: 'balanced',
  })
  homeTactics: string;

  @Column({
    name: 'away_tactics',
    type: 'varchar',
    length: 20,
    default: 'balanced',
  })
  awayTactics: string;

  @Column({ name: 'home_fatigue', type: 'integer', default: 3 })
  homeFatigue: number;

  @Column({ name: 'away_fatigue', type: 'integer', default: 3 })
  awayFatigue: number;

  @Column({ name: 'home_pressure', type: 'integer', default: 5 })
  homePressure: number;

  @Column({ name: 'away_pressure', type: 'integer', default: 5 })
  awayPressure: number;

  @Column({ name: 'home_injury_impact', type: 'integer', default: 1 })
  homeInjuryImpact: number;

  @Column({ name: 'away_injury_impact', type: 'integer', default: 1 })
  awayInjuryImpact: number;

  @Column({ name: 'home_stakes', type: 'integer', default: 5 })
  homeStakes: number;

  @Column({ name: 'away_stakes', type: 'integer', default: 5 })
  awayStakes: number;

  @Column({ name: 'fairness_weight', type: 'float', default: 0 })
  fairnessWeight: number;

  @Column({ name: 'fifa_weight', type: 'float', default: 0 })
  fifaWeight: number;

  @Column({ name: 'bookmaker_weight', type: 'float', default: 0 })
  bookmakerWeight: number;

  @Column({ name: 'group_strength', type: 'integer', default: 5 })
  groupStrength: number;

  @Column({ name: 'round_number', type: 'integer', default: 1 })
  roundNumber: number;

  @Column({
    name: 'qualification_scenario',
    type: 'varchar',
    length: 30,
    default: 'neutral',
  })
  qualificationScenario: string;

  @Column({
    name: 'match_summary',
    type: 'simple-json',
    nullable: true,
  })
  matchSummary: MatchSummaryData | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
