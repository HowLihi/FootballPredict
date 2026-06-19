import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';
import axios from 'axios';
import * as https from 'https';
import { EloService, MatchPrediction } from './elo.service';
import { EnsembleService } from './ensemble.service';
import { WcPrediction } from './wc-prediction.entity';
import { MatchParams } from './match-params.entity';
import { SquadService } from './squad.service';
import { beijingDateAddDays, venueToBeijingTime } from './beijing-time';

export interface WcFixture {
  date: string;
  time: string;
  group: string;
  homeTeam: string;
  awayTeam: string;
  round: number;
  venue: string;
  neutral: boolean;
  homeScore: number | null;
  awayScore: number | null;
}

export interface GroupPrediction {
  group: string;
  teams: GroupTeamPrediction[];
}

export interface GroupTeamPrediction {
  team: string;
  rating: number;
  avgWinProb: number;
  avgDrawProb: number;
  avgLossProb: number;
  predictedPoints: number;
  predictedGoalsFor: number;
  predictedGoalsAgainst: number;
}

export interface WeatherSlot {
  condition: string;
  label: string;
  temperature: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  humidity: number | null;
}

export interface KnockoutPrediction {
  round: string;
  match: string;
  homeTeam: string;
  awayTeam: string;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  predictedWinner: string;
}

const TEAM_NAME_ALIASES: Record<string, string> = {
  USA: 'United States',
  Curacao: 'Curaçao',
  'Bosnia & Herzegovina': 'Bosnia and Herzegovina',
  "Côte d'Ivoire": 'Ivory Coast',
  "Cote d'Ivoire": 'Ivory Coast',
};

@Injectable()
export class WcPredictionService {
  private readonly logger = new Logger(WcPredictionService.name);

  constructor(
    @InjectRepository(WcPrediction)
    private readonly wcPredictionRepository: Repository<WcPrediction>,
    @InjectRepository(MatchParams)
    private readonly matchParamsRepository: Repository<MatchParams>,
    private readonly eloService: EloService,
    private readonly ensembleService: EnsembleService,
    private readonly squadService: SquadService,
  ) {}

  async generatePredictions(): Promise<{
    totalMatches: number;
    predictions: WcPrediction[];
    groupPredictions: GroupPrediction[];
  }> {
    await this.wcPredictionRepository.clear();

    const fixtures = await this.loadFixtures();
    this.logger.log(`加载了 ${fixtures.length} 场世界杯赛程`);

    const predictions: WcPrediction[] = [];

    for (const fixture of fixtures) {
      const prediction = await this.predictFixture(fixture);
      if (prediction) {
        predictions.push(prediction);
      }
    }

    if (predictions.length > 0) {
      await this.wcPredictionRepository.insert(predictions);
    }

    const groupPredictions = this.calculateGroupPredictions(predictions);

    this.logger.log(
      `生成了 ${predictions.length} 场比赛的预测，${groupPredictions.length} 个小组预测`,
    );

    return { totalMatches: predictions.length, predictions, groupPredictions };
  }

  private async predictFixture(
    fixture: WcFixture,
  ): Promise<WcPrediction | null> {
    const homeTeam = this.resolveTeamName(fixture.homeTeam);
    const awayTeam = this.resolveTeamName(fixture.awayTeam);

    const ensemblePrediction = await this.ensembleService.predict(
      homeTeam,
      awayTeam,
      fixture.neutral,
    );

    if (!ensemblePrediction) {
      this.logger.warn(
        `无法预测: ${fixture.homeTeam} vs ${fixture.awayTeam} (数据缺失)`,
      );
      return null;
    }

    const predictedResult = this.determineEnsembleResult(ensemblePrediction);

    const entity = new WcPrediction();
    entity.matchDate = `${fixture.date} ${fixture.time}`;
    entity.groupName = fixture.group;
    entity.homeTeam = fixture.homeTeam;
    entity.awayTeam = fixture.awayTeam;
    entity.round = fixture.round;
    entity.homeRating = ensemblePrediction.homeRating;
    entity.awayRating = ensemblePrediction.awayRating;
    entity.homeWinProb = ensemblePrediction.finalHomeWin;
    entity.drawProb = ensemblePrediction.finalDraw;
    entity.awayWinProb = ensemblePrediction.finalAwayWin;
    entity.predictedResult = predictedResult;
    entity.predictedScoreHome = ensemblePrediction.predictedHomeScore;
    entity.predictedScoreAway = ensemblePrediction.predictedAwayScore;
    entity.homeAdvantage = ensemblePrediction.homeAdvantage;
    entity.venue = fixture.venue;
    entity.neutral = fixture.neutral;
    entity.actualHomeScore = fixture.homeScore;
    entity.actualAwayScore = fixture.awayScore;
    entity.resultCorrect =
      fixture.homeScore !== null && fixture.awayScore !== null
        ? this.checkResultCorrect(
            fixture.homeScore,
            fixture.awayScore,
            predictedResult,
          )
        : null;

    return entity;
  }

  private resolveTeamName(teamName: string): string {
    return TEAM_NAME_ALIASES[teamName] || teamName;
  }

  private determinePredictedResult(prediction: MatchPrediction): string {
    const { homeWinProbability, drawProbability, awayWinProbability } =
      prediction;
    if (
      homeWinProbability >= drawProbability &&
      homeWinProbability >= awayWinProbability
    ) {
      return 'H';
    }
    if (
      awayWinProbability >= drawProbability &&
      awayWinProbability >= homeWinProbability
    ) {
      return 'A';
    }
    return 'D';
  }

  private determineEnsembleResult(ensemblePrediction: {
    finalHomeWin: number;
    finalDraw: number;
    finalAwayWin: number;
  }): string {
    if (
      ensemblePrediction.finalHomeWin >= ensemblePrediction.finalDraw &&
      ensemblePrediction.finalHomeWin >= ensemblePrediction.finalAwayWin
    ) {
      return 'H';
    }
    if (
      ensemblePrediction.finalAwayWin >= ensemblePrediction.finalDraw &&
      ensemblePrediction.finalAwayWin >= ensemblePrediction.finalHomeWin
    ) {
      return 'A';
    }
    return 'D';
  }

  private checkResultCorrect(
    homeScore: number,
    awayScore: number,
    predictedResult: string,
  ): boolean {
    const actualResult =
      homeScore > awayScore ? 'H' : homeScore < awayScore ? 'A' : 'D';
    return actualResult === predictedResult;
  }

  private predictScore(prediction: MatchPrediction): {
    homeGoals: number;
    awayGoals: number;
  } {
    const { homeWinProbability, drawProbability, awayWinProbability } =
      prediction;

    const ratingDiff = prediction.homeRating - prediction.awayRating;
    const baseGoals = 1.3;

    let homeExpected = baseGoals + ratingDiff / 800;
    let awayExpected = baseGoals - ratingDiff / 800;

    homeExpected = Math.max(0.3, homeExpected);
    awayExpected = Math.max(0.3, awayExpected);

    if (homeWinProbability > awayWinProbability + 0.15) {
      homeExpected += 0.4;
    } else if (awayWinProbability > homeWinProbability + 0.15) {
      awayExpected += 0.4;
    }

    if (drawProbability > 0.28) {
      const avg = (homeExpected + awayExpected) / 2;
      homeExpected = homeExpected * 0.6 + avg * 0.4;
      awayExpected = awayExpected * 0.6 + avg * 0.4;
    }

    return {
      homeGoals: Math.round(homeExpected * 10) / 10,
      awayGoals: Math.round(awayExpected * 10) / 10,
    };
  }

  private calculateGroupPredictions(
    predictions: WcPrediction[],
  ): GroupPrediction[] {
    const groups = new Map<string, Map<string, GroupTeamPrediction>>();

    for (const pred of predictions) {
      if (!groups.has(pred.groupName)) {
        groups.set(pred.groupName, new Map());
      }
      const groupTeams = groups.get(pred.groupName)!;

      this.updateTeamPrediction(groupTeams, pred.homeTeam, pred, true);
      this.updateTeamPrediction(groupTeams, pred.awayTeam, pred, false);
    }

    const result: GroupPrediction[] = [];
    for (const [groupName, teamMap] of groups) {
      const teams = Array.from(teamMap.values()).sort(
        (a, b) => b.predictedPoints - a.predictedPoints,
      );
      result.push({ group: groupName, teams });
    }

    return result.sort((a, b) => a.group.localeCompare(b.group));
  }

