import { Controller, Get, Query, Logger } from '@nestjs/common';
import { EnsembleService, EnsemblePrediction } from './ensemble.service';

@Controller('api/ensemble')
export class EnsembleController {
  private readonly logger = new Logger(EnsembleController.name);

  constructor(private readonly ensembleService: EnsembleService) {}

  @Get('predict')
  async predict(
    @Query('home') home: string,
    @Query('away') away: string,
    @Query('neutral') neutral: string = 'false',
  ): Promise<EnsemblePrediction | { error: string }> {
    if (!home || !away) {
      return { error: '请提供主队(home)和客队(away)参数' };
    }
    const result = await this.ensembleService.predict(
      home,
      away,
      neutral === 'true',
    );
    if (!result) {
      return { error: `未找到球队数据: ${home} 或 ${away} 不在 ELO 数据库中` };
    }
    return result;
  }

  @Get('predict-quick')
  async predictQuick(
    @Query('home') home: string,
    @Query('away') away: string,
    @Query('neutral') neutral: string = 'false',
  ): Promise<
    { homeWin: number; draw: number; awayWin: number } | { error: string }
  > {
    if (!home || !away) {
      return { error: '请提供主队(home)和客队(away)参数' };
    }
    const result = await this.ensembleService.predictQuick(
      home,
      away,
      neutral === 'true',
    );
    if (!result) {
      return { error: `未找到球队数据: ${home} 或 ${away} 不在 ELO 数据库中` };
    }
    return result;
  }
}
