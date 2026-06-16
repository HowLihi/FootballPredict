import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

export interface PlayerMarketValueResult {
  name: string;
  club: string;
  marketValue: number | null;
  source: string;
  error?: string;
}

@Injectable()
export class PlayerMarketValueService {
  private readonly logger = new Logger(PlayerMarketValueService.name);
  private readonly cachePath: string;
  private cache: Map<string, number | null> = new Map();
  private readonly requestDelay = 2500;

  constructor() {
    this.cachePath = path.join(
      process.cwd(),
      'data',
      'market-value-cache.json',
    );
    this.loadCache();
  }

  private loadCache(): void {
    try {
      if (fs.existsSync(this.cachePath)) {
        const raw = fs.readFileSync(this.cachePath, 'utf-8');
        const data = JSON.parse(raw);
        for (const [key, value] of Object.entries(data)) {
          this.cache.set(key, value as number | null);
        }
        this.logger.log(`已加载 ${this.cache.size} 条身价缓存记录`);
      }
    } catch (error: any) {
      this.logger.warn(`加载缓存失败: ${error.message}`);
    }
  }

  private saveCache(): void {
    this.logger.log(
      `💾 saveCache() 被调用, 当前缓存条目数: ${this.cache.size}, 调用栈: ${new Error().stack?.split('\n')[2]?.trim()}`,
    );
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 先读取现有缓存文件，避免覆盖已有的非空值
      const existingData: Record<string, number | null> = {};
      if (fs.existsSync(this.cachePath)) {
        try {
          const raw = fs.readFileSync(this.cachePath, 'utf-8');
          const parsed = JSON.parse(raw);
          for (const [key, value] of Object.entries(parsed)) {
            existingData[key] = value as number | null;
          }
        } catch {}
      }

      // 合并内存缓存和现有文件：优先保留非空值
      const data: Record<string, number | null> = { ...existingData };
      for (const [key, value] of this.cache.entries()) {
        // 只有当前值非空，或者文件中没有该键时才写入
        if (value !== null && value !== undefined) {
          data[key] = value;
        } else if (!(key in existingData)) {
          data[key] = value;
        }
        // 如果当前值为 null 且文件中已有非空值，保留文件中的值
      }

      fs.writeFileSync(this.cachePath, JSON.stringify(data, null, 2));
    } catch (error: any) {
      this.logger.error(`保存缓存失败: ${error.message}`);
    }
  }

  private getCacheKey(name: string, club: string): string {
    return `${name.toLowerCase().trim()}|${club.toLowerCase().trim()}`;
  }

  getCachedValue(name: string, club: string): number | null | undefined {
    const key = this.getCacheKey(name, club);
    return this.cache.get(key);
  }

  async fetchMarketValue(
    name: string,
    club: string,
  ): Promise<PlayerMarketValueResult> {
    const cacheKey = this.getCacheKey(name, club);

    if (this.cache.has(cacheKey)) {
      return {
        name,
        club,
        marketValue: this.cache.get(cacheKey) ?? null,
        source: 'cache',
      };
    }

    try {
      const result = await this.scrapeTransfermarkt(name, club);
      this.cache.set(cacheKey, result.marketValue);

      return result;
    } catch (error: any) {
      this.logger.warn(`获取 ${name}(${club}) 身价失败: ${error.message}`);
      return {
        name,
        club,
        marketValue: null,
        source: 'error',
        error: error.message,
      };
    }
  }

  async fetchMarketValues(
    players: Array<{ name: string; club: string }>,
  ): Promise<PlayerMarketValueResult[]> {
    const results: PlayerMarketValueResult[] = [];

    for (let i = 0; i < players.length; i++) {
      const { name, club } = players[i];
      this.logger.log(
        `[${i + 1}/${players.length}] 获取 ${name} (${club}) 的身价...`,
      );

      const result = await this.fetchMarketValue(name, club);
      results.push(result);

      if (i < players.length - 1 && result.source !== 'cache') {
        await this.delay(this.requestDelay);
      }
    }

    const successCount = results.filter((r) => r.marketValue !== null).length;
    this.logger.log(
      `完成! 成功获取 ${successCount}/${results.length} 名球员身价`,
    );

    return results;
  }

  private async scrapeTransfermarkt(
    name: string,
    club: string,
  ): Promise<PlayerMarketValueResult> {
    const searchQuery = encodeURIComponent(name);
    const searchUrl = `https://www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche?query=${searchQuery}`;

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

    // 从搜索结果中提取球员链接和身价
    const playerLinkMatch = this.extractPlayerLink(html, name, club);

    if (!playerLinkMatch) {
      // 尝试直接从搜索结果提取身价（某些球员在搜索结果就显示身价）
      const directValue = this.extractMarketValueFromHtml(html);
      if (directValue !== null) {
        return {
          name,
          club,
          marketValue: directValue,
          source: 'transfermarkt_search',
        };
      }
      return {
        name,
        club,
        marketValue: null,
        source: 'transfermarkt',
        error: '未在搜索结果中找到球员',
      };
    }

    // 进入球员详情页获取身价
    await this.delay(1500);
    const detailResponse = await axios.get(playerLinkMatch, {
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
    const marketValue = this.extractMarketValueFromHtml(detailHtml);

    return {
      name,
      club,
      marketValue,
      source: marketValue !== null ? 'transfermarkt_detail' : 'transfermarkt',
    };
  }

  private extractPlayerLink(
    html: string,
    playerName: string,
    clubName: string,
  ): string | null {
    // 匹配 transfermarkt 搜索结果中的球员行
    // 格式类似: <a href="/player-name/profil/spieler/12345">Player Name</a>
    const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    const rows = html.match(rowRegex) || [];

    const nameLower = playerName.toLowerCase();

    for (const row of rows) {
      const rowLower = row.toLowerCase();
      if (!rowLower.includes(nameLower)) continue;

      // 检查是否包含俱乐部名（提高匹配精度）
      if (clubName && !rowLower.includes(clubName.toLowerCase())) continue;

      // 提取球员链接
      const linkMatch = row.match(/href="(\/[^"]+\/profil\/spieler\/\d+)"/i);
      if (linkMatch) {
        return `https://www.transfermarkt.com${linkMatch[1]}`;
      }
    }

    return null;
  }

  private extractMarketValueFromHtml(html: string): number | null {
    // Transfermarkt 身价格式: €50.00m, €1.50m, €500Th., 等
    // 在 HTML 中通常以 "market-value" 类名或特定文本出现

    // 尝试多种匹配模式
    const patterns = [
      // 模式1: data-market-value 属性
      /data-market-value(?:-in-euro)?"?\s*=\s*"(\d[\d.]*)"/i,
      // 模式2: €XX.XXm 格式
      /€\s*(\d+\.?\d*)\s*m/i,
      // 模式3: €XX.XM 格式
      /€\s*(\d+\.?\d*)\s*M/i,
      // 模式4: market-value 类中的文本
      /class="[^"]*market-value[^"]*"[^>]*>[\s\S]*?€\s*(\d+\.?\d*)\s*m/i,
      // 模式5: 纯文本中的 €XX.XXm
      />\s*€\s*(\d+\.?\d*)\s*m\s*</i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        const value = parseFloat(match[1]);
        if (!isNaN(value) && value > 0) {
          // Transfermarkt 单位是百万欧元，转换为我们的内部单位（百万欧元）
          return Math.round(value * 100) / 100;
        }
      }
    }

    // 尝试匹配千欧元格式: €500Th.
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

  // 备用方案：通过第三方免费 API 获取身价
  async fetchMarketValueViaApi(name: string): Promise<PlayerMarketValueResult> {
    // TODO: 如果有可用的免费 API，在这里实现
    // 例如 API-Football (RapidAPI) 的 players 端点
    return {
      name,
      club: '',
      marketValue: null,
      source: 'api_unavailable',
      error: '未配置第三方API',
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 获取所有已缓存的身价值
  getAllCachedValues(): Record<string, number | null> {
    const data: Record<string, number | null> = {};
    for (const [key, value] of this.cache.entries()) {
      data[key] = value;
    }
    return data;
  }

  // 清空缓存
  clearCache(): void {
    this.cache.clear();
    this.saveCache();
    this.logger.log('身价缓存已清空');
  }
}
