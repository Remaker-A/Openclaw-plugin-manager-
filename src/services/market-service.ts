/**
 * 市场服务 - 处理插件市场 API 对接和本地缓存
 */

import fs from 'fs-extra';
import * as path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { logger } from '../utils/logger.js';
import { MarketPlugin, PluginSource } from '../types.js';
import { extractSkillName } from '../utils/skill-parser.js';

// ES 模块中获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 缓存数据结构
interface CacheData {
  plugins: MarketPlugin[];
  cachedAt: number;
  expiresAt: number;
}

// API 响应结构
interface ApiResponse {
  success: boolean;
  data?: MarketPlugin[];
  error?: string;
}

export class MarketService {
  private apiUrl: string;
  private cachePath: string;
  private localDataPath: string;
  private cacheDuration: number = 24 * 60 * 60 * 1000; // 24小时

  constructor(apiUrl?: string, localDataPath?: string) {
    // 默认市场 API 地址
    this.apiUrl = apiUrl || process.env.OPENCLAW_MARKET_URL || 'https://market.openclaw.dev/api/v1';
    // 缓存路径
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    this.cachePath = path.join(homeDir, '.openclaw', 'cache', 'market_cache.json');
    // 本地数据文件路径
    this.localDataPath = localDataPath || path.join(__dirname, '../../data/market_plugins.json');
  }

  /**
   * 获取所有插件列表
   * 优先级: 本地数据文件 > API > 缓存
   */
  async getPlugins(forceRefresh: boolean = false): Promise<MarketPlugin[]> {
    // 1. 首先尝试从本地数据文件读取
    const localPlugins = await this.loadFromLocalFile();
    if (localPlugins && localPlugins.length > 0) {
      return localPlugins;
    }

    // 2. 尝试从缓存读取
    if (!forceRefresh) {
      const cached = await this.loadFromCache();
      if (cached) {
        return cached;
      }
    }

    // 3. 从 API 获取
    try {
      const plugins = await this.fetchFromApi('/plugins');
      await this.saveToCache(plugins);
      return plugins;
    } catch (error) {
      // API 失败时尝试使用过期缓存
      const expiredCache = await this.loadFromCache(true);
      if (expiredCache) {
        logger.market.warn('使用过期缓存数据，市场 API 不可用');
        return expiredCache;
      }
      throw new Error(`[MarketService] 无法获取插件列表: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 从本地数据文件加载插件列表
   */
  private async loadFromLocalFile(): Promise<MarketPlugin[] | null> {
    try {
      if (await fs.pathExists(this.localDataPath)) {
        const data = await fs.readJson(this.localDataPath);
        if (data.plugins && Array.isArray(data.plugins)) {
          return data.plugins;
        }
      }
      return null;
    } catch (error) {
      logger.market.warn(`读取本地市场数据失败: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * 搜索插件
   * 支持技能路径格式的搜索
   */
  async searchPlugins(keyword: string, forceRefresh: boolean = false): Promise<MarketPlugin[]> {
    const plugins = await this.getPlugins(forceRefresh);
    const lowerKeyword = keyword.toLowerCase();

    return plugins.filter(plugin =>
      plugin.name.toLowerCase().includes(lowerKeyword) ||
      plugin.description.toLowerCase().includes(lowerKeyword) ||
      plugin.skills.some(skill => {
        // 支持技能路径格式搜索
        const skillBaseName = extractSkillName(skill);
        return skill.toLowerCase().includes(lowerKeyword) ||
               skillBaseName.toLowerCase().includes(lowerKeyword);
      }) ||
      plugin.tags?.some(tag => tag.toLowerCase().includes(lowerKeyword))
    );
  }

  /**
   * 根据 ID 获取插件详情
   */
  async getPluginById(pluginId: string, forceRefresh: boolean = false): Promise<MarketPlugin | null> {
    const plugins = await this.getPlugins(forceRefresh);
    return plugins.find(p => p.id === pluginId) || null;
  }

  /**
   * 根据技能查找插件
   * 支持两种格式匹配:
   * 1. 官方格式: "skills/xiaohongshu_search"
   * 2. 简化格式: "xiaohongshu_search"
   */
  async findPluginBySkill(skillName: string, forceRefresh: boolean = false): Promise<MarketPlugin | null> {
    const plugins = await this.getPlugins(forceRefresh);
    const lowerSkill = skillName.toLowerCase();

    return plugins.find(plugin => {
      return plugin.skills.some(skill => {
        const lowerSkillPath = skill.toLowerCase();
        // 精确匹配
        if (lowerSkillPath === lowerSkill) return true;
        // 官方路径格式匹配: skills/xiaohongshu_search 匹配 xiaohongshu_search
        if (lowerSkillPath === `skills/${lowerSkill}`) return true;
        // 提取技能名称匹配
        const skillBaseName = skill.split('/').pop()?.toLowerCase();
        if (skillBaseName === lowerSkill) return true;
        return false;
      });
    }) || null;
  }

  /**
   * 从 API 获取数据
   */
  private async fetchFromApi(endpoint: string): Promise<MarketPlugin[]> {
    const url = `${this.apiUrl}${endpoint}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'OpenClaw-PluginManager/1.0'
      },
      timeout: 30000
    });

    if (!response.ok) {
      throw new Error(`[MarketService] API 请求失败: ${response.status} ${response.statusText}`);
    }

    const result: ApiResponse = await response.json();

    if (!result.success || !result.data) {
      throw new Error(`[MarketService] ${result.error || 'API 返回数据格式错误'}`);
    }

    return result.data;
  }

  /**
   * 从缓存加载
   */
  private async loadFromCache(includeExpired: boolean = false): Promise<MarketPlugin[] | null> {
    try {
      if (!(await fs.pathExists(this.cachePath))) {
        return null;
      }

      const cacheData: CacheData = await fs.readJson(this.cachePath);

      // 检查是否过期
      if (!includeExpired && Date.now() > cacheData.expiresAt) {
        return null;
      }

      return cacheData.plugins;
    } catch (error) {
      logger.market.warn(`读取缓存失败: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * 保存到缓存
   */
  private async saveToCache(plugins: MarketPlugin[]): Promise<void> {
    const cacheData: CacheData = {
      plugins,
      cachedAt: Date.now(),
      expiresAt: Date.now() + this.cacheDuration
    };

    await fs.ensureDir(path.dirname(this.cachePath));
    await fs.writeJson(this.cachePath, cacheData, { spaces: 2 });
  }

  /**
   * 清除缓存
   */
  async clearCache(): Promise<void> {
    if (await fs.pathExists(this.cachePath)) {
      await fs.remove(this.cachePath);
    }
  }
}

// 重新导出类型，保持向后兼容
export type { MarketPlugin, PluginSource } from '../types.js';
