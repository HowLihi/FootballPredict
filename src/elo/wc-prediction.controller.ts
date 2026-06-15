import {
  Controller,
  Get,
  Post,
  Query,
  Logger,
  Body,
  Param,
} from '@nestjs/common';
import { WcPredictionService } from './wc-prediction.service';
import { WcPrediction } from './wc-prediction.entity';
import { SquadService } from './squad.service';
import { venueToBeijingTime } from './beijing-time';

@Controller('wc')
export class WcPredictionController {
  private readonly logger = new Logger(WcPredictionController.name);

  constructor(
    private readonly wcPredictionService: WcPredictionService,
    private readonly squadService: SquadService,
  ) {}

  private toBeijing(predictions: WcPrediction[]): WcPrediction[] {
    return predictions.map((p) => ({
      ...p,
      matchDate: venueToBeijingTime(p.matchDate, p.venue),
    }));
  }

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
    const data = await this.wcPredictionService.getPredictions(
      group,
      round ? parseInt(round) : undefined,
    );
    return this.toBeijing(data);
  }

  @Get('recent')
  async getRecentMatches(): Promise<WcPrediction[]> {
    const data = await this.wcPredictionService.getRecentMatches();
    return this.toBeijing(data);
  }

  @Get('weather/:id')
  async getMatchWeather(@Param('id') id: string) {
    return this.wcPredictionService.getMatchWeather(parseInt(id));
  }

  @Get('referee/:id')
  async getMatchReferee(@Param('id') id: string) {
    return this.wcPredictionService.getMatchReferee(parseInt(id));
  }

  @Get('referees')
  async getAllReferees() {
    return this.wcPredictionService.getAllReferees();
  }

  @Get('compare/:id')
  async getGameTheoryComparison(@Param('id') id: string) {
    return this.wcPredictionService.getGameTheoryComparison(parseInt(id));
  }

  @Get('squad/:team')
  async getSquad(@Param('team') team: string) {
    const decoded = decodeURIComponent(team);
    return this.squadService.getSquad(decoded);
  }

  @Post('squad/:team/refresh')
  async refreshSquad(@Param('team') team: string) {
    const decoded = decodeURIComponent(team);
    return this.squadService.refreshSquad(decoded);
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
