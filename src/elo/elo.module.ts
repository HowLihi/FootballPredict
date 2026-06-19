import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EloService } from './elo.service';
import { EloController } from './elo.controller';
import { WcPredictionService } from './wc-prediction.service';
import { WcPredictionController } from './wc-prediction.controller';
import { WcScheduler } from './wc-scheduler';
import { SquadService } from './squad.service';
import { PlayerMarketValueService } from './player-market-value.service';
import { OddsService } from './odds.service';
import { PoissonService } from './poisson.service';
import { StackingService } from './stacking.service';
import { EnsembleService } from './ensemble.service';
import { EnsembleController } from './ensemble.controller';
import { EloRating } from './elo-rating.entity';
import { EloHistory } from './elo-history.entity';
import { WcPrediction } from './wc-prediction.entity';
import { TeamPlayer } from './team-player.entity';
import { MatchParams } from './match-params.entity';
import { CollectorModule } from '../collector/collector.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EloRating,
      EloHistory,
      WcPrediction,
      TeamPlayer,
      MatchParams,
    ]),
    CollectorModule,
  ],
  controllers: [EloController, WcPredictionController, EnsembleController],
  providers: [
    EloService,
    WcPredictionService,
    WcScheduler,
    SquadService,
    PlayerMarketValueService,
    OddsService,
    PoissonService,
    StackingService,
    EnsembleService,
  ],
  exports: [EloService, WcPredictionService, SquadService, EnsembleService],
})
export class EloModule {}
