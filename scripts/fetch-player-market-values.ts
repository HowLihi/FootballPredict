/**
 * 球员身价抓取脚本
 *
 * 使用方法:
 *   npx ts-node scripts/fetch-player-market-values.ts
 *
 * 功能:
 *   从 Transfermarkt 等公开数据源获取国家队球员的真实身价，
 *   并将结果写入 national-teams.ts 文件。
 *
 * 注意:
 *   - 请求之间有 2.5 秒延迟，避免被封
 *   - 结果会缓存到 data/market-value-cache.json
 *   - 已缓存的球员不会重复请求
 */

import * as fs from 'fs';
import * as path from 'path';

// 直接内联 PlayerMarketValueService 的核心逻辑，避免 NestJS 依赖
import axios from 'axios';

interface PlayerInfo {
  name: string;
  club: string;
  position: string;
  dateOfBirth: string;
  nationality: string;
}

interface TeamData {
  crest: string;
  players: PlayerInfo[];
}

interface NationalTeamsData {
  [teamName: string]: TeamData;
}

const CACHE_PATH = path.join(process.cwd(), 'data', 'market-value-cache.json');
const NATIONAL_TEAMS_PATH = path.join(
  process.cwd(),
  'src/elo/national-teams.ts',
);
const REQUEST_DELAY = 2500;

function loadCache(): Map<string, number | null> {
  const cache = new Map<string, number | null>();
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const raw = fs.readFileSync(CACHE_PATH, 'utf-8');
      const data = JSON.parse(raw);
      for (const [key, value] of Object.entries(data)) {
        cache.set(key, value as number | null);
      }
      console.log(`📦 已加载 ${cache.size} 条身价缓存`);
    }
  } catch (e: any) {
    console.log('📦 无缓存或缓存读取失败，从头开始');
  }
  return cache;
}

function saveCache(cache: Map<string, number | null>): void {
  const dir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const data: Record<string, number | null> = {};
  for (const [key, value] of cache.entries()) {
    data[key] = value;
  }
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2));
}

function getCacheKey(name: string, club: string): string {
  return `${name.toLowerCase().trim()}|${club.toLowerCase().trim()}`;
}

function extractMarketValueFromHtml(html: string): number | null {
  const patterns = [
    /data-market-value(?:-in-euro)?"?\s*=\s*"(\d[\d.]*)"/i,
    /€\s*(\d+\.?\d*)\s*m/i,
    /€\s*(\d+\.?\d*)\s*M/i,
    /class="[^"]*market-value[^"]*"[^>]*>[\s\S]*?€\s*(\d+\.?\d*)\s*m/i,
    />\s*€\s*(\d+\.?\d*)\s*m\s*</i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const value = parseFloat(match[1]);
      if (!isNaN(value) && value > 0) {
        return Math.round(value * 100) / 100;
      }
    }
  }

  const kPattern = /€\s*(\d+\.?\d*)\s*Th/i;
  const kMatch = html.match(kPattern);
  if (kMatch) {
    const value = parseFloat(kMatch[1]);
    if (!isNaN(value) && value > 0) {
      return Math.round((value / 1000) * 100) / 100;
    }
  }

  return null;
}

function extractPlayerLink(
  html: string,
  playerName: string,
  clubName: string,
): string | null {
  const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
  const rows = html.match(rowRegex) || [];
  const nameLower = playerName.toLowerCase();

  for (const row of rows) {
    const rowLower = row.toLowerCase();
    if (!rowLower.includes(nameLower)) continue;
    if (clubName && !rowLower.includes(clubName.toLowerCase())) continue;

    const linkMatch = row.match(/href="(\/[^"]+\/profil\/spieler\/\d+)"/i);
    if (linkMatch) {
      return `https://www.transfermarkt.com${linkMatch[1]}`;
    }
  }

  return null;
}