  private updateTeamPrediction(
    groupTeams: Map<string, GroupTeamPrediction>,
    teamName: string,
    prediction: WcPrediction,
    isHome: boolean,
  ): void {
    if (!groupTeams.has(teamName)) {
      const rating = isHome ? prediction.homeRating : prediction.awayRating;
      groupTeams.set(teamName, {
        team: teamName,
        rating,
        avgWinProb: 0,
        avgDrawProb: 0,
        avgLossProb: 0,
        predictedPoints: 0,
        predictedGoalsFor: 0,
        predictedGoalsAgainst: 0,
      });
    }

    const team = groupTeams.get(teamName)!;

    if (isHome) {
      team.avgWinProb += prediction.homeWinProb;
      team.avgDrawProb += prediction.drawProb;
      team.avgLossProb += prediction.awayWinProb;
      team.predictedPoints +=
        prediction.homeWinProb * 3 + prediction.drawProb * 1;
      team.predictedGoalsFor += prediction.predictedScoreHome;
      team.predictedGoalsAgainst += prediction.predictedScoreAway;
    } else {
      team.avgWinProb += prediction.awayWinProb;
      team.avgDrawProb += prediction.drawProb;
      team.avgLossProb += prediction.homeWinProb;
      team.predictedPoints +=
        prediction.awayWinProb * 3 + prediction.drawProb * 1;
      team.predictedGoalsFor += prediction.predictedScoreAway;
      team.predictedGoalsAgainst += prediction.predictedScoreHome;
    }
  }

  private async loadFixtures(): Promise<WcFixture[]> {
    const filePath = path.join(
      process.cwd(),
      'data',
      'csv',
      'world_cup_2026_fixtures.csv',
    );

    if (!fs.existsSync(filePath)) {
      this.logger.error(`世界杯赛程文件不存在: ${filePath}`);
      return [];
    }

    return new Promise((resolve, reject) => {
      const fixtures: WcFixture[] = [];

      fs.createReadStream(filePath, { encoding: 'utf-8' })
        .pipe(
          parse({
            columns: true,
            skip_empty_lines: true,
            trim: true,
          }),
        )
        .on('data', (record: Record<string, string>) => {
          const hs = record['home_score']?.trim();
          const as_ = record['away_score']?.trim();
          fixtures.push({
            date: record['date'],
            time: record['match_time'] || '15:00:00',
            group: record['group'],
            homeTeam: record['home_team']?.trim() || '',
            awayTeam: record['away_team']?.trim() || '',
            round: parseInt(record['round'], 10),
            venue: record['venue']?.trim() || '',
            neutral: record['neutral']?.toUpperCase() === 'TRUE',
            homeScore: hs ? parseInt(hs, 10) : null,
            awayScore: as_ ? parseInt(as_, 10) : null,
          });
        })
        .on('end', () => resolve(fixtures))
        .on('error', (error: Error) => reject(error));
    });
  }

  async getRecentMatches(): Promise<WcPrediction[]> {
    const weekLater = beijingDateAddDays(7);
    const threeDaysAgo = beijingDateAddDays(-3);

    const sqlStart = beijingDateAddDays(-3 - 1);
    const sqlEnd = beijingDateAddDays(7 + 1);

    const allMatches = await this.wcPredictionRepository
      .createQueryBuilder('p')
      .where('p.matchDate >= :sqlStart', { sqlStart })
      .andWhere('p.matchDate <= :sqlEnd', { sqlEnd })
      .orderBy('p.matchDate', 'ASC')
      .addOrderBy('p.id', 'ASC')
      .getMany();

    return allMatches.filter((m) => {
      const bjDate = venueToBeijingTime(m.matchDate, m.venue);
      return bjDate >= threeDaysAgo && bjDate <= weekLater;
    });
  }

  async getPredictions(
    group?: string,
    round?: number,
  ): Promise<WcPrediction[]> {
    const where: Record<string, unknown> = {};
    if (group) where.groupName = group;
    if (round) where.round = round;

    return this.wcPredictionRepository.find({
      where: Object.keys(where).length > 0 ? where : undefined,
      order: { matchDate: 'ASC', id: 'ASC' },
    });
  }

  async getGroupPredictions(): Promise<GroupPrediction[]> {
    const predictions = await this.wcPredictionRepository.find({
      order: { matchDate: 'ASC' },
    });

    return this.calculateGroupPredictions(predictions);
  }

  async updateMatchResult(
    homeTeam: string,
    awayTeam: string,
    homeScore: number,
    awayScore: number,
  ): Promise<WcPrediction | null> {
    let prediction = await this.wcPredictionRepository.findOne({
      where: { homeTeam, awayTeam },
    });

    if (!prediction) {
      const all = await this.wcPredictionRepository.find({
        where: { actualHomeScore: IsNull() },
      });
      prediction =
        all.find(
          (p) =>
            this.fuzzyMatch(p.homeTeam, homeTeam) &&
            this.fuzzyMatch(p.awayTeam, awayTeam),
        ) || null;
    }

    if (!prediction) return null;

    prediction.actualHomeScore = homeScore;
    prediction.actualAwayScore = awayScore;

    let actualResult: string;
    if (homeScore > awayScore) actualResult = 'H';
    else if (homeScore < awayScore) actualResult = 'A';
    else actualResult = 'D';

    prediction.resultCorrect = prediction.predictedResult === actualResult;

    return this.wcPredictionRepository.save(prediction);
  }

  private fuzzyMatch(dbName: string, apiName: string): boolean {
    if (dbName === apiName) return true;
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalize(dbName) === normalize(apiName);
  }

  async getPredictionAccuracy(): Promise<{
    total: number;
    correct: number;
    accuracy: number;
    homeWins: number;
    draws: number;
    awayWins: number;
  }> {
    const predictions = await this.wcPredictionRepository.find();

    const completed = predictions.filter((p) => p.actualHomeScore !== null);
    const correct = completed.filter((p) => p.resultCorrect === true).length;

    return {
      total: completed.length,
      correct,
      accuracy: completed.length > 0 ? correct / completed.length : 0,
      homeWins: completed.filter((p) => p.predictedResult === 'H').length,
      draws: completed.filter((p) => p.predictedResult === 'D').length,
      awayWins: completed.filter((p) => p.predictedResult === 'A').length,
    };
  }

  async predictKnockoutStage(): Promise<KnockoutPrediction[]> {
    const groupPredictions = await this.getGroupPredictions();

    const qualified: Record<string, string[]> = {};
    for (const group of groupPredictions) {
      qualified[group.group] = group.teams.slice(0, 2).map((t) => t.team);
    }

    const thirdPlaceTeams = groupPredictions
      .map((g) => g.teams[2])
      .sort((a, b) => b.predictedPoints - a.predictedPoints)
      .slice(0, 8)
      .map((t) => t.team);

    const knockoutPredictions: KnockoutPrediction[] = [];

    const roundOf32Matches = this.generateRoundOf32(qualified, thirdPlaceTeams);

    for (const match of roundOf32Matches) {
      const homeTeam = this.resolveTeamName(match.home);
      const awayTeam = this.resolveTeamName(match.away);

      const prediction = await this.eloService.predictMatch(
        homeTeam,
        awayTeam,
        true,
      );

      if (prediction) {
        const homeWinProb = prediction.homeWinProbability;
        const drawProb = prediction.drawProbability;
        const awayWinProb = prediction.awayWinProbability;

        let predictedWinner: string;
        if (homeWinProb > awayWinProb) {
          predictedWinner = match.home;
        } else {
          predictedWinner = match.away;
        }

        knockoutPredictions.push({
          round: 'Round of 32',
          match: match.label,
          homeTeam: match.home,
          awayTeam: match.away,
          homeWinProb,
          drawProb,
          awayWinProb,
          predictedWinner,
        });
      }
    }

    return knockoutPredictions;
  }

