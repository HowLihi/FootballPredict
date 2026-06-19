import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TeamPlayer } from './team-player.entity';
import { FootballDataApiDataSource } from '../collector/api/football-data.source';
import { EloService } from './elo.service';
import { Player, Squad, generateSquad } from './squad-generator';
import { NATIONAL_TEAMS } from './national-teams';
import { PlayerMarketValueService } from './player-market-value.service';

const POSITION_MAP: Record<string, string> = {
  Goalkeeper: 'GK',
  Defence: 'CB',
  Midfield: 'CM',
  Offence: 'ST',
};

const POSITION_CODE_MAP: Record<string, string[]> = {
  GK: ['GK'],
  CB: ['CB', 'LB', 'RB'],
  CM: ['CDM', 'CM', 'CAM'],
  ST: ['LW', 'RW', 'ST', 'CAM'],
};

const POSITION_ORDER: Record<string, number> = {
  GK: 0,
  CB: 1,
  LB: 2,
  RB: 3,
  CDM: 4,
  CM: 5,
  CAM: 6,
  LW: 7,
  RW: 8,
  ST: 9,
};

const STRENGTH_POOL = [
  '速度爆发',
  '盘带突破',
  '传球视野',
  '射门精准',
  '防守拦截',
  '头球争顶',
  '任意球',
  '点球',
  '体能耐力',
  '位置感',
  '领导力',
  '抢断',
];

const WEAKNESS_POOL = [
  '对抗能力',
  '回防意识',
  '逆足能力',
  '高空球处理',
  '一对一防守',
  '体能持续性',
  '心理素质',
  '战术执行力',
  '传球成功率',
  '门前冷静',
  '速度劣势',
  '转身灵活',
];

const POSITION_STRENGTHS: Record<string, number[]> = {
  GK: [4, 5, 9],
  CB: [4, 5, 9, 11],
  LB: [0, 2, 9],
  RB: [0, 2, 9],
  CDM: [4, 9, 11],
  CM: [2, 9, 8],
  CAM: [1, 2, 3],
  LW: [0, 1, 3],
  RW: [0, 1, 3],
  ST: [3, 5, 7],
};

