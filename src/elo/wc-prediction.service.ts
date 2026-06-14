import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';
import axios from 'axios';
import * as https from 'https';
import { EloService, MatchPrediction } from './elo.service';
import { WcPrediction } from './wc-prediction.entity';

export interface WcFixture {
  date: string;
  time: string;
  group: string;
  homeTeam: string;
  awayTeam: string;
  round: number;
  venue: string;
  neutral: boolean;
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
};

@Injectable()
export class WcPredictionService {
  private readonly logger = new Logger(WcPredictionService.name);

  constructor(
    @InjectRepository(WcPrediction)
    private readonly wcPredictionRepository: Repository<WcPrediction>,
    private readonly eloService: EloService,
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

    const prediction = await this.eloService.predictMatch(
      homeTeam,
      awayTeam,
      fixture.neutral,
    );

    if (!prediction) {
      this.logger.warn(
        `无法预测: ${fixture.homeTeam} vs ${fixture.awayTeam} (ELO 数据缺失)`,
      );
      return null;
    }

    const predictedResult = this.determinePredictedResult(prediction);
    const { homeGoals, awayGoals } = this.predictScore(prediction);

    const entity = new WcPrediction();
    entity.matchDate = `${fixture.date} ${fixture.time}`;
    entity.groupName = fixture.group;
    entity.homeTeam = fixture.homeTeam;
    entity.awayTeam = fixture.awayTeam;
    entity.round = fixture.round;
    entity.homeRating = prediction.homeRating;
    entity.awayRating = prediction.awayRating;
    entity.homeWinProb = prediction.homeWinProbability;
    entity.drawProb = prediction.drawProbability;
    entity.awayWinProb = prediction.awayWinProbability;
    entity.predictedResult = predictedResult;
    entity.predictedScoreHome = homeGoals;
    entity.predictedScoreAway = awayGoals;
    entity.homeAdvantage = prediction.homeAdvantage;
    entity.venue = fixture.venue;
    entity.neutral = fixture.neutral;
    entity.actualHomeScore = null;
    entity.actualAwayScore = null;
    entity.resultCorrect = null;

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
          fixtures.push({
            date: record['date'],
            time: record['match_time'] || '15:00:00',
            group: record['group'],
            homeTeam: record['home_team']?.trim() || '',
            awayTeam: record['away_team']?.trim() || '',
            round: parseInt(record['round'], 10),
            venue: record['venue']?.trim() || '',
            neutral: record['neutral']?.toUpperCase() === 'TRUE',
          });
        })
        .on('end', () => resolve(fixtures))
        .on('error', (error: Error) => reject(error));
    });
  }

  async getRecentMatches(): Promise<WcPrediction[]> {
    const today = new Date().toISOString().split('T')[0];
    const weekLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    return this.wcPredictionRepository
      .createQueryBuilder('p')
      .where('p.matchDate >= :threeDaysAgo', { threeDaysAgo })
      .andWhere('p.matchDate <= :weekLater', { weekLater })
      .orderBy('p.matchDate', 'ASC')
      .addOrderBy('p.id', 'ASC')
      .getMany();
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
    const prediction = await this.wcPredictionRepository.findOne({
      where: { homeTeam, awayTeam },
    });

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
}