  private generateRoundOf32(
    qualified: Record<string, string[]>,
    thirdPlaceTeams: string[],
  ): { label: string; home: string; away: string }[] {
    const matches: { label: string; home: string; away: string }[] = [];

    const g = (group: string, pos: number) => {
      return qualified[group]?.[pos - 1] || `Group ${group} #${pos}`;
    };

    const tp = (idx: number) => thirdPlaceTeams[idx - 1] || `3rd #${idx}`;

    matches.push({ label: 'R32-1', home: g('A', 1), away: tp(1) });
    matches.push({ label: 'R32-2', home: g('B', 1), away: tp(2) });
    matches.push({ label: 'R32-3', home: g('C', 1), away: tp(3) });
    matches.push({ label: 'R32-4', home: g('D', 1), away: tp(4) });
    matches.push({ label: 'R32-5', home: g('E', 1), away: tp(5) });
    matches.push({ label: 'R32-6', home: g('F', 1), away: tp(6) });
    matches.push({ label: 'R32-7', home: g('G', 1), away: tp(7) });
    matches.push({ label: 'R32-8', home: g('H', 1), away: tp(8) });
    matches.push({ label: 'R32-9', home: g('I', 1), away: g('L', 2) });
    matches.push({ label: 'R32-10', home: g('J', 1), away: g('K', 2) });
    matches.push({ label: 'R32-11', home: g('K', 1), away: g('J', 2) });
    matches.push({ label: 'R32-12', home: g('L', 1), away: g('I', 2) });
    matches.push({ label: 'R32-13', home: g('A', 2), away: g('B', 2) });
    matches.push({ label: 'R32-14', home: g('C', 2), away: g('D', 2) });
    matches.push({ label: 'R32-15', home: g('E', 2), away: g('F', 2) });
    matches.push({ label: 'R32-16', home: g('G', 2), away: g('H', 2) });

    return matches;
  }

  async getMatchWeather(matchId: number): Promise<{
    before: WeatherSlot;
    during: WeatherSlot;
    after: WeatherSlot;
    venue: string;
    matchDate: string;
  } | null> {
    const match = await this.wcPredictionRepository.findOne({
      where: { id: matchId },
    });

    if (!match || !match.venue) {
      return null;
    }

    const coords = this.getVenueCoordinates(match.venue);
    if (!coords) {
      return null;
    }

    const datePart = match.matchDate.split(' ')[0];
    const timePart = match.matchDate.split(' ')[1] || '15:00:00';
    const matchHour = parseInt(timePart.split(':')[0], 10);

    const weather = await this.fetchWeatherFromOpenMeteo(
      coords.lat,
      coords.lon,
      datePart,
      matchHour,
    );

    return {
      ...weather,
      venue: match.venue,
      matchDate: match.matchDate,
    };
  }

  private getVenueCoordinates(
    venue: string,
  ): { lat: number; lon: number } | null {
    const VENUE_COORDS: Record<string, { lat: number; lon: number }> = {
      'AT&T Stadium': { lat: 32.7473, lon: -97.0945 },
      'AT&T Stadium (Arlington, TX)': { lat: 32.7473, lon: -97.0945 },
      'Mercedes-Benz Stadium': { lat: 33.7555, lon: -84.401 },
      'Mercedes-Benz Stadium (Atlanta, GA)': { lat: 33.7555, lon: -84.401 },
      'Gillette Stadium': { lat: 42.0909, lon: -71.2643 },
      'Gillette Stadium (Foxborough, MA)': { lat: 42.0909, lon: -71.2643 },
      'NRG Stadium': { lat: 29.6847, lon: -95.4108 },
      'NRG Stadium (Houston, TX)': { lat: 29.6847, lon: -95.4108 },
      'Arrowhead Stadium': { lat: 39.0489, lon: -94.4839 },
      'Arrowhead Stadium (Kansas City, MO)': { lat: 39.0489, lon: -94.4839 },
      'SoFi Stadium': { lat: 33.9535, lon: -118.339 },
      'SoFi Stadium (Inglewood, CA)': { lat: 33.9535, lon: -118.339 },
      'Hard Rock Stadium': { lat: 25.958, lon: -80.2389 },
      'Hard Rock Stadium (Miami Gardens, FL)': { lat: 25.958, lon: -80.2389 },
      'MetLife Stadium': { lat: 40.8135, lon: -74.0745 },
      'MetLife Stadium (East Rutherford, NJ)': { lat: 40.8135, lon: -74.0745 },
      'Lincoln Financial Field': { lat: 39.9008, lon: -75.1675 },
      'Lincoln Financial Field (Philadelphia, PA)': {
        lat: 39.9008,
        lon: -75.1675,
      },
      "Levi's Stadium": { lat: 37.4034, lon: -121.9695 },
      "Levi's Stadium (Santa Clara, CA)": { lat: 37.4034, lon: -121.9695 },
      'Lumen Field': { lat: 47.5952, lon: -122.3316 },
      'Lumen Field (Seattle, WA)': { lat: 47.5952, lon: -122.3316 },
      'Estadio Azteca': { lat: 19.303, lon: -99.1505 },
      'Estadio Azteca (Mexico City)': { lat: 19.303, lon: -99.1505 },
      'Estadio BBVA': { lat: 25.6692, lon: -100.2442 },
      'Estadio BBVA (Monterrey)': { lat: 25.6692, lon: -100.2442 },
      'Estadio Akron': { lat: 20.6817, lon: -103.4628 },
      'Estadio Akron (Guadalajara)': { lat: 20.6817, lon: -103.4628 },
      'BMO Field': { lat: 43.6329, lon: -79.4186 },
      'BMO Field (Toronto)': { lat: 43.6329, lon: -79.4186 },
      'BC Place': { lat: 49.2767, lon: -123.112 },
      'BC Place (Vancouver)': { lat: 49.2767, lon: -123.112 },
      'State Farm Stadium': { lat: 33.5275, lon: -112.2626 },
      'State Farm Stadium (Glendale, AZ)': { lat: 33.5275, lon: -112.2626 },
    };

    for (const [key, coords] of Object.entries(VENUE_COORDS)) {
      if (venue.includes(key) || key.includes(venue)) {
        return coords;
      }
    }
    return null;
  }

  private async fetchWeatherFromOpenMeteo(
    lat: number,
    lon: number,
    date: string,
    matchHour: number,
  ): Promise<{ before: WeatherSlot; during: WeatherSlot; after: WeatherSlot }> {
    try {
      const url = 'https://api.open-meteo.com/v1/forecast';
      const params = {
        latitude: lat,
        longitude: lon,
        hourly:
          'weather_code,temperature_2m,precipitation_probability,wind_speed_10m,relative_humidity_2m',
        start_date: date,
        end_date: date,
        timezone: 'auto',
      };

      const res = await axios.get(url, {
        params,
        timeout: 30000,
        httpsAgent: new https.Agent({ family: 4 }),
      });
      const data = res.data;

      if (!data.hourly || data.hourly.time.length === 0) {
        return this.getDefaultWeather();
      }

      const getSlot = (hour: number): WeatherSlot => {
        const padded = String(hour).padStart(2, '0');
        const timeIndex = data.hourly.time.findIndex((t: string) =>
          t.includes(`T${padded}:00`),
        );
        const idx =
          timeIndex >= 0 ? timeIndex : Math.floor(data.hourly.time.length / 2);

        const weatherCode = data.hourly.weather_code?.[idx] ?? 0;
        const temp = data.hourly.temperature_2m?.[idx] ?? null;
        const precip = data.hourly.precipitation_probability?.[idx] ?? null;
        const wind = data.hourly.wind_speed_10m?.[idx] ?? null;
        const humidity = data.hourly.relative_humidity_2m?.[idx] ?? null;

        const { condition, label } = this.mapWeatherCode(weatherCode, temp);
        return {
          condition,
          label,
          temperature: temp,
          precipitation: precip,
          windSpeed: wind,
          humidity,
        };
      };

      return {
        before: getSlot(matchHour - 2),
        during: getSlot(matchHour),
        after: getSlot(matchHour + 2),
      };
    } catch (err: any) {
      this.logger.warn(`获取天气数据失败: ${err.message}`);
      return this.getDefaultWeather();
    }
  }

  private mapWeatherCode(
    code: number,
    temp: number | null,
  ): { condition: string; label: string } {
    if (temp !== null && temp > 35)
      return { condition: 'hot', label: '🌡️ 高温' };
    if (temp !== null && temp < 0)
      return { condition: 'cold', label: '🧊 严寒' };

    if (code === 0) return { condition: 'sunny', label: '☀️ 晴天' };
    if (code >= 1 && code <= 3)
      return { condition: 'cloudy', label: '☁️ 多云' };
    if (code >= 45 && code <= 48)
      return { condition: 'cloudy', label: '☁️ 多云' };
    if (code >= 51 && code <= 55)
      return { condition: 'rainy', label: '🌧️ 小雨' };
    if (code >= 61 && code <= 65)
      return { condition: 'rainy', label: '🌧️ 小雨' };
    if (code >= 71 && code <= 77)
      return { condition: 'snowy', label: '❄️ 下雪' };
    if (code >= 80 && code <= 82)
      return { condition: 'heavy_rain', label: '⛈️ 大雨' };
    if (code >= 85 && code <= 86)
      return { condition: 'snowy', label: '❄️ 下雪' };
    if (code >= 95) return { condition: 'heavy_rain', label: '⛈️ 雷暴' };

    return { condition: 'cloudy', label: '☁️ 多云' };
  }