const POSITION_WEAKNESSES: Record<string, number[]> = {
  GK: [0, 3, 10],
  CB: [0, 6, 11],
  LB: [4, 5, 7],
  RB: [4, 5, 7],
  CDM: [1, 6, 9],
  CM: [4, 6],
  CAM: [1, 4, 8],
  LW: [1, 4, 8],
  RW: [1, 4, 8],
  ST: [1, 4, 7],
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface TeamSearchResult {
  id: number;
  name: string;
  shortName: string;
  crest: string;
  squad: Array<{
    id: number;
    name: string;
    position: string;
    dateOfBirth: string;
    nationality: string;
  }>;
}

@Injectable()
export class SquadService {
  private readonly logger = new Logger(SquadService.name);
  private readonly cache = new Map<string, { data: Squad; ts: number }>();
  private teamIndex: Map<string, TeamSearchResult> | null = null;
  private teamIndexLoading = false;
  private wcTeamIndex: Map<string, TeamSearchResult> | null = null;
  private wcTeamIndexLoading = false;
  private readonly playerPhotoCache = new Map<string, string>();
  private photoFetchPromise: Promise<void> | null = null;

  constructor(
    @InjectRepository(TeamPlayer)
    private readonly playerRepo: Repository<TeamPlayer>,
    private readonly footballDataApi: FootballDataApiDataSource,
    private readonly eloService: EloService,
    private readonly marketValueService: PlayerMarketValueService,
  ) {}

  private async ensureTeamIndex(): Promise<Map<string, TeamSearchResult>> {
    if (this.teamIndex && this.teamIndex.size > 0) {
      return this.teamIndex;
    }

    if (this.teamIndexLoading) {
      while (this.teamIndexLoading) {
        await new Promise((r) => setTimeout(r, 500));
      }
      return this.teamIndex!;
    }

    this.teamIndexLoading = true;
    try {
      this.logger.log('开始预加载联赛球队索引...');
      const allTeams = await this.footballDataApi.fetchAllCompetitionTeams();
      this.teamIndex = new Map();

      for (const team of allTeams) {
        const keys = [
          team.name?.toLowerCase(),
          team.shortName?.toLowerCase(),
        ].filter(Boolean);
        for (const key of keys) {
          this.teamIndex.set(key, team);
        }
      }

      this.logger.log(
        `球队索引加载完成: ${this.teamIndex.size} 个名称映射，${allTeams.length} 支球队`,
      );
      return this.teamIndex;
    } catch (error: any) {
      this.logger.error(`加载球队索引失败: ${error.message}`);
      this.teamIndex = new Map();
      return this.teamIndex;
    } finally {
      this.teamIndexLoading = false;
    }
  }

  private async ensureWcTeamIndex(): Promise<Map<string, TeamSearchResult>> {
    if (this.wcTeamIndex && this.wcTeamIndex.size > 0) {
      return this.wcTeamIndex;
    }

    if (this.wcTeamIndexLoading) {
      while (this.wcTeamIndexLoading) {
        await new Promise((r) => setTimeout(r, 500));
      }
      return this.wcTeamIndex!;
    }

    this.wcTeamIndexLoading = true;
    try {
      this.logger.log('开始加载世界杯国家队索引...');
      const wcTeams = await this.footballDataApi.fetchWorldCupTeams();
      this.wcTeamIndex = new Map();

      const nameMap: Record<string, string> = {
        'United States': 'USA',
        'South Korea': 'South Korea',
        Czechia: 'Czech Republic',
        'Bosnia-Herzegovina': 'Bosnia & Herzegovina',
        'Cape Verde Islands': 'Cape Verde',
        'Congo DR': 'DR Congo',
        "Côte d'Ivoire": 'Ivory Coast',
        "Cote d'Ivoire": 'Ivory Coast',
        Curacao: 'Curaçao',
      };

      for (const team of wcTeams) {
        const mappedName = nameMap[team.name] || team.name;
        const keys = [
          team.name?.toLowerCase(),
          team.shortName?.toLowerCase(),
          mappedName?.toLowerCase(),
          team.name?.toLowerCase().replace(/[^a-z]/g, ''),
        ].filter(Boolean);
        for (const key of keys) {
          this.wcTeamIndex.set(key, team);
        }
      }

      this.logger.log(
        `世界杯国家队索引加载完成: ${this.wcTeamIndex.size} 个名称映射，${wcTeams.length} 支球队`,
      );
      return this.wcTeamIndex;
    } catch (error: any) {
      this.logger.error(`加载世界杯国家队索引失败: ${error.message}`);
      this.wcTeamIndex = new Map();
      return this.wcTeamIndex;
    } finally {
      this.wcTeamIndexLoading = false;
    }
  }

  private async findTeamByName(name: string): Promise<TeamSearchResult | null> {
    const wcIndex = await this.ensureWcTeamIndex();

    const nameLower = name.toLowerCase();
    if (wcIndex.has(nameLower)) {
      return wcIndex.get(nameLower)!;
    }

    for (const [key, team] of wcIndex) {
      if (key.includes(nameLower) || nameLower.includes(key)) {
        return team;
      }
    }

    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normName = normalize(name);
    for (const [key, team] of wcIndex) {
      if (normalize(key) === normName) {
        return team;
      }
    }

    const index = await this.ensureTeamIndex();

    if (index.has(nameLower)) {
      return index.get(nameLower)!;
    }

    for (const [key, team] of index) {
      if (key.includes(nameLower) || nameLower.includes(key)) {
        return team;
      }
    }

    const words = nameLower.split(/\s+/);
    if (words.length > 1) {
      for (const word of words) {
        if (word.length < 3) continue;
        for (const [key, team] of index) {
          if (key.includes(word)) {
            return team;
          }
        }
      }
    }

    return null;
  }

  private getNationalTeamData(teamName: string) {
    const directMatch = NATIONAL_TEAMS[teamName];
    if (directMatch) return directMatch;

    const nameLower = teamName.toLowerCase();
    for (const [key, data] of Object.entries(NATIONAL_TEAMS)) {
      if (key.toLowerCase() === nameLower) return data;
    }

    for (const [key, data] of Object.entries(NATIONAL_TEAMS)) {
      if (
        key.toLowerCase().includes(nameLower) ||
        nameLower.includes(key.toLowerCase())
      ) {
        return data;
      }
    }

    return null;
  }

  private async buildSquadFromNationalTeam(
    teamName: string,
    nationalTeamData: {
      crest: string;
      players: Array<{
        name: string;
        position: string;
        dateOfBirth: string;
        nationality: string;
        club: string;
        marketValue?: number;
      }>;
    },
  ): Promise<Squad> {
    const teamRating = await this.getTeamRating(teamName);
    const ratingFactor = teamRating / 1500;

    const playerNames = nationalTeamData.players.map((p) => p.name);
    await this.fetchPlayerPhotos(playerNames);

    const players: Player[] = nationalTeamData.players.map((p, index) => {
      const specificPos = p.position;
      const age = this.calculateAge(p.dateOfBirth);
      const overall = this.estimateOverall(
        specificPos,
        age,
        ratingFactor,
        p.name,
      );

      let marketValue: number;
      if (p.marketValue !== undefined && p.marketValue !== null) {
        marketValue = p.marketValue;
      } else {
        const cachedValue = this.marketValueService.getCachedValue(
          p.name,
          p.club,
        );
        if (cachedValue !== undefined && cachedValue !== null) {
          marketValue = cachedValue;
        } else {
          marketValue = this.estimateMarketValue(specificPos, age, overall);
        }
      }

      const isStar = marketValue >= 10;
      const starLevel: 'super' | 'star' | 'normal' =
        marketValue >= 100 ? 'super' : marketValue >= 10 ? 'star' : 'normal';
      const strengths = this.getStrengths(specificPos, overall);
      const weaknesses = this.getWeaknesses(specificPos, overall);
      const photoUrl = this.getPlayerPhotoUrl(p.name, starLevel);

      return {
        name: p.name,
        position: specificPos,
        number: index + 1,
        overall,
        strengths,
        weaknesses,
        isStar,
        starLevel,
        photoUrl,
        age: age ?? undefined,
        nationality: p.nationality || undefined,
        marketValue,
      };
    });

    const sorted = [...players].sort((a, b) => b.overall - a.overall);
    const combatPower = this.calculateCombatPower(teamName, sorted);

    return {
      teamName,
      players,
      combatPower,
      teamCrest: nationalTeamData.crest,
      isRealData: true,
    } as Squad & { teamCrest: string; isRealData: boolean };
  }

  async getSquad(teamName: string): Promise<Squad> {
    const cached = this.cache.get(teamName);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.data;
    }

    const nationalTeamData = this.getNationalTeamData(teamName);
    if (nationalTeamData) {
      const squad = await this.buildSquadFromNationalTeam(
        teamName,
        nationalTeamData,
      );
      this.cache.set(teamName, { data: squad, ts: Date.now() });
      return squad;
    }

    const dbPlayers = await this.playerRepo.find({
      where: { teamName },
      order: { positionCode: 'ASC', overall: 'DESC' },
    });

    if (dbPlayers.length > 0) {
      const squad = await this.buildSquadFromDb(teamName, dbPlayers);
      this.cache.set(teamName, { data: squad, ts: Date.now() });
      return squad;
    }

    const squad = await this.fetchAndSaveFromApi(teamName);
    this.cache.set(teamName, { data: squad, ts: Date.now() });
    return squad;
  }

  async refreshSquad(teamName: string): Promise<Squad> {
    this.cache.delete(teamName);
    await this.playerRepo.delete({ teamName });
    const squad = await this.fetchAndSaveFromApi(teamName);
    this.cache.set(teamName, { data: squad, ts: Date.now() });
    return squad;
  }

  private async fetchAndSaveFromApi(teamName: string): Promise<Squad> {
    try {
      const teamResult = await this.findTeamByName(teamName);

      if (!teamResult) {
        this.logger.warn(`API未找到球队 ${teamName}，使用生成数据`);
        return generateSquad(teamName);
      }

      const apiSquad = teamResult.squad;

      if (!apiSquad || apiSquad.length === 0) {
        this.logger.warn(`API未返回 ${teamName} 的阵容，使用生成数据`);
        return generateSquad(teamName);
      }

      const teamInfo = {
        id: teamResult.id,
        name: teamResult.name,
        shortName: teamResult.shortName,
        crest: teamResult.crest,
      };

      const teamRating = await this.getTeamRating(teamName);
      const players = await this.transformApiPlayers(apiSquad, teamRating);
      const squad = this.buildSquad(teamName, players, teamInfo);

      await this.savePlayersToDb(teamName, players, teamInfo.id);

      this.logger.log(
        `✅ 从API获取 ${teamName} 真实阵容: ${players.length} 名球员`,
      );
      return squad;
    } catch (error: any) {
      this.logger.error(
        `获取 ${teamName} 真实阵容失败: ${error.message}，使用生成数据`,
      );
      return generateSquad(teamName);
    }
  }

  private async transformApiPlayers(
    apiSquad: Array<{
      id: number;
      name: string;
      position: string;
      dateOfBirth: string;
      nationality: string;
    }>,
    teamRating: number,
  ): Promise<Player[]> {
    const ratingFactor = Math.min(1.15, 0.85 + (teamRating - 1500) / 4000);

    const playerNames = apiSquad.map((p) => p.name);
    await this.fetchPlayerPhotos(playerNames);

    const players: Player[] = apiSquad.map((p) => {
      const posCode = POSITION_MAP[p.position] || 'CM';
      const specificPositions = POSITION_CODE_MAP[posCode] || [posCode];
      const posIndex = p.id % specificPositions.length;
      const specificPos = specificPositions[posIndex];

      const age = this.calculateAge(p.dateOfBirth);
      const overall = this.estimateOverall(
        specificPos,
        age,
        ratingFactor,
        p.name,
      );

      let marketValue: number;
      const cachedValue = this.marketValueService.getCachedValue(p.name, '');
      if (cachedValue !== undefined && cachedValue !== null) {
        marketValue = cachedValue;
      } else {
        marketValue = this.estimateMarketValue(specificPos, age, overall);
      }

      const strengths = this.getStrengths(specificPos, overall);
      const weaknesses = this.getWeaknesses(specificPos, overall);
      const starLevel: 'super' | 'star' | 'normal' =
        marketValue >= 100 ? 'super' : marketValue >= 10 ? 'star' : 'normal';

      return {
        name: p.name,
        position: specificPos,
        number: (p.id % 99) + 1,
        overall,
        strengths,
        weaknesses,
        isStar: marketValue >= 10,
        starLevel,
        photoUrl: this.getPlayerPhotoUrl(p.name, starLevel),
        age: age ?? undefined,
        nationality: p.nationality || undefined,
        marketValue,
      };
    });

    return players;
  }

  private nameHash(name: string): number {
    let h = 0;
    for (let i = 0; i < name.length; i++) {
      h = ((h << 5) - h + name.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  private estimateOverall(
    position: string,
    age: number | null,
    ratingFactor: number,
    playerName: string,
  ): number {
    let base: number;
    switch (position) {
      case 'ST':
      case 'CAM':
      case 'LW':
      case 'RW':
        base = 76;
        break;
      case 'CM':
      case 'CDM':
        base = 74;
        break;
      case 'CB':
      case 'LB':
      case 'RB':
        base = 73;
        break;
      case 'GK':
        base = 74;
        break;
      default:
        base = 73;
    }

    base = base * ratingFactor;

    if (age !== null) {
      if (age >= 24 && age <= 29) {
        base += 3;
      } else if (age >= 30 && age <= 32) {
        base += 1;
      } else if (age < 22) {
        base -= 2;
      } else if (age > 33) {
        base -= 4;
      }
    }

    const h = this.nameHash(playerName);
    const tier = h % 4;
    base -= tier * 3;

    const noise = (h % 11) - 5;
    base += noise * 0.5;

    return Math.max(58, Math.min(94, Math.round(base)));
  }

  private estimateMarketValue(
    position: string,
    age: number | null,
    overall: number,
  ): number {
    let baseValue: number;
    switch (position) {
      case 'ST':
        baseValue = 50;
        break;
      case 'LW':
      case 'RW':
      case 'CAM':
        baseValue = 45;
        break;
      case 'CM':
      case 'CDM':
        baseValue = 30;
        break;
      case 'CB':
        baseValue = 25;
        break;
      case 'LB':
      case 'RB':
        baseValue = 22;
        break;
      case 'GK':
        baseValue = 18;
        break;
      default:
        baseValue = 20;
    }

    const overallFactor = Math.pow((overall - 60) / 30, 2.5);
    baseValue = baseValue * (0.3 + overallFactor * 2.5);

    if (age !== null) {
      if (age <= 21) {
        baseValue *= 1.3;
      } else if (age <= 24) {
        baseValue *= 1.15;
      } else if (age <= 27) {
        baseValue *= 1.0;
      } else if (age <= 29) {
        baseValue *= 0.9;
      } else if (age <= 31) {
        baseValue *= 0.7;
      } else if (age <= 33) {
        baseValue *= 0.45;
      } else {
        baseValue *= 0.2;
      }
    }

    return Math.round(baseValue * 10) / 10;
  }

  private getStrengths(position: string, overall: number): string[] {
    const pool = POSITION_STRENGTHS[position] || [2, 8, 9];
    const count = overall >= 85 ? 3 : overall >= 75 ? 2 : 2;
    const result: string[] = [];
    for (let i = 0; i < count && i < pool.length; i++) {
      result.push(STRENGTH_POOL[pool[i]]);
    }
    if (overall >= 88 && result.length < 4) {
      const extra =
        pool.length > 3 ? pool[3] : (pool[0] + 3) % STRENGTH_POOL.length;
      result.push(STRENGTH_POOL[extra]);
    }
    return result;
  }

  private getWeaknesses(position: string, overall: number): string[] {
    const pool = POSITION_WEAKNESSES[position] || [4, 6];
    const count = overall >= 90 ? 1 : overall >= 82 ? 1 : 2;
    const result: string[] = [];
    for (let i = 0; i < count && i < pool.length; i++) {
      result.push(WEAKNESS_POOL[pool[i]]);
    }
    return result;
  }

  private calculateAge(dateOfBirth: string | null): number | null {
    if (!dateOfBirth) return null;
    try {
      const birth = new Date(dateOfBirth);
      const now = new Date();
      let age = now.getFullYear() - birth.getFullYear();
      const m = now.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) {
        age--;
      }
      return age;
    } catch {
      return null;
    }
  }

  private async getTeamRating(teamName: string): Promise<number> {
    try {
      const rating = await this.eloService.getTeamRating(teamName);
      return rating?.rating || 1500;
    } catch {
      return 1500;
    }
  }

  private buildSquad(
    teamName: string,
    players: Player[],
    teamInfo: { id: number; name: string; shortName: string; crest: string },
  ): Squad {
    const sorted = [...players].sort((a, b) => b.overall - a.overall);
    const combatPower = this.calculateCombatPower(teamName, sorted);
    return {
      teamName,
      players,
      combatPower,
      teamCrest: teamInfo.crest,
      isRealData: true,
    } as Squad & { teamCrest: string; isRealData: boolean };
  }

  private async buildSquadFromDb(
    teamName: string,
    dbPlayers: TeamPlayer[],
  ): Promise<Squad> {
    for (const p of dbPlayers) {
      if (p.photoUrl && !this.playerPhotoCache.has(p.playerName)) {
        this.playerPhotoCache.set(p.playerName, p.photoUrl);
      }
    }

    const needFetch = dbPlayers
      .filter((p) => !p.photoUrl && !this.playerPhotoCache.has(p.playerName))
      .map((p) => p.playerName);
    if (needFetch.length > 0) {
      await this.fetchPlayerPhotos(needFetch);
    }

    const players: Player[] = dbPlayers.map((p) => {
      const starLevel =
        (p.starLevel as 'super' | 'star' | 'normal') || 'normal';
      const cachedPhoto = this.playerPhotoCache.get(p.playerName);
      const photoUrl =
        cachedPhoto ||
        p.photoUrl ||
        this.getPlayerPhotoUrl(p.playerName, starLevel);
      if (cachedPhoto && !p.photoUrl) {
        p.photoUrl = cachedPhoto;
        this.playerRepo.update({ id: p.id }, { photoUrl: cachedPhoto });
      }
      return {
        name: p.playerName,
        position: p.positionCode,
        number: p.jerseyNumber || 0,
        overall: p.overall,
        strengths: p.strengths || [],
        weaknesses: p.weaknesses || [],
        isStar: p.isStar,
        starLevel,
        photoUrl,
        age: p.age ?? undefined,
        nationality: p.nationality ?? undefined,
        marketValue: p.marketValue ?? undefined,
      };
    });

    const sorted = [...players].sort((a, b) => b.overall - a.overall);
    const combatPower = this.calculateCombatPower(teamName, sorted);

    return {
      teamName,
      players,
      combatPower,
      isRealData: dbPlayers[0]?.source === 'api',
    } as Squad & { isRealData: boolean };
  }

  private async savePlayersToDb(
    teamName: string,
    players: Player[],
    teamApiId: number,
  ): Promise<void> {
    await this.playerRepo.delete({ teamName });

    const entities = players.map((p, index) => {
      const entity = new TeamPlayer();
      entity.teamName = teamName;
      entity.playerName = p.name;
      entity.position = POSITION_MAP_INVERSE[p.position] || p.position;
      entity.positionCode = p.position;
      entity.jerseyNumber = index + 1;
      entity.dateOfBirth = null;
      entity.age = p.age || null;
      entity.nationality = p.nationality || null;
      entity.overall = p.overall;
      entity.marketValue = p.marketValue || null;
      entity.isStar = p.isStar;
      entity.starLevel = p.starLevel || 'normal';
      entity.strengths = p.strengths;
      entity.weaknesses = p.weaknesses;
      entity.photoUrl = p.photoUrl || null;
      entity.source = 'api';
      entity.teamApiId = teamApiId;
      entity.playerApiId = null;
      return entity;
    });

    await this.playerRepo.save(entities);
  }

  private async fetchPlayerPhotos(playerNames: string[]): Promise<void> {
    if (this.photoFetchPromise) {
      return this.photoFetchPromise;
    }

    this.photoFetchPromise = (async () => {
      const namesToFetch = playerNames.filter(
        (n) => !this.playerPhotoCache.has(n),
      );
      if (namesToFetch.length === 0) return;

      this.logger.log(
        `开始从 TheSportsDB 获取 ${namesToFetch.length} 名球员头像...`,
      );

      const batchSize = 3;
      for (let i = 0; i < namesToFetch.length; i += batchSize) {
        const batch = namesToFetch.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(async (name) => {
            try {
              const result = await this.searchPlayerPhoto(name);
              if (result) return result;
              const parts = name.trim().split(/\s+/);
              if (parts.length >= 2) {
                const lastName = parts[parts.length - 1];
                if (lastName.length >= 3) {
                  await new Promise((r) => setTimeout(r, 200));
                  return this.searchPlayerPhoto(lastName, name);
                }
              }
              return null;
            } catch {
              return null;
            }
          }),
        );

        for (let j = 0; j < batch.length; j++) {
          const result = results[j];
          if (result.status === 'fulfilled' && result.value) {
            this.playerPhotoCache.set(batch[j], result.value);
          }
        }

        if (i + batchSize < namesToFetch.length) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      this.logger.log(
        `球员头像获取完成: ${this.playerPhotoCache.size}/${playerNames.length} 名球员有头像`,
      );
    })();

    try {
      await this.photoFetchPromise;
    } finally {
      this.photoFetchPromise = null;
    }
  }

  private async searchPlayerPhoto(
    query: string,
    originalName?: string,
  ): Promise<string | null> {
    const url = `https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const players = data?.player;
    if (!Array.isArray(players) || players.length === 0) return null;

    const normalizedName = (originalName || query)
      .toLowerCase()
      .replace(/[^a-z]/g, '');
    const match = players.find(
      (p: any) =>
        p.strPlayer?.toLowerCase().replace(/[^a-z]/g, '') === normalizedName,
    );
    const target = match || players[0];
    return target.strCutout || target.strThumb || null;
  }

  private getPlayerPhotoUrl(
    playerName: string,
    starLevel: 'super' | 'star' | 'normal',
  ): string {
    const cached = this.playerPhotoCache.get(playerName);
    if (cached) return cached;
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(playerName.replace(/\s+/g, '+'))}&background=${starLevel === 'super' ? 'ef4444' : starLevel === 'star' ? 'fbbf24' : '6366f1'}&color=fff&size=80`;
  }

  private calculateCombatPower(
    teamName: string,
    sorted: Player[],
  ): Squad['combatPower'] {
    const ratings = sorted.map((p) => p.overall);
    const rawAvg = ratings.reduce((s, r) => s + r, 0) / ratings.length;

    const weakest = ratings.slice(-5);
    const weakestAvg = weakest.reduce((s, r) => s + r, 0) / weakest.length;
    const barrelGap = rawAvg - weakestAvg;
    const barrelAdjustment = -(barrelGap * 0.08);

    const strongest = ratings.slice(0, 5);
    const strongestAvg =
      strongest.reduce((s, r) => s + r, 0) / strongest.length;
    const diminishingFactor = Math.log(strongestAvg - 70 + 1) / Math.log(20);
    const diminishingAdjustment =
      -(strongestAvg - rawAvg) * 0.04 * diminishingFactor;

    const starPlayers = sorted.filter((p) => p.isStar);
    const starBonus = starPlayers.reduce(
      (s, p) => s + (p.overall - 75) * 0.03,
      0,
    );
    const starAdjustment = Math.max(0, Math.min(3, starBonus));

    const totalMarketValue = sorted.reduce(
      (s, p) => s + (p.marketValue || 0),
      0,
    );

    const finalPower = Math.max(
      50,
      Math.min(
        95,
        rawAvg + barrelAdjustment + diminishingAdjustment + starAdjustment,
      ),
    );

    const analysis = [
      `基础均值: ${rawAvg.toFixed(1)}`,
      `木桶效应: ${barrelAdjustment > 0 ? '+' : ''}${barrelAdjustment.toFixed(1)}（末5人均值 ${weakestAvg.toFixed(1)}，短板拖累明显）`,
      `边际递减: ${diminishingAdjustment > 0 ? '+' : ''}${diminishingAdjustment.toFixed(1)}（前5人均值 ${strongestAvg.toFixed(1)}，优势边际效益递减）`,
      `球星加成: +${starAdjustment.toFixed(1)}（${starPlayers.length}名球星，国际足联推广利好）`,
      `全队身价: €${(totalMarketValue / 100).toFixed(1)}亿`,
      `综合战斗力: ${finalPower.toFixed(1)}`,
    ].join('\n');

    return {
      rawAvg: +rawAvg.toFixed(2),
      barrelAdjustment: +barrelAdjustment.toFixed(2),
      diminishingAdjustment: +diminishingAdjustment.toFixed(2),
      starAdjustment: +starAdjustment.toFixed(2),
      finalPower: +finalPower.toFixed(2),
      analysis,
    };
  }
}

const POSITION_MAP_INVERSE: Record<string, string> = {
  GK: 'Goalkeeper',
  CB: 'Defence',
  LB: 'Defence',
  RB: 'Defence',
  CDM: 'Midfield',
  CM: 'Midfield',
  CAM: 'Midfield',
  LW: 'Offence',
  RW: 'Offence',
  ST: 'Offence',
};
