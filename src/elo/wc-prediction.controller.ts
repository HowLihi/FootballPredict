import { Controller, Get, Post, Query, Logger, Body } from '@nestjs/common';
import { WcPredictionService } from './wc-prediction.service';
import { WcPrediction } from './wc-prediction.entity';

@Controller('wc')
export class WcPredictionController {
  private readonly logger = new Logger(WcPredictionController.name);

  constructor(private readonly wcPredictionService: WcPredictionService) {}

  @Post('predict')
  async generatePredictions(): Promise<{
    totalMatches: number;
    predictions: WcPrediction[];
    groupPredictions: any[];
  }> {
    this.logger.log('生成世界杯预测...');
    return this.wcPredictionService.generatePredictions();
  }

  @Get('predictions')
  async getPredictions(
    @Query('group') group?: string,
    @Query('round') round?: string,
  ): Promise<WcPrediction[]> {
    return this.wcPredictionService.getPredictions(
      group,
      round ? parseInt(round) : undefined,
    );
  }

  @Get('groups')
  async getGroupPredictions(): Promise<any[]> {
    return this.wcPredictionService.getGroupPredictions();
  }

  @Get('knockout')
  async getKnockoutPredictions(): Promise<any[]> {
    return this.wcPredictionService.predictKnockoutStage();
  }

  @Get('accuracy')
  async getAccuracy(): Promise<any> {
    return this.wcPredictionService.getPredictionAccuracy();
  }

  @Post('result')
  async updateResult(
    @Body()
    body: {
      homeTeam: string;
      awayTeam: string;
      homeScore: number;
      awayScore: number;
    },
  ): Promise<any> {
    return this.wcPredictionService.updateMatchResult(
      body.homeTeam,
      body.awayTeam,
      body.homeScore,
      body.awayScore,
    );
  }
}