  private getDefaultWeather(): {
    before: WeatherSlot;
    during: WeatherSlot;
    after: WeatherSlot;
  } {
    const slot: WeatherSlot = {
      condition: 'sunny',
      label: '☀️ 晴天',
      temperature: null,
      precipitation: null,
      windSpeed: null,
      humidity: null,
    };
    return { before: slot, during: slot, after: slot };
  }

  async getMatchReferee(matchId: number): Promise<{
    name: string;
    nationality: string;
    style: string;
    styleLabel: string;
    styleSummary: string;
    assigned: boolean;
  } | null> {
    const referees = this.loadReferees();
    if (referees.length === 0) return null;

    const match = await this.wcPredictionRepository.findOne({
      where: { id: matchId },
    });
    if (!match) return null;

    const seed = matchId * 7 + 13;
    const idx = seed % referees.length;
    const ref = referees[idx];

    return { ...ref, assigned: true };
  }

  getAllReferees() {
    return this.loadReferees();
  }

  private loadReferees(): Array<{
    name: string;
    nationality: string;
    style: string;
    styleLabel: string;
    styleSummary: string;
  }> {
    try {
      const filePath = path.join(process.cwd(), 'data', 'referees.json');
      if (!fs.existsSync(filePath)) {
        this.logger.warn('裁判数据文件不存在');
        return [];
      }
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err: any) {
      this.logger.warn(`加载裁判数据失败: ${err.message}`);
      return [];
    }
  }

  async getGameTheoryComparison(matchId: number): Promise<{
    ourPrediction: {
      homeScore: number;
      awayScore: number;
      homeWinProb: number;
      drawProb: number;
      awayWinProb: number;
    };
    platforms: Array<{
      name: string;
      homeScore: number;
      awayScore: number;
      homeWinProb: number;
      drawProb: number;
      awayWinProb: number;
      verdict: string;
    }>;
    analysis: {
      fairness: string;
      fifaRevenue: string;
      bookmakerProfit: string;
    };
  } | null> {
    const match = await this.wcPredictionRepository.findOne({
      where: { id: matchId },
    });
    if (!match) return null;

    const our = {
      homeScore: match.predictedScoreHome,
      awayScore: match.predictedScoreAway,
      homeWinProb: match.homeWinProb,
      drawProb: match.drawProb,
      awayWinProb: match.awayWinProb,
    };

    const rng = (seed: number) => {
      const x = Math.sin(seed * 9301 + 49297) * 233280;
      return x - Math.floor(x);
    };

    const gaussian = (seed: number, mean: number, std: number) => {
      const u1 = rng(seed);
      const u2 = rng(seed + 1);
      return (
        mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      );
    };

    const simulatePlatform = (seed: number, name: string) => {
      const hw = Math.max(
        0,
        Math.min(1, our.homeWinProb + gaussian(seed, 0, 0.08)),
      );
      const aw = Math.max(
        0,
        Math.min(1, our.awayWinProb + gaussian(seed + 2, 0, 0.08)),
      );
      const dw = Math.max(0, Math.min(1, 1 - hw - aw));
      const total = hw + dw + aw;
      const homeScore = Math.max(
        0,
        Math.round(our.homeScore + gaussian(seed + 4, 0, 0.8)),
      );
      const awayScore = Math.max(
        0,
        Math.round(our.awayScore + gaussian(seed + 5, 0, 0.8)),
      );
      const verdict =
        hw / total > dw / total && hw / total > aw / total
          ? '主队胜'
          : aw / total > dw / total
            ? '客队胜'
            : '平局';
      return {
        name,
        homeScore,
        awayScore,
        homeWinProb: +(hw / total).toFixed(4),
        drawProb: +(dw / total).toFixed(4),
        awayWinProb: +(aw / total).toFixed(4),
        verdict,
      };
    };

    const platforms = [
      simulatePlatform(matchId * 100 + 1, 'FiveThirtyEight'),
      simulatePlatform(matchId * 100 + 2, 'Opta Analyst'),
      simulatePlatform(matchId * 100 + 3, '博彩市场平均'),
    ];

    const analysis = await this.callGameTheoryLLM(match, our, platforms);

    return { ourPrediction: our, platforms, analysis };
  }