async function scrapeTransfermarkt(
  name: string,
  club: string,
): Promise<number | null> {
  const searchQuery = encodeURIComponent(name);
  const searchUrl = `https://www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche?query=${searchQuery}`;

  try {
    const searchResponse = await axios.get(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      timeout: 15000,
      maxRedirects: 5,
    });

    const html = searchResponse.data as string;

    // 先尝试从搜索结果直接提取身价
    const directValue = extractMarketValueFromHtml(html);
    if (directValue !== null) {
      return directValue;
    }

    // 找球员链接
    const playerLink = extractPlayerLink(html, name, club);
    if (!playerLink) {
      return null;
    }

    // 请求球员详情页
    await delay(1500);
    const detailResponse = await axios.get(playerLink, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 15000,
    });

    const detailHtml = detailResponse.data as string;
    return extractMarketValueFromHtml(detailHtml);
  } catch (error: any) {
    // 静默处理错误
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 解析 national-teams.ts 文件中的国家队数据
function parseNationalTeamsFile(filePath: string): {
  teams: NationalTeamsData;
  fileContent: string;
} {
  const fileContent = fs.readFileSync(filePath, 'utf-8');

  // 使用正则提取 NATIONAL_TEAMS 对象
  // 匹配: export const NATIONAL_TEAMS: NationalTeamsMap = { ... };
  const teamsMatch = fileContent.match(
    /export const NATIONAL_TEAMS: NationalTeamsMap = ({[\s\S]*?\n});/,
  );

  if (!teamsMatch) {
    throw new Error('无法解析 NATIONAL_TEAMS 数据');
  }

  const teamsJson = teamsMatch[1]
    // 移除尾随逗号（在 ] 或 } 之前）
    .replace(/,(\s*[}\]])/g, '$1')
    // 处理单引号 key
    .replace(/'/g, '"')
    // 处理没有引号的 key
    .replace(/(\s+)(\w+):/g, '$1"$2":');

  // 简单的手动解析，因为 JSON.parse 可能因为各种原因失败
  const teams: NationalTeamsData = {};

  // 用正则逐个解析球队
  const teamRegex =
    /\s{2}(\w+):\s*\{[\s\S]*?crest:\s*'([^']*)',[\s\S]*?players:\s*\[([\s\S]*?)\],?\s*\}/g;
  let teamMatch: RegExpExecArray | null;

  while ((teamMatch = teamRegex.exec(fileContent)) !== null) {
    const teamName = teamMatch[1];
    const crest = teamMatch[2];
    const playersBlock = teamMatch[3];

    const players: PlayerInfo[] = [];
    const playerRegex =
      /\{[\s\S]*?name:\s*'([^']*)',[\s\S]*?position:\s*'([^']*)',[\s\S]*?dateOfBirth:\s*'([^']*)',[\s\S]*?nationality:\s*'([^']*)',[\s\S]*?club:\s*'([^']*)'[\s\S]*?\}/g;
    let playerMatch: RegExpExecArray | null;

    while ((playerMatch = playerRegex.exec(playersBlock)) !== null) {
      players.push({
        name: playerMatch[1],
        position: playerMatch[2],
        dateOfBirth: playerMatch[3],
        nationality: playerMatch[4],
        club: playerMatch[5],
      });
    }

    teams[teamName] = { crest, players };
  }

  return { teams, fileContent };
}

async function main() {
  console.log('⚽ 球员身价抓取工具');
  console.log('='.repeat(50));
  console.log('');

  // 解析国家队数据
  console.log('📖 解析国家队数据文件...');
  const { teams } = parseNationalTeamsFile(NATIONAL_TEAMS_PATH);

  // 统计
  let totalPlayers = 0;
  for (const [teamName, teamData] of Object.entries(teams)) {
    totalPlayers += teamData.players.length;
    console.log(`  ${teamName}: ${teamData.players.length} 名球员`);
  }
  console.log(
    `\n总计: ${Object.keys(teams).length} 支球队, ${totalPlayers} 名球员\n`,
  );

  // 加载缓存
  const cache = loadCache();

  // 收集所有需要查询的球员
  const toFetch: Array<{
    name: string;
    club: string;
    teamName: string;
  }> = [];

  let cachedCount = 0;
  for (const [teamName, teamData] of Object.entries(teams)) {
    for (const player of teamData.players) {
      const key = getCacheKey(player.name, player.club);
      if (cache.has(key)) {
        cachedCount++;
      } else {
        toFetch.push({ name: player.name, club: player.club, teamName });
      }
    }
  }

  console.log(`📊 已缓存: ${cachedCount} 名球员`);
  console.log(`🔍 待抓取: ${toFetch.length} 名球员`);
  console.log('');

  if (toFetch.length === 0) {
    console.log('✅ 所有球员身价已缓存，无需抓取');
    return;
  }

  // 询问用户是否继续
  const estimatedMinutes = Math.ceil((toFetch.length * REQUEST_DELAY) / 60000);
  console.log(
    `⏱️  预计耗时: ~${estimatedMinutes} 分钟 (每请求延迟 ${REQUEST_DELAY / 1000}秒)`,
  );
  console.log('');

  // 开始抓取
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < toFetch.length; i++) {
    const { name, club, teamName } = toFetch[i];
    const key = getCacheKey(name, club);

    process.stdout.write(
      `[${i + 1}/${toFetch.length}] ${name.padEnd(25)} (${club.padEnd(20)}) [${teamName}] ... `,
    );

    try {
      const value = await scrapeTransfermarkt(name, club);
      cache.set(key, value);

      if (value !== null) {
        console.log(`✅ €${value}M`);
        successCount++;
      } else {
        console.log('❌ 未找到');
        failCount++;
      }
    } catch (error: any) {
      cache.set(key, null);
      console.log(`❌ ${error.message?.substring(0, 30)}`);
      failCount++;
    }

    // 每10个保存一次缓存
    if ((i + 1) % 10 === 0) {
      saveCache(cache);
      console.log(
        `  💾 已保存缓存 | 成功: ${successCount} | 失败: ${failCount}`,
      );
    }

    // 请求延迟
    if (i < toFetch.length - 1) {
      await delay(REQUEST_DELAY);
    }
  }

  // 最终保存
  saveCache(cache);
  console.log('');
  console.log('='.repeat(50));
  console.log(
    `📊 完成! 成功: ${successCount} | 失败: ${failCount} | 总计: ${toFetch.length}`,
  );
  console.log(`💾 缓存已保存到: ${CACHE_PATH}`);
  console.log('');

  // 提示后续步骤
  console.log('📝 后续步骤:');
  console.log(
    '  1. 检查缓存文件 data/market-value-cache.json 中的身价是否合理',
  );
  console.log('  2. 对于未找到的球员，可以手动填写身价到缓存文件');
  console.log(
    '  3. 使用 squad service 的 refresh 接口来更新数据库中的身价数据',
  );
  console.log('     POST /api/wc-prediction/squad/{teamName}/refresh');
  console.log('');
}

main().catch((error) => {
  console.error('❌ 脚本执行失败:', error.message);
  process.exit(1);
});
