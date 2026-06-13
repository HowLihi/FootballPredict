import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EloService } from './elo.service';
import { EloController } from './elo.controller';
import { WcPredictionService } from './wc-prediction.service';
import { WcPredictionController } from './wc-prediction.controller';
import { WcScheduler } from './wc-scheduler';
import { EloRating } from './elo-rating.entity';
import { EloHistory } from './elo-history.entity';
import { WcPrediction } from './wc-prediction.entity';
import { CollectorModule } from '../collector/collector.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([EloRating, EloHistory, WcPrediction]),
    CollectorModule,
  ],
  controllers: [EloController, WcPredictionController],
  providers: [EloService, WcPredictionService, WcScheduler],
  exports: [EloService, WcPredictionService],
})
export class EloModule {}