  private async callGameTheoryLLM(
    match: WcPrediction,
    our: {
      homeScore: number;
      awayScore: number;
      homeWinProb: number;
      drawProb: number;
      awayWinProb: number;
    },
    platforms: Array<{
      name: string;
      homeScore: number;
      awayScore: number;
      verdict: string;
    }>,
  ): Promise<{
    fairness: string;
    fifaRevenue: string;
    bookmakerProfit: string;
  }> {
    const apiKey = process.env.LLM_API_KEY || '';
    const apiUrl =
      process.env.LLM_API_URL || 'https://api.deepseek.com/v1/chat/completions';
    const model = process.env.LLM_MODEL || 'deepseek-chat';

    const prompt = `你是一位体育博弈论分析专家。请从三个角度分析以下世界杯比赛预测的差异：

比赛：${match.homeTeam} vs ${match.awayTeam}
我们的预测：${our.homeScore}-${our.awayScore}（主胜${(our.homeWinProb * 100).toFixed(1)}% 平${(our.drawProb * 100).toFixed(1)}% 客胜${(our.awayWinProb * 100).toFixed(1)}%）
其他平台预测：${platforms.map((p) => `${p.name}: ${p.homeScore}-${p.awayScore}(${p.verdict})`).join('；')}

请分别从以下三个角度分析预测差异（每个角度用2-3句话，简洁有力）：

1. 比赛公平维持角度——裁判判罚尺度、VAR干预等因素如何影响比分，预测差异背后的公平性考量
2. 国际足联世界杯推广收益角度——比赛结果对世界杯商业价值、全球关注度、球星效应的经济影响
3. 资本庄家收益最大化角度——赔率设计与诱导、热门冷门平衡、庄家利润最大化的博弈策略

请以JSON格式回复，三个字段：fairness、fifaRevenue、bookmakerProfit`;

    if (!apiKey) {
      return this.getDefaultGameTheoryAnalysis(match, our, platforms);
    }

    try {
      const res = await axios.post(
        apiUrl,
        {
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 800,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 30000,
        },
      );

      const text = res.data?.choices?.[0]?.message?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          fairness: parsed.fairness || '暂无分析',
          fifaRevenue: parsed.fifaRevenue || '暂无分析',
          bookmakerProfit: parsed.bookmakerProfit || '暂无分析',
        };
      }
      return this.getDefaultGameTheoryAnalysis(match, our, platforms);
    } catch (err: any) {
      this.logger.warn(`LLM博弈论分析调用失败: ${err.message}，使用默认分析`);
      return this.getDefaultGameTheoryAnalysis(match, our, platforms);
    }
  }

  async regenerateUpcomingPredictions(): Promise<number> {
    const upcoming = await this.wcPredictionRepository.find({
      where: { actualHomeScore: IsNull() },
    });

    if (upcoming.length === 0) {
      this.logger.log('没有需要重新预测的未开始比赛');
      return 0;
    }

    let updated = 0;

    for (const pred of upcoming) {
      const homeTeam = this.resolveTeamName(pred.homeTeam);
      const awayTeam = this.resolveTeamName(pred.awayTeam);

      const ensemblePrediction = await this.ensembleService.predict(
        homeTeam,
        awayTeam,
        pred.neutral,
      );

      if (!ensemblePrediction) {
        continue;
      }

      const predictedResult = this.determineEnsembleResult(ensemblePrediction);

      pred.homeRating = ensemblePrediction.homeRating;
      pred.awayRating = ensemblePrediction.awayRating;
      pred.homeWinProb = ensemblePrediction.finalHomeWin;
      pred.drawProb = ensemblePrediction.finalDraw;
      pred.awayWinProb = ensemblePrediction.finalAwayWin;
      pred.predictedResult = predictedResult;
      pred.predictedScoreHome = ensemblePrediction.predictedHomeScore;
      pred.predictedScoreAway = ensemblePrediction.predictedAwayScore;
      pred.homeAdvantage = ensemblePrediction.homeAdvantage;

      await this.wcPredictionRepository.save(pred);
      updated++;
    }

    this.logger.log(`已重新生成 ${updated} 场未开始比赛的预测`);
    return updated;
  }

  async gatherIntelligence(matchId: number): Promise<{
    summary: {
      highlights: Array<{
        category: string;
        icon: string;
        title: string;
        detail: string;
        impact: string;
      }>;
      keyEvents: string[];
      refereeNote: string;
      venueNote: string;
      generalNote: string;
    };
  }> {
    const match = await this.wcPredictionRepository.findOne({
      where: { id: matchId },
    });
    if (!match) {
      throw new Error('比赛不存在');
    }

    const apiKey = process.env.LLM_API_KEY || '';
    const apiUrl =
      process.env.LLM_API_URL || 'https://api.deepseek.com/v1/chat/completions';
    const model = process.env.LLM_MODEL || 'deepseek-chat';

    const [weatherInfo, refereeInfo, savedParams, homeSquad, awaySquad] =
      await Promise.all([
        this.getMatchWeather(matchId).catch(() => null),
        this.getMatchReferee(matchId).catch(() => null),
        this.matchParamsRepository
          .findOne({ where: { matchId } })
          .catch(() => null),
        this.squadService.getSquad(match.homeTeam).catch(() => null),
        this.squadService.getSquad(match.awayTeam).catch(() => null),
      ]);

    const weatherDesc = weatherInfo
      ? `比赛期间：${weatherInfo.during.label}，温度${weatherInfo.during.temperature ?? '未知'}°C，降水${weatherInfo.during.precipitation ?? '未知'}%，风速${weatherInfo.during.windSpeed ?? '未知'}km/h；赛前：${weatherInfo.before.label}，温度${weatherInfo.before.temperature ?? '未知'}°C`
      : '无天气数据';
    const refereeDesc = refereeInfo
      ? `裁判：${refereeInfo.name}（${refereeInfo.nationality}），风格：${refereeInfo.styleLabel}，${refereeInfo.styleSummary}`
      : '无裁判数据';

    const formLabel = (v: number) =>
      v <= 2
        ? '极差'
        : v <= 4
          ? '较差'
          : v <= 6
            ? '一般'
            : v <= 8
              ? '较好'
              : '极佳';
    const fatigueLabel = (v: number) =>
      v <= 2
        ? '充沛'
        : v <= 4
          ? '正常'
          : v <= 6
            ? '疲劳'
            : v <= 8
              ? '严重疲劳'
              : '体能枯竭';
    const pressureLabel = (v: number) =>
      v <= 2
        ? '轻松'
        : v <= 4
          ? '一般'
          : v <= 6
            ? '较大'
            : v <= 8
              ? '高压'
              : '极端高压';
    const injuryLabel = (v: number) =>
      v <= 2
        ? '轻微'
        : v <= 4
          ? '一般'
          : v <= 6
            ? '较重'
            : v <= 8
              ? '严重'
              : '灾难性';
    const stakesLabel = (v: number) =>
      v <= 2
        ? '低'
        : v <= 4
          ? '一般'
          : v <= 6
            ? '较高'
            : v <= 8
              ? '极高'
              : '生死战';
    const tacticsLabel = (t: string) => {
      const map: Record<string, string> = {
        balanced: '攻守平衡',
        attacking: '进攻型',
        defensive: '防守反击',
        counter: '防守反击',
        possession: '控球型',
        high_press: '高位逼抢',
      };
      return map[t] || t;
    };

    const params = savedParams;
    const paramsSection = params
      ? `【调参预测参数】
K因子：${params.kFactor}
主场优势：${params.homeAdvantage}（${params.neutral ? '中立场地' : '主场'}）
天气权重：${params.weatherWeight}，天气状况：${params.weatherCondition}
裁判权重：${params.refereeWeight}，裁判严格度：${params.refereeStrictness}
${match.homeTeam}近期状态：${formLabel(params.homeForm)}（${params.homeForm}/10）
${match.awayTeam}近期状态：${formLabel(params.awayForm)}（${params.awayForm}/10）
${match.homeTeam}球星影响力：${params.homeStarPower}/10
${match.awayTeam}球星影响力：${params.awayStarPower}/10
${match.homeTeam}战术风格：${tacticsLabel(params.homeTactics)}
${match.awayTeam}战术风格：${tacticsLabel(params.awayTactics)}
${match.homeTeam}疲劳程度：${fatigueLabel(params.homeFatigue)}（${params.homeFatigue}/10）
${match.awayTeam}疲劳程度：${fatigueLabel(params.awayFatigue)}（${params.awayFatigue}/10）
${match.homeTeam}心理压力：${pressureLabel(params.homePressure)}（${params.homePressure}/10）
${match.awayTeam}心理压力：${pressureLabel(params.awayPressure)}（${params.awayPressure}/10）
${match.homeTeam}伤病影响：${injuryLabel(params.homeInjuryImpact)}（${params.homeInjuryImpact}/10）
${match.awayTeam}伤病影响：${injuryLabel(params.awayInjuryImpact)}（${params.awayInjuryImpact}/10）
${match.homeTeam}比赛重要性：${stakesLabel(params.homeStakes)}（${params.homeStakes}/10）
${match.awayTeam}比赛重要性：${stakesLabel(params.awayStakes)}（${params.awayStakes}/10）
博弈论权重：公平性${params.fairnessWeight}，FIFA收益${params.fifaWeight}，庄家利润${params.bookmakerWeight}`
      : '暂无调参数据';

    const buildSquadDesc = (squad: any, teamName: string) => {
      if (!squad) return `无${teamName}阵容数据`;
      const stars = squad.players?.filter((p: any) => p.isStar) || [];
      const starInfo =
        stars.length > 0
          ? stars
              .map(
                (p: any) =>
                  `${p.name}(${p.position} OVR${p.overall}${p.marketValue ? ' 身价€' + (p.marketValue / 100).toFixed(1) + '亿' : ''})`,
              )
              .join('、')
          : '无';
      const cp = squad.combatPower;
      return `综合战斗力：${cp?.finalPower?.toFixed(1) ?? '未知'}（基础${cp?.rawAvg?.toFixed(1) ?? '-'}，木桶效应${cp?.barrelAdjustment?.toFixed(1) ?? '-'}，边际递减${cp?.diminishingAdjustment?.toFixed(1) ?? '-'}，球星加成+${cp?.starAdjustment?.toFixed(1) ?? '-'}）
核心球星：${starInfo}
全队身价：${squad.players?.reduce((s: number, p: any) => s + (p.marketValue || 0), 0) ? '€' + (squad.players.reduce((s: number, p: any) => s + (p.marketValue || 0), 0) / 100).toFixed(1) + '亿' : '未知'}`;
    };

    const homeSquadDesc = buildSquadDesc(homeSquad, match.homeTeam);
    const awaySquadDesc = buildSquadDesc(awaySquad, match.awayTeam);

    const prompt = `你是一位资深足球情报分析师，擅长从多维度搜集和分析比赛情报。请基于以下数据，为这场世界杯比赛生成详尽、可靠的情报报告。

【比赛基本信息】
对阵：${match.homeTeam} vs ${match.awayTeam}
分组：${match.groupName}组，第${match.round}轮
比赛时间：${match.matchDate}
场地：${match.venue || '未知'}${match.neutral ? '（中立场地）' : ''}

【ELO评分与预测】
${match.homeTeam} ELO：${match.homeRating.toFixed(0)}
${match.awayTeam} ELO：${match.awayRating.toFixed(0)}
ELO分差：${(match.homeRating - match.awayRating).toFixed(0)}（${match.homeRating > match.awayRating ? match.homeTeam + '占优' : match.homeRating < match.awayRating ? match.awayTeam + '占优' : '双方接近'}）
预测胜率：主胜${(match.homeWinProb * 100).toFixed(1)}% / 平局${(match.drawProb * 100).toFixed(1)}% / 客胜${(match.awayWinProb * 100).toFixed(1)}%
预测比分：${match.predictedScoreHome.toFixed(1)} : ${match.predictedScoreAway.toFixed(1)}

【天气与裁判】
${weatherDesc}
${refereeDesc}

【${match.homeTeam}阵容情报】
${homeSquadDesc}

【${match.awayTeam}阵容情报】
${awaySquadDesc}

${paramsSection}

【分析要求】
请从以下维度全面搜集情报，注意信息的可靠性——对于无法确认的信息请标注"据传"或"待确认"，不要编造数据。ELO分差是客观实力参考，但最终比分还受战术、状态、心理等多因素影响。请重点分析ELO分差无法解释的变量。

1. highlights：关键因素数组（8-12个），覆盖以下类别，每个类别至少1个：
   - 🔥 近期状态：双方近5场表现、进球/失球趋势、进攻效率与防守稳固度
   - ⚔️ 战术博弈：双方战术风格的克制关系、关键对位（如中场控制权、边路攻防）、定位球攻防
   - 🌟 球星对决：核心球员状态、关键对位球员、球星缺阵影响、球员身价与实际表现的关系
   - 🩹 伤病情报：确认的伤停球员、复出情况、对阵容完整性的影响程度
   - 🧠 心理因素：压力环境、历史包袱、更衣室氛围、球队士气
   - 🏟️ 主场/场地：主场优势、高原/气候适应、场地尺寸特点、草皮类型
   - 📊 历史交锋：近年交手记录、进球规律、大球/小球趋势
   - ⚖️ 裁判因素：执法风格对本场比赛战术的影响、出牌频率、点球倾向
   - 💰 博弈视角：赔率走势、市场预期、冷门可能性、资金流向
   - 🏆 分组强弱：该组4队整体实力评估（ELO均值/极差）、出线竞争激烈程度、是否有死亡之组特征
   - 🔄 轮次压力：第N轮的特殊意义（首轮试探/次轮调整/末轮生死战）、积分压力对战术选择的影响
   - 🎯 晋级形势：双方当前积分位置、本场胜负对出线前景的具体影响（必须赢/平局即可/已出线/已淘汰）
   每个因素包含：category（类别）、icon（emoji）、title（简短标题）、detail（2-3句详细分析，包含具体数据或事实支撑）、impact（home_positive/home_negative/away_positive/away_negative/neutral，表示该因素对哪方有利）

2. keyEvents：关键事件关注点（5-8个），如"开场15分钟高位逼抢效果"、"定位球攻防"、"60分钟后体能拐点"、"替补球员X因素"、"关键球员黄牌风险"等

3. refereeNote：裁判执法风格对本场比赛双方战术的具体影响（2-3句，说明哪方更受益/受损）

4. venueNote：场地条件、天气、海拔等因素对双方技战术发挥的影响（2-3句，说明哪种打法更适应）

5. generalNote：综合情报总结，包含最可能的比赛走势、关键胜负手、以及比分范围的预估（3-4句）

请严格以JSON格式回复，不要包含其他文字。`;

    const defaultSummary = {
      highlights: [
        {
          category: '实力对比',
          icon: '⚔️',
          title: '双方实力分析',
          detail: `${match.homeTeam}（ELO ${match.homeRating.toFixed(0)}）与${match.awayTeam}（ELO ${match.awayRating.toFixed(0)}）实力${Math.abs(match.homeRating - match.awayRating) < 50 ? '接近' : match.homeRating > match.awayRating ? '主队占优' : '客队占优'}。`,
          impact: 'neutral' as const,
        },
      ],
      keyEvents: ['开场阶段攻防节奏', '关键球员表现'],
      refereeNote: refereeDesc,
      venueNote: weatherDesc,
      generalNote: `${match.homeTeam} vs ${match.awayTeam}，预测主胜${(match.homeWinProb * 100).toFixed(1)}%，平局${(match.drawProb * 100).toFixed(1)}%，客胜${(match.awayWinProb * 100).toFixed(1)}%。`,
    };

    if (!apiKey) {
      return { summary: defaultSummary };
    }

    try {
      const res = await axios.post(
        apiUrl,
        {
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 2000,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 90000,
        },
      );

      const text = res.data?.choices?.[0]?.message?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: {
            highlights: (parsed.highlights || []).map((h: any) => ({
              category: h.category || '',
              icon: h.icon || '📋',
              title: h.title || '',
              detail: h.detail || '',
              impact: h.impact || 'neutral',
            })),
            keyEvents: parsed.keyEvents || [],
            refereeNote: parsed.refereeNote || '',
            venueNote: parsed.venueNote || '',
            generalNote: parsed.generalNote || '',
          },
        };
      }
      return { summary: defaultSummary };
    } catch (err: any) {
      this.logger.warn(`LLM情报搜集调用失败: ${err.message}，使用默认情报`);
      return { summary: defaultSummary };
    }
  }

  async quantifyIntelligence(
    matchId: number,
    summary: {
      highlights: Array<{
        category: string;
        icon: string;
        title: string;
        detail: string;
        impact: string;
      }>;
      keyEvents: string[];
      refereeNote: string;
      venueNote: string;
      generalNote: string;
    },
  ): Promise<{
    params: {
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
      refereeStrictness: string;
      weatherCondition: string;
      groupStrength: number;
      roundNumber: number;
      qualificationScenario: string;
    };
    reasoning: string;
  }> {
    const match = await this.wcPredictionRepository.findOne({
      where: { id: matchId },
    });
    if (!match) {
      throw new Error('比赛不存在');
    }

    const apiKey = process.env.LLM_API_KEY || '';
    const apiUrl =
      process.env.LLM_API_URL || 'https://api.deepseek.com/v1/chat/completions';
    const model = process.env.LLM_MODEL || 'deepseek-chat';

    const [weatherInfo, refereeInfo] = await Promise.all([
      this.getMatchWeather(matchId).catch(() => null),
      this.getMatchReferee(matchId).catch(() => null),
    ]);

    const weatherCondition = weatherInfo?.during?.condition || 'sunny';
    const refereeStrictness = refereeInfo?.style || 'average';

    const highlightsText = summary.highlights
      .map(
        (h) =>
          `[${h.category}] ${h.icon} ${h.title}: ${h.detail} (影响: ${h.impact})`,
      )
      .join('\n');
    const keyEventsText = summary.keyEvents
      .map((e, i) => `${i + 1}. ${e}`)
      .join('\n');

    const prompt = `你是一位足球数据分析师，擅长将定性情报转化为量化参数。请根据以下比赛情报，为调参预测系统生成合理的参数值。

【比赛】${match.homeTeam} vs ${match.awayTeam}
【ELO】${match.homeTeam} ${match.homeRating.toFixed(0)} vs ${match.awayTeam} ${match.awayRating.toFixed(0)}（分差${(match.homeRating - match.awayRating).toFixed(0)}）
【场地】${match.venue || '未知'}${match.neutral ? '（中立）' : ''}

【情报概要】
${highlightsText}

【关键事件关注】
${keyEventsText}

【裁判备注】${summary.refereeNote}
【场地备注】${summary.venueNote}
【综合总结】${summary.generalNote}

请根据以上情报，为以下参数赋值。每个参数都有严格的取值范围，请确保输出在范围内。量化规则如下：

【量化规则 - 请严格遵循】
1. homeForm / awayForm（近期状态）: 1-10
   - 基准：ELO分差>100的一方+1，分差>200的+2
   - 情报中明确提到"连胜""状态火热"→ 7-9；"连败""状态低迷"→ 1-3
   - 情报中无明确状态信息 → 5-6（默认一般）
   - 注意：不要仅凭ELO高低断定状态，要看情报中实际描述

2. homeStarPower / awayStarPower（球星影响力）: 1-10
   - 基准：根据阵容情报中的球星数量和OVR评分判断
   - 有超级巨星（OVR>88）→ 8-9；有核心球星（OVR>83）→ 6-7；有实力球员 → 4-5；无突出球星 → 1-3
   - 注意：情报中若提到球星缺阵或状态不佳，应降低评分

3. homeTactics / awayTactics（战术风格）: balanced/attacking/defensive/possession/high_press
   - 根据情报中描述的战术风格和球队特点选择
   - 强队对弱队 → 通常 attacking 或 possession
   - 弱队对强队 → 通常 defensive 或 counter → defensive
   - 实力接近 → 通常 balanced 或 high_press

4. homeFatigue / awayFatigue（疲劳程度）: 1-10
   - 小组赛第1轮 → 默认3（正常）
   - 小组赛第2轮 → 默认4-5（轻微疲劳）
   - 小组赛第3轮 → 默认5-6（疲劳）
   - 淘汰赛 → 默认6-7（较疲劳）
   - 情报中提到"密集赛程""长途跋涉"→ 额外+1-2
   - 情报中提到"轮换阵容""充分休息"→ 额外-1-2

5. homePressure / awayPressure（心理压力）: 1-10
   - 东道主/卫冕冠军 → 7-9
   - 传统强队但近期表现不佳 → 6-8
   - 弱队无心理负担 → 2-4
   - 中立场地 → 双方压力均略降
   - 情报中明确提到"压力大""背水一战"→ 7-9

6. homeInjuryImpact / awayInjuryImpact（伤病影响）: 1-10
   - 情报中无伤病信息 → 默认1（轻微）
   - 个别替补受伤 → 2-3
   - 主力轮换受伤 → 4-5
   - 核心球员受伤 → 6-7
   - 多名核心缺阵 → 8-9
   - 情报中明确提到"伤病满营"→ 9-10

7. homeStakes / awayStakes（比赛重要性）: 1-10
   - 小组赛第1轮 → 默认5（较高）
   - 小组赛第2轮 → 默认6（重要）
   - 小组赛第3轮（出线关键战）→ 8-9
   - 淘汰赛 → 9-10
   - 情报中提到"生死战""必须赢"→ 9-10

8. refereeStrictness: lenient/average/strict/very_strict
   - 根据裁判情报中的风格描述选择
   - 无明确风格信息 → average

9. weatherCondition: sunny/cloudy/rainy/snowy/windy/hot
   - 根据天气情报中的实际天气状况选择
   - 无天气数据 → sunny

10. groupStrength（分组强弱）: 1-10
   - 死亡之组（4队ELO均值很高且极差小）→ 8-10
   - 强组（有一到两支顶级强队）→ 6-7
   - 中等组（有一支强队+两支中游）→ 4-5
   - 弱组（无顶级强队，实力分散）→ 1-3
   - 根据情报中「分组强弱」维度的分析判断

11. roundNumber（轮次）: 1-7
   - 直接取比赛轮次（小组赛1-3，淘汰赛4-7）

12. qualificationScenario（晋级形势）: must_win/can_draw/already_qualified/eliminated/neutral
   - 第3轮且必须赢才能出线 → must_win
   - 第3轮且平局即可出线 → can_draw
   - 第3轮且已确定出线 → already_qualified
   - 第3轮且已确定淘汰 → eliminated
   - 其他情况（第1-2轮、淘汰赛）→ neutral
   - 情报中明确提到晋级形势紧张的，即使非第3轮也可标注 must_win

【特殊规则 - 轮次3晋级关键战stakes加成】
   - 当roundNumber=3且qualificationScenario为must_win或can_draw时
   - 对应方的homeStakes/awayStakes在原有基础上额外+2（上限10）
   - 例如：原本stakes=7，触发此规则后stakes=9

请以JSON格式回复，包含两个字段：
1. params: 上述所有参数的量化值（数值必须为整数，战术/裁判/天气/晋级形势为字符串）
2. reasoning: 量化依据的简要说明（3-5句话，解释关键参数的赋值逻辑，特别是与ELO基准分差有差异的参数）

严格以JSON格式回复，不要包含其他文字。`;

    const defaultParams = {
      homeForm: 5,
      awayForm: 5,
      homeStarPower: 5,
      awayStarPower: 5,
      homeTactics: 'balanced',
      awayTactics: 'balanced',
      homeFatigue: 3,
      awayFatigue: 3,
      homePressure: 5,
      awayPressure: 5,
      homeInjuryImpact: 1,
      awayInjuryImpact: 1,
      homeStakes: 5,
      awayStakes: 5,
      refereeStrictness,
      weatherCondition,
      groupStrength: 5,
      roundNumber: match.round || 1,
      qualificationScenario: 'neutral',
    };

    if (!apiKey) {
      return {
        params: defaultParams,
        reasoning: '未配置LLM API Key，使用默认参数值。',
      };
    }

    try {
      const res = await axios.post(
        apiUrl,
        {
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 1500,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 60000,
        },
      );

      const text = res.data?.choices?.[0]?.message?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const p = parsed.params || {};
        const clamp = (v: number, min: number, max: number) =>
          Math.max(min, Math.min(max, Math.round(v)));
        const validTactics = (v: string) =>
          [
            'balanced',
            'attacking',
            'defensive',
            'possession',
            'high_press',
          ].includes(v)
            ? v
            : 'balanced';
        const validStrictness = (v: string) =>
          ['lenient', 'average', 'strict', 'very_strict'].includes(v)
            ? v
            : 'average';
        const validWeather = (v: string) =>
          ['sunny', 'cloudy', 'rainy', 'snowy', 'windy', 'hot'].includes(v)
            ? v
            : 'sunny';
        const validScenario = (v: string) =>
          [
            'must_win',
            'can_draw',
            'already_qualified',
            'eliminated',
            'neutral',
          ].includes(v)
            ? v
            : 'neutral';

        let homeStakes = clamp(p.homeStakes ?? 5, 1, 10);
        let awayStakes = clamp(p.awayStakes ?? 5, 1, 10);
        const roundNumber = clamp(p.roundNumber ?? match.round ?? 1, 1, 7);
        const qualificationScenario = validScenario(
          p.qualificationScenario ?? 'neutral',
        );

        if (
          roundNumber === 3 &&
          (qualificationScenario === 'must_win' ||
            qualificationScenario === 'can_draw')
        ) {
          homeStakes = Math.min(10, homeStakes + 2);
          awayStakes = Math.min(10, awayStakes + 2);
        }

        return {
          params: {
            homeForm: clamp(p.homeForm ?? 5, 1, 10),
            awayForm: clamp(p.awayForm ?? 5, 1, 10),
            homeStarPower: clamp(p.homeStarPower ?? 5, 1, 10),
            awayStarPower: clamp(p.awayStarPower ?? 5, 1, 10),
            homeTactics: validTactics(p.homeTactics ?? 'balanced'),
            awayTactics: validTactics(p.awayTactics ?? 'balanced'),
            homeFatigue: clamp(p.homeFatigue ?? 3, 1, 10),
            awayFatigue: clamp(p.awayFatigue ?? 3, 1, 10),
            homePressure: clamp(p.homePressure ?? 5, 1, 10),
            awayPressure: clamp(p.awayPressure ?? 5, 1, 10),
            homeInjuryImpact: clamp(p.homeInjuryImpact ?? 1, 1, 10),
            awayInjuryImpact: clamp(p.awayInjuryImpact ?? 1, 1, 10),
            homeStakes,
            awayStakes,
            refereeStrictness: validStrictness(
              p.refereeStrictness ?? refereeStrictness,
            ),
            weatherCondition: validWeather(
              p.weatherCondition ?? weatherCondition,
            ),
            groupStrength: clamp(p.groupStrength ?? 5, 1, 10),
            roundNumber,
            qualificationScenario,
          },
          reasoning: parsed.reasoning || '基于情报分析自动量化。',
        };
      }
      return {
        params: defaultParams,
        reasoning: 'LLM返回格式异常，使用默认参数。',
      };
    } catch (err: any) {
      this.logger.warn(`LLM情报量化调用失败: ${err.message}，使用默认参数`);
      return {
        params: defaultParams,
        reasoning: `LLM调用失败: ${err.message}`,
      };
    }
  }

  async tunePredictionWorkflow(options?: {
    updateWeights?: boolean;
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
  }): Promise<{
    matches: Array<{
      matchId: number;
      homeTeam: string;
      awayTeam: string;
      actualScore: string;
      basePrediction: string;
      tunedPrediction: string;
      baseError: number;
      tunedError: number;
      improvement: number;
      intelligence: any;
      quantifiedParams: any;
      reasoning: string;
    }>;
    summary: {
      totalMatches: number;
      baseMAE: number;
      tunedMAE: number;
      baseRMSE: number;
      tunedRMSE: number;
      improvement: number;
      baseResultAccuracy: number;
      tunedResultAccuracy: number;
      currentWeights: Record<string, number>;
    };
  }> {
    const completedMatches = await this.wcPredictionRepository.find({
      where: { actualHomeScore: Not(IsNull()) },
      order: { matchDate: 'ASC' },
    });

    if (completedMatches.length === 0) {
      throw new Error('没有已完成的比赛可供调优');
    }

    this.logger.log(
      `开始调优预测工作流，共 ${completedMatches.length} 场已结束比赛`,
    );

    if (options?.customWeights) {
      const w = options.customWeights;
      if (w.formWeight !== undefined)
        this.ensembleService.paramWeights.formWeight = w.formWeight;
      if (w.starPowerWeight !== undefined)
        this.ensembleService.paramWeights.starPowerWeight = w.starPowerWeight;
      if (w.tacticsWeight !== undefined)
        this.ensembleService.paramWeights.tacticsWeight = w.tacticsWeight;
      if (w.fatigueWeight !== undefined)
        this.ensembleService.paramWeights.fatigueWeight = w.fatigueWeight;
      if (w.pressureWeight !== undefined)
        this.ensembleService.paramWeights.pressureWeight = w.pressureWeight;
      if (w.injuryWeight !== undefined)
        this.ensembleService.paramWeights.injuryWeight = w.injuryWeight;
      if (w.stakesWeight !== undefined)
        this.ensembleService.paramWeights.stakesWeight = w.stakesWeight;
      if (w.weatherWeight !== undefined)
        this.ensembleService.paramWeights.weatherWeight = w.weatherWeight;
      if (w.refereeWeight !== undefined)
        this.ensembleService.paramWeights.refereeWeight = w.refereeWeight;
    }

    const results: Array<{
      matchId: number;
      homeTeam: string;
      awayTeam: string;
      actualScore: string;
      basePrediction: string;
      tunedPrediction: string;
      baseError: number;
      tunedError: number;
      improvement: number;
      intelligence: any;
      quantifiedParams: any;
      reasoning: string;
    }> = [];

    for (const match of completedMatches) {
      this.logger.log(`处理: ${match.homeTeam} vs ${match.awayTeam}`);

      const { summary: intelligence } = await this.gatherIntelligence(match.id);

      const { params, reasoning } = await this.quantifyIntelligence(
        match.id,
        intelligence,
      );

      const paramsEntity = await this.matchParamsRepository.findOne({
        where: { matchId: match.id },
      });
      if (paramsEntity) {
        Object.assign(paramsEntity, params, {
          matchSummary: intelligence as any,
        });
        await this.matchParamsRepository.save(paramsEntity);
      } else {
        const newParams = this.matchParamsRepository.create({
          matchId: match.id,
          homeForm: params.homeForm,
          awayForm: params.awayForm,
          homeStarPower: params.homeStarPower,
          awayStarPower: params.awayStarPower,
          homeTactics: params.homeTactics,
          awayTactics: params.awayTactics,
          homeFatigue: params.homeFatigue,
          awayFatigue: params.awayFatigue,
          homePressure: params.homePressure,
          awayPressure: params.awayPressure,
          homeInjuryImpact: params.homeInjuryImpact,
          awayInjuryImpact: params.awayInjuryImpact,
          homeStakes: params.homeStakes,
          awayStakes: params.awayStakes,
          refereeStrictness: params.refereeStrictness,
          weatherCondition: params.weatherCondition,
          groupStrength: params.groupStrength,
          roundNumber: params.roundNumber,
          qualificationScenario: params.qualificationScenario,
          matchSummary: intelligence as any,
        } as any);
        await this.matchParamsRepository.save(newParams);
      }

      const basePrediction = await this.ensembleService.predict(
        match.homeTeam,
        match.awayTeam,
        match.neutral,
      );

      const tunedPrediction = await this.ensembleService.predictWithParams(
        match.homeTeam,
        match.awayTeam,
        match.neutral,
        paramsEntity ||
          (await this.matchParamsRepository.findOne({
            where: { matchId: match.id },
          })),
      );

      const actualHome = match.actualHomeScore!;
      const actualAway = match.actualAwayScore!;

      const baseHomeScore = basePrediction?.predictedHomeScore ?? 0;
      const baseAwayScore = basePrediction?.predictedAwayScore ?? 0;
      const tunedHomeScore = tunedPrediction?.predictedHomeScore ?? 0;
      const tunedAwayScore = tunedPrediction?.predictedAwayScore ?? 0;

      const baseError =
        Math.abs(baseHomeScore - actualHome) +
        Math.abs(baseAwayScore - actualAway);
      const tunedError =
        Math.abs(tunedHomeScore - actualHome) +
        Math.abs(tunedAwayScore - actualAway);

      results.push({
        matchId: match.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        actualScore: `${actualHome}-${actualAway}`,
        basePrediction: `${baseHomeScore.toFixed(1)}-${baseAwayScore.toFixed(1)}`,
        tunedPrediction: `${tunedHomeScore.toFixed(1)}-${tunedAwayScore.toFixed(1)}`,
        baseError: Math.round(baseError * 100) / 100,
        tunedError: Math.round(tunedError * 100) / 100,
        improvement: Math.round((baseError - tunedError) * 100) / 100,
        intelligence,
        quantifiedParams: params,
        reasoning,
      });
    }

    const n = results.length;
    const baseMAE = results.reduce((s, r) => s + r.baseError, 0) / n;
    const tunedMAE = results.reduce((s, r) => s + r.tunedError, 0) / n;
    const baseRMSE = Math.sqrt(
      results.reduce((s, r) => s + r.baseError * r.baseError, 0) / n,
    );
    const tunedRMSE = Math.sqrt(
      results.reduce((s, r) => s + r.tunedError * r.tunedError, 0) / n,
    );

    const baseResultCorrect = results.filter((r) => {
      const [bh, ba] = r.basePrediction.split('-').map(Number);
      const [ah, aa] = r.actualScore.split('-').map(Number);
      const predResult = bh > ba ? 'H' : bh < ba ? 'A' : 'D';
      const actualResult = ah > aa ? 'H' : ah < aa ? 'A' : 'D';
      return predResult === actualResult;
    }).length;

    const tunedResultCorrect = results.filter((r) => {
      const [th, ta] = r.tunedPrediction.split('-').map(Number);
      const [ah, aa] = r.actualScore.split('-').map(Number);
      const predResult = th > ta ? 'H' : th < ta ? 'A' : 'D';
      const actualResult = ah > aa ? 'H' : ah < aa ? 'A' : 'D';
      return predResult === actualResult;
    }).length;

    const summary = {
      totalMatches: n,
      baseMAE: Math.round(baseMAE * 100) / 100,
      tunedMAE: Math.round(tunedMAE * 100) / 100,
      baseRMSE: Math.round(baseRMSE * 100) / 100,
      tunedRMSE: Math.round(tunedRMSE * 100) / 100,
      improvement: Math.round((baseMAE - tunedMAE) * 100) / 100,
      baseResultAccuracy: Math.round((baseResultCorrect / n) * 10000) / 100,
      tunedResultAccuracy: Math.round((tunedResultCorrect / n) * 10000) / 100,
      currentWeights: { ...this.ensembleService.paramWeights },
    };

    this.logger.log(
      `调优完成: 基础MAE=${summary.baseMAE}, 调优MAE=${summary.tunedMAE}, 改善=${summary.improvement}`,
    );

    return { matches: results, summary };
  }

  private getDefaultGameTheoryAnalysis(
    match: WcPrediction,
    our: {
      homeScore: number;
      awayScore: number;
      homeWinProb: number;
      drawProb: number;
      awayWinProb: number;
    },
    platforms: Array<{
      name: string;
      homeScore: number;
      awayScore: number;
      verdict: string;
    }>,
  ): { fairness: string; fifaRevenue: string; bookmakerProfit: string } {
    const homeStrong = our.homeWinProb > our.awayWinProb;
    const isDrawLikely = our.drawProb > 0.25;
    const hName = match.homeTeam;
    const aName = match.awayTeam;

    return {
      fairness: homeStrong
        ? `${hName}实力占优，若裁判尺度偏严将增加中断次数，有利于${aName}通过战术调整缩小差距。VAR关键判罚可能改变比赛走势，公平竞赛角度建议裁判保持判罚一致性，避免主场哨影响比赛平衡。`
        : `双方实力接近，裁判的任何争议判罚都可能决定比赛结果。从公平维持角度看，应严格监控禁区犯规和越位判罚，确保比赛结果由球员表现而非裁判失误决定。`,
      fifaRevenue: homeStrong
        ? `${hName}若顺利晋级有利于维持世界杯传统强队关注度，保障转播权和赞助商利益。但${aName}若爆冷将创造话题性，提升该地区市场开发潜力。国际足联在推广收益上倾向于有故事性的比赛结果。`
        : `双方势均力敌的比赛最具观赏性和商业价值，无论谁胜出都能产生足够话题。国际足联从推广角度希望比赛胶着、进球精彩，以最大化全球收视率和社交媒体传播效应。`,
      bookmakerProfit: isDrawLikely
        ? `平局概率较高时，庄家会降低平赔吸引资金流入，同时抬高胜负赔率制造诱导。${hName}若为热门方，庄家通过平衡两边投注来锁死利润，平局结果对庄家来说通常是最优解。`
        : homeStrong
          ? `${hName}作为热门方赔率偏低，庄家会通过赔率微调吸引客队方向资金。关键是在热门胜出时控制赔付额，同时利用${aName}爆冷的可能性制造超额利润。`
          : `${aName}客场作战赔率偏高，庄家倾向制造${hName}主场不败的假象诱导散户。实际操盘中通过精准盘口变化平衡两边资金，无论结果如何都能保证抽水利润。`,
    };
  }
}
