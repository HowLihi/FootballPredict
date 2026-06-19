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
import { WcScheduler } from './wc-scheduler';
import { MatchParams } from './match-params.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { venueToBeijingTime } from './beijing-time';

@Controller('wc')
export class WcPredictionController {
  private readonly logger = new Logger(WcPredictionController.name);

  constructor(
    private readonly wcPredictionService: WcPredictionService,
    private readonly squadService: SquadService,
    private readonly wcScheduler: WcScheduler,
    @InjectRepository(MatchParams)
    private readonly matchParamsRepo: Repository<MatchParams>,
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

  @Post('refresh-scores')
  async refreshScores(): Promise<{ updated: number }> {
    this.logger.log('手动触发比分刷新...');
    return this.wcScheduler.refreshNow();
  }

  @Post('gather-intelligence/:id')
  async gatherIntelligence(@Param('id') id: string) {
    return this.wcPredictionService.gatherIntelligence(parseInt(id));
  }

  @Post('quantify-intelligence/:id')
  async quantifyIntelligence(
    @Param('id') id: string,
    @Body() body: { summary: any },
  ) {
    return this.wcPredictionService.quantifyIntelligence(
      parseInt(id),
      body.summary,
    );
  }

  @Get('match-params/:matchId')
  async getMatchParams(
    @Param('matchId') matchId: string,
  ): Promise<MatchParams | null> {
    return this.matchParamsRepo.findOne({
      where: { matchId: parseInt(matchId) },
    });
  }

  @Post('match-params/:matchId')
  async saveMatchParams(
    @Param('matchId') matchId: string,
    @Body() body: Partial<MatchParams>,
  ): Promise<MatchParams> {
    const id = parseInt(matchId);
    let existing = await this.matchParamsRepo.findOne({
      where: { matchId: id },
    });
    if (existing) {
      Object.assign(existing, body, { matchId: id });
      return this.matchParamsRepo.save(existing);
    }
    const entity = this.matchParamsRepo.create({ ...body, matchId: id });
    return this.matchParamsRepo.save(entity);
  }

  @Post('tune-workflow')
  async tuneWorkflow(
    @Body()
    body?: {
      customWeights?: {
        formWeight?: number;
        starPowerWeight?: number;
        tacticsWeight?: number;
        fatigueWeight?: number;
        pressureWeight?: number;
        injuryWeight?: number;
        stakesWeight?: number;
        weatherWeight?: number;
        refereeWeight?: number;
      };
    },
  ) {
    this.logger.log('启动预测工作流调优...');
    return this.wcPredictionService.tunePredictionWorkflow(body);
  }
}
