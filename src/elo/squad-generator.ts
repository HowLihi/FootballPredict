export interface Player {
  name: string;
  position: string;
  number: number;
  overall: number;
  strengths: string[];
  weaknesses: string[];
  isStar: boolean;
  starLevel: 'super' | 'star' | 'normal';
  photoUrl: string;
  age?: number;
  nationality?: string;
  marketValue?: number;
  club?: string;
}

export interface Squad {
  teamName: string;
  players: Player[];
  combatPower: {
    rawAvg: number;
    barrelAdjustment: number;
    diminishingAdjustment: number;
    starAdjustment: number;
    finalPower: number;
    analysis: string;
  };
  teamCrest?: string;
  isRealData?: boolean;
}

const POSITIONS = [
  'GK',
  'CB',
  'CB',
  'LB',
  'RB',
  'CDM',
  'CM',
  'CM',
  'LW',
  'RW',
  'ST',
  'GK',
  'CB',
  'LB',
  'RB',
  'CDM',
  'CM',
  'CAM',
  'LW',
  'RW',
  'ST',
  'GK',
  'CB',
  'LB',
  'RB',
  'CM',
  'ST',
];

const FIRST_NAMES: Record<string, string[]> = {
  default: [
    'Lucas',
    'Marco',
    'David',
    'Carlos',
    'Andre',
    'Miguel',
    'Juan',
    'Luis',
    'Antonio',
    'Jose',
    'Alex',
    'Daniel',
    'Thomas',
    'Hans',
    'Pedro',
    'Felipe',
    'Oscar',
    'Rafael',
    'Bruno',
    'Eduardo',
    'Gabriel',
    'Victor',
    'James',
    'William',
    'George',
    'Henry',
  ],
};

const LAST_NAMES: Record<string, string[]> = {
  default: [
    'Silva',
    'Santos',
    'Martinez',
    'Garcia',
    'Lopez',
    'Rodriguez',
    'Fernandez',
    'Perez',
    'Gonzalez',
    'Cruz',
    'Torres',
    'Costa',
    'Alves',
    'Mendes',
    'Nunes',
    'Oliveira',
    'Pereira',
    'Souza',
    'Lima',
    'Ferreira',
    'Carvalho',
    'Ribeiro',
    'Cardoso',
    'Marques',
    'Neves',
    'Vieira',
  ],
};

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.floor(seededRandom(seed) * arr.length)];
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

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

export function generateSquad(teamName: string): Squad {
  const baseSeed = teamName.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  const players: Player[] = [];

  for (let i = 0; i < 26; i++) {
    const seed = baseSeed + i * 100;
    const pos = POSITIONS[i % POSITIONS.length];
    const firstName = pick(FIRST_NAMES.default, seed + 1);
    const lastName = pick(LAST_NAMES.default, seed + 2);

    const baseRating =
      pos === 'GK'
        ? 70 + seededRandom(seed + 3) * 18
        : pos === 'ST' || pos === 'CAM' || pos === 'LW' || pos === 'RW'
          ? 72 + seededRandom(seed + 3) * 18
          : 70 + seededRandom(seed + 3) * 16;

    const overall = clamp(Math.round(baseRating), 65, 92);

    const numStrengths = 2 + Math.floor(seededRandom(seed + 4) * 2);
    const strengths: string[] = [];
    const usedS = new Set<number>();
    for (let j = 0; j < numStrengths; j++) {
      const idx = Math.floor(
        seededRandom(seed + 10 + j) * STRENGTH_POOL.length,
      );
      if (!usedS.has(idx)) {
        strengths.push(STRENGTH_POOL[idx]);
        usedS.add(idx);
      }
    }

    const numWeaknesses = 1 + Math.floor(seededRandom(seed + 5) * 2);
    const weaknesses: string[] = [];
    const usedW = new Set<number>();
    for (let j = 0; j < numWeaknesses; j++) {
      const idx = Math.floor(
        seededRandom(seed + 20 + j) * WEAKNESS_POOL.length,
      );
      if (!usedW.has(idx)) {
        weaknesses.push(WEAKNESS_POOL[idx]);
        usedW.add(idx);
      }
    }

    const isStar = i < 3;
    const starLevel: 'super' | 'star' | 'normal' = isStar ? 'star' : 'normal';
    const age = 22 + Math.floor(seededRandom(seed + 6) * 14);
    const ageFactor =
      age >= 24 && age <= 29 ? 1.0 : age >= 30 ? 0.7 : age >= 22 ? 0.85 : 0.6;
    const posBase =
      pos === 'ST' || pos === 'CAM' || pos === 'LW' || pos === 'RW'
        ? 45
        : pos === 'CM' || pos === 'CDM'
          ? 30
          : pos === 'GK'
            ? 18
            : 25;
    const marketValue =
      Math.round(
        posBase * ageFactor * Math.pow((overall - 60) / 30, 2.5) * 2.8 * 10,
      ) / 10;
    const photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName)}+${encodeURIComponent(lastName)}&background=${isStar ? 'fbbf24' : '6366f1'}&color=fff&size=80`;

    players.push({
      name: `${firstName} ${lastName}`,
      position: pos,
      number: i + 1,
      overall,
      strengths,
      weaknesses,
      isStar,
      starLevel,
      photoUrl,
      age,
      marketValue,
    });
  }

  const sorted = [...players].sort((a, b) => b.overall - a.overall);
  const combatPower = calculateCombatPower(teamName, sorted);

  return { teamName, players, combatPower, isRealData: false };
}

function calculateCombatPower(
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
  const strongestAvg = strongest.reduce((s, r) => s + r, 0) / strongest.length;
  const diminishingFactor = Math.log(strongestAvg - 70 + 1) / Math.log(20);
  const diminishingAdjustment =
    -(strongestAvg - rawAvg) * 0.04 * diminishingFactor;

  const starPlayers = sorted.filter((p) => p.isStar);
  const starBonus = starPlayers.reduce(
    (s, p) => s + (p.overall - 75) * 0.03,
    0,
  );
  const starAdjustment = clamp(starBonus, 0, 3);

  const totalMarketValue = sorted.reduce((s, p) => s + (p.marketValue || 0), 0);

  const finalPower = clamp(
    rawAvg + barrelAdjustment + diminishingAdjustment + starAdjustment,
    50,
    95,
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
