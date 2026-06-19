import { Controller, Get, Query, Logger, Post, Body } from '@nestjs/common';
import {
  EloService,
  EloCalculationConfig,
  TeamEloSnapshot,
  MatchPrediction,
} from './elo.service';
import { EnsembleService } from './ensemble.service';
import { EloRating } from './elo-rating.entity';
import { EloHistory } from './elo-history.entity';

@Controller('elo')
export class EloController {
  private readonly logger = new Logger(EloController.name);

  constructor(
    private readonly eloService: EloService,
    private readonly ensembleService: EnsembleService,
  ) {}

  @Post('calculate')
  async calculateElo(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('kFactor') kFactor?: string,
    @Query('homeAdvantage') homeAdvantage?: string,
  ): Promise<{
    totalMatches: number;
    totalTeams: number;
    topTeams: TeamEloSnapshot[];
  }> {
    this.logger.log(`开始计算 ELO: startDate=${startDate}, endDate=${endDate}`);

    const config: Partial<EloCalculationConfig> = {};
    if (kFactor) config.kFactor = parseFloat(kFactor);
    if (homeAdvantage) config.homeAdvantage = parseFloat(homeAdvantage);

    return this.eloService.calculateFromInternationalData(
      startDate,
      endDate,
      Object.keys(config).length > 0 ? config : undefined,
    );
  }

  @Get('rankings')
  async getRankings(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ): Promise<{ data: EloRating[]; total: number }> {
    return this.eloService.getAllRatings(parseInt(page), parseInt(limit));
  }

  @Get('team')
  async getTeamRating(
    @Query('name') name: string,
  ): Promise<TeamEloSnapshot | { error: string } | null> {
    if (!name) {
      return { error: '请提供球队名称参数 name' };
    }
    return this.eloService.getTeamRating(name);
  }

  @Get('history')
  async getTeamHistory(
    @Query('name') name: string,
    @Query('limit') limit: string = '50',
  ): Promise<EloHistory[] | { error: string }> {
    if (!name) {
      return { error: '请提供球队名称参数 name' };
    }
    return this.eloService.getTeamHistory(name, parseInt(limit));
  }

  @Get('predict')
  async predictMatch(
    @Query('home') home: string,
    @Query('away') away: string,
    @Query('neutral') neutral: string = 'false',
  ): Promise<MatchPrediction | { error: string } | null> {
    if (!home || !away) {
      return { error: '请提供主队(home)和客队(away)参数' };
    }
    const resolvedHome = this.ensembleService.resolveTeamName(home);
    const resolvedAway = this.ensembleService.resolveTeamName(away);
    return this.eloService.predictMatch(
      resolvedHome,
      resolvedAway,
      neutral === 'true',
    );
  }

  @Post('predict-advanced')
  async predictAdvanced(
    @Body()
    body: {
      homeTeam: string;
      awayTeam: string;
      neutral: boolean;
      kFactor: number;
      homeAdvantage: number;
      weatherWeight: number;
      refereeWeight: number;
      weatherCondition: string;
      refereeStrictness: string;
      homeForm: number;
      awayForm: number;
      homeStarPower: number;
      awayStarPower: number;
      homeTactics: string;
      awayTactics: string;
      homeFatigue: number;
      awayFatigue: number;
      homePressure: number;
      awayPressure: number;
      homeInjuryImpact: number;
      awayInjuryImpact: number;
      homeStakes: number;
      awayStakes: number;
      fairnessWeight: number;
      fifaWeight: number;
      bookmakerWeight: number;
    },
  ): Promise<
    | (MatchPrediction & {
        predictedHomeScore: number;
        predictedAwayScore: number;
        weatherEffect: number;
        refereeEffect: number;
        formEffect: number;
        starEffect: number;
        tacticsEffect: number;
        fatigueEffect: number;
        pressureEffect: number;
        injuryEffect: number;
        stakesEffect: number;
        fairnessEffect: number;
        fifaEffect: number;
        bookmakerEffect: number;
      })
    | { error: string }
    | null
  > {
    if (!body.homeTeam || !body.awayTeam) {
      return { error: '请提供主队和客队名称' };
    }

    const resolvedHome = this.ensembleService.resolveTeamName(body.homeTeam);
    const resolvedAway = this.ensembleService.resolveTeamName(body.awayTeam);
    const resolvedBody = {
      ...body,
      homeTeam: resolvedHome,
      awayTeam: resolvedAway,
    };

    const ensemble = await this.ensembleService.predict(
      resolvedBody.homeTeam,
      resolvedBody.awayTeam,
      body.neutral,
    );

    if (ensemble) {
      return this.eloService.predictAdvanced(
        resolvedBody,
        ensemble.finalHomeWin,
        ensemble.finalDraw,
        ensemble.finalAwayWin,
        ensemble.individualModels.poisson.homeGoalsExpected,
        ensemble.individualModels.poisson.awayGoalsExpected,
      );
    }

    return this.eloService.predictAdvanced(resolvedBody);
  }

  @Post('recalculate')
  async recalculate(): Promise<{
    totalMatches: number;
    totalTeams: number;
    topTeams: TeamEloSnapshot[];
  }> {
    this.logger.log('重新计算所有 ELO 积分...');
    return this.eloService.recalculateFromDbMatches();
  }
}
