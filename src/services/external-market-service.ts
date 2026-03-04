/**
 * 外部市场服务 - 从 npm、GitHub、MCP Marketplace 搜索插件
 *
 * 功能:
 * 1. 多源搜索 (npm, GitHub, MCP Marketplace)
 * 2. 搜索结果缓存
 * 3. 插件详情获取
 * 4. 速率限制处理
 */

import fetch from 'node-fetch';
import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';
import { ExternalPlugin } from '../types.js';

// npm 搜索结果
interface NpmSearchResult {
  objects: Array<{
    package: {
      name: string;
      version: string;
      description: string;
      author?: { name: string };
      keywords?: string[];
      links: { npm: string; repository?: string };
    };
  }>;
}

// GitHub 搜索结果
interface GitHubSearchResult {
  items: Array<{
    full_name: string;
    name: string;
    description: string;
    html_url: string;
    stargazers_count: number;
    topics?: string[];
  }>;
}

// MCP Marketplace 结果
interface MCPMarketplacePlugin {
  name: string;
  description: string;
  repository: string;
  author?: string;
  tags?: string[];
}

// 缓存数据结构
interface CacheData {
  keyword: string;
  source: string;
  results: ExternalPlugin[];
  cachedAt: number;
  expiresAt: number;
}

// 速率限制状态
interface RateLimitState {
  githubRemaining: number;
  githubResetAt: number;
}

export class ExternalMarketService {
  private npmRegistry: string = 'https://registry.npmjs.org';
  private npmSearchApi: string = 'https://registry.npmjs.org/-/v1/search';
  private githubApi: string = 'https://api.github.com';
  private mcpMarketplaceUrl: string = 'https://mcpservers.org';

  // 缓存配置
  private cacheDir: string;
  private cacheDuration: number = 60 * 60 * 1000; // 1小时
  private rateLimitState: RateLimitState = {
    githubRemaining: 60,
    githubResetAt: 0
  };

  // 请求配置
  private requestTimeout: number = 15000; // 15秒超时
  private maxRetries: number = 2;

  constructor() {
    const homeDir = os.homedir();
    this.cacheDir = path.join(homeDir, '.openclaw', 'cache', 'external_market');
  }

  /**
   * 搜索 npm 包
   */
  async searchNpm(keyword: string, limit: number = 20, useCache: boolean = true): Promise<ExternalPlugin[]> {
    // 检查缓存
    if (useCache) {
      const cached = await this.loadFromCache(keyword, 'npm');
      if (cached) {
        return cached;
      }
    }

    try {
      // 搜索 OpenClaw 相关包
      const openclawUrl = `${this.npmSearchApi}?text=${encodeURIComponent(`${keyword} openclaw`)}&size=${limit}`;
      const mcpUrl = `${this.npmSearchApi}?text=${encodeURIComponent(`${keyword} mcp mcp-server`)}&size=${limit}`;

      const [openclawResult, mcpResult] = await Promise.all([
        this.fetchJson<NpmSearchResult>(openclawUrl),
        this.fetchJson<NpmSearchResult>(mcpUrl)
      ]);

      const plugins: ExternalPlugin[] = [];
      const seen = new Set<string>();

      // 处理 OpenClaw 包
      for (const item of openclawResult?.objects || []) {
        const pkg = item.package;
        if (seen.has(pkg.name)) continue;
        seen.add(pkg.name);

        plugins.push(this.npmToPlugin(pkg, 'openclaw'));
      }

      // 处理 MCP 包
      for (const item of mcpResult?.objects || []) {
        const pkg = item.package;
        if (seen.has(pkg.name)) continue;
        seen.add(pkg.name);

        plugins.push(this.npmToPlugin(pkg, 'mcp'));
      }

      // 保存缓存
      await this.saveToCache(keyword, 'npm', plugins);

      return plugins;
    } catch (error) {
      logger.externalMarket.warn(`npm 搜索失败: ${error instanceof Error ? error.message : String(error)}`);
      // 尝试使用过期缓存
      const expiredCache = await this.loadFromCache(keyword, 'npm', true);
      return expiredCache || [];
    }
  }

  /**
   * 搜索 GitHub 仓库
   */
  async searchGitHub(keyword: string, limit: number = 20, useCache: boolean = true): Promise<ExternalPlugin[]> {
    // 检查缓存
    if (useCache) {
      const cached = await this.loadFromCache(keyword, 'github');
      if (cached) {
        return cached;
      }
    }

    // 检查速率限制
    if (!this.canCallGithub()) {
      logger.externalMarket.warn('GitHub API 速率限制，使用缓存');
      const expiredCache = await this.loadFromCache(keyword, 'github', true);
      return expiredCache || [];
    }

    try {
      // 搜索 OpenClaw 插件和 MCP 服务器
      const queries = [
        `${keyword} openclaw-plugin`,
        `${keyword} mcp-server`,
        `${keyword} modelcontextprotocol`
      ];

      const plugins: ExternalPlugin[] = [];
      const seen = new Set<string>();

      // 顺序执行搜索，避免触发 GitHub 的并发限制
      for (const q of queries) {
        if (plugins.length >= limit) break;

        const url = `${this.githubApi}/search/repositories?q=${encodeURIComponent(q)}&per_page=${Math.ceil(limit / queries.length)}&sort=stars`;
        const result = await this.fetchJson<GitHubSearchResult>(url, {
          headers: process.env.GITHUB_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
            : {}
        });

        // 更新速率限制状态
        this.updateGithubRateLimit(result as any);

        for (const repo of result?.items || []) {
          if (seen.has(repo.full_name)) continue;
          seen.add(repo.full_name);

          plugins.push({
            id: this.repoToPluginId(repo.full_name),
            name: repo.name,
            description: repo.description || '',
            version: 'latest',
            source: {
              type: 'git' as const,
              url: `https://github.com/${repo.full_name}.git`
            },
            skills: this.inferSkillsFromRepo(repo),
            author: repo.full_name.split('/')[0],
            tags: repo.topics || [],
            auto_config: false,
            stars: repo.stargazers_count
          });
        }
      }

      // 保存缓存
      await this.saveToCache(keyword, 'github', plugins);

      return plugins;
    } catch (error) {
      logger.externalMarket.warn(`GitHub 搜索失败: ${error instanceof Error ? error.message : String(error)}`);
      // 尝试使用过期缓存
      const expiredCache = await this.loadFromCache(keyword, 'github', true);
      return expiredCache || [];
    }
  }

  /**
   * 搜索 MCP Marketplace
   */
  async searchMCPMarketplace(keyword: string, useCache: boolean = true): Promise<ExternalPlugin[]> {
    // 检查缓存
    if (useCache) {
      const cached = await this.loadFromCache(keyword, 'mcp-marketplace');
      if (cached) {
        return cached;
      }
    }

    try {
      // MCP Servers 官方市场
      const url = `${this.mcpMarketplaceUrl}/api/servers?search=${encodeURIComponent(keyword)}`;

      const result = await this.fetchJson<{ servers: MCPMarketplacePlugin[] }>(url);

      const plugins: ExternalPlugin[] = (result?.servers || []).map(server => ({
        id: this.repoToPluginId(server.repository),
        name: server.name,
        description: server.description || '',
        version: 'latest',
        source: {
          type: 'mcp-marketplace' as const,
          url: server.repository
        },
        skills: this.inferSkillsFromName(server.name),
        author: server.author,
        tags: server.tags || [],
        auto_config: false
      }));

      // 保存缓存
      await this.saveToCache(keyword, 'mcp-marketplace', plugins);

      return plugins;
    } catch (error) {
      logger.externalMarket.warn(`MCP Marketplace 搜索失败: ${error instanceof Error ? error.message : String(error)}`);
      // 尝试使用过期缓存
      const expiredCache = await this.loadFromCache(keyword, 'mcp-marketplace', true);
      return expiredCache || [];
    }
  }

  /**
   * 综合搜索所有来源
   */
  async searchAll(keyword: string): Promise<ExternalPlugin[]> {
    const [npmPlugins, githubPlugins, mcpPlugins] = await Promise.all([
      this.searchNpm(keyword),
      this.searchGitHub(keyword),
      this.searchMCPMarketplace(keyword)
    ]);

    // 合并并去重
    const allPlugins = [...npmPlugins, ...githubPlugins, ...mcpPlugins];
    const seen = new Set<string>();
    const uniquePlugins: ExternalPlugin[] = [];

    for (const plugin of allPlugins) {
      if (!seen.has(plugin.id)) {
        seen.add(plugin.id);
        uniquePlugins.push(plugin);
      }
    }

    return uniquePlugins;
  }

  /**
   * 从指定来源搜索
   */
  async search(keyword: string, source: 'npm' | 'github' | 'mcp-marketplace' | 'all' = 'all'): Promise<ExternalPlugin[]> {
    switch (source) {
      case 'npm':
        return this.searchNpm(keyword);
      case 'github':
        return this.searchGitHub(keyword);
      case 'mcp-marketplace':
        return this.searchMCPMarketplace(keyword);
      case 'all':
      default:
        return this.searchAll(keyword);
    }
  }

  // ========== 私有方法 ==========

  /**
   * 将 npm 包名转换为唯一的插件 ID
   *
   * ID 生成策略:
   * - scoped 包 (@scope/name) -> scope--name (使用双横线分隔，避免冲突)
   * - 普通包 (name) -> name (保持不变)
   *
   * 示例:
   * - @openclaw/search -> openclaw--search
   * - openclaw-search -> openclaw-search
   * - @scope/sub/name -> scope--sub--name
   */
  private packageNameToPluginId(packageName: string): string {
    if (packageName.startsWith('@')) {
      // 移除 @ 前缀，然后用双横线替换所有斜杠
      return packageName.slice(1).replace(/\//g, '--');
    }
    return packageName;
  }

  /**
   * 将 npm 包转换为插件格式
   */
  private npmToPlugin(pkg: NpmSearchResult['objects'][0]['package'], type: 'openclaw' | 'mcp'): ExternalPlugin {
    return {
      id: this.packageNameToPluginId(pkg.name),
      name: pkg.name,
      description: pkg.description || '',
      version: pkg.version,
      source: {
        type: 'npm' as const,
        url: pkg.name
      },
      skills: this.inferSkillsFromKeywords(pkg.keywords || []),
      author: pkg.author?.name,
      tags: pkg.keywords || [],
      auto_config: type === 'openclaw'
    };
  }

  /**
   * 将仓库名转换为插件ID
   */
  private repoToPluginId(repoFullName: string): string {
    return repoFullName.replace(/\//g, '-').toLowerCase();
  }

  /**
   * 从关键词推断技能
   */
  private inferSkillsFromKeywords(keywords: string[]): string[] {
    const skills: string[] = [];

    const keywordToSkill: Record<string, string> = {
      'search': 'search',
      'web': 'web_search',
      'github': 'github',
      'gitlab': 'gitlab',
      'database': 'database',
      'sql': 'db_query',
      'pdf': 'pdf_process',
      'excel': 'excel',
      'image': 'image_process',
      'ai': 'ai',
      'translate': 'translate',
      'speech': 'speech',
      'email': 'email',
      'calendar': 'calendar',
      'weather': 'weather',
      'news': 'news',
      'slack': 'slack',
      'wechat': 'wechat',
      'weibo': 'weibo',
      'xiaohongshu': 'xiaohongshu'
    };

    for (const keyword of keywords) {
      const lower = keyword.toLowerCase();
      for (const [key, skill] of Object.entries(keywordToSkill)) {
        if (lower.includes(key) && !skills.includes(skill)) {
          skills.push(skill);
        }
      }
    }

    return skills;
  }

  /**
   * 从仓库名称推断技能
   */
  private inferSkillsFromName(name: string): string[] {
    return this.inferSkillsFromKeywords([name]);
  }

  /**
   * 从仓库信息推断技能
   */
  private inferSkillsFromRepo(repo: GitHubSearchResult['items'][0]): string[] {
    const keywords = [
      repo.name,
      repo.description || '',
      ...(repo.topics || [])
    ].join(' ');

    return this.inferSkillsFromKeywords([keywords]);
  }

  /**
   * 检测是否为内网地址 (SSRF 防护)
   */
  private isInternalUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();

      const internalPatterns = [
        /^localhost$/i,
        /^127\./,
        /^10\./,
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
        /^192\.168\./,
        /^::1$/,
        /^fc00:/i,
        /^fe80:/i
      ];

      return internalPatterns.some(p => p.test(hostname));
    } catch {
      return true; // 无效 URL 视为内部
    }
  }

  /**
   * JSON 请求 (带超时和重试)
   */
  private async fetchJson<T>(url: string, options: RequestInit = {}): Promise<T | null> {
    // SSRF 防护: 验证 URL 不是内网地址
    if (this.isInternalUrl(url)) {
      logger.externalMarket.warn(`SSRF 防护: 拒绝访问内网地址 ${url}`);
      return null;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'OpenClaw-PluginManager/1.0',
            ...(options.headers as Record<string, string>)
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          if (response.status === 429) {
            // 速率限制
            throw new Error('Rate limit exceeded');
          }
          return null;
        }

        return await response.json() as T;
      } catch (error: any) {
        lastError = error;
        if (error.name === 'AbortError') {
          logger.externalMarket.warn(`请求超时: ${url}`);
        } else if (error.message === 'Rate limit exceeded') {
          throw error;
        }
        // 重试前等待
        if (attempt < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    logger.externalMarket.warn(`请求失败 (${lastError?.message}): ${url}`);
    return null;
  }

  // ========== 缓存方法 ==========

  /**
   * 从缓存加载
   */
  private async loadFromCache(keyword: string, source: string, includeExpired: boolean = false): Promise<ExternalPlugin[] | null> {
    try {
      const cacheFile = this.getCacheFilePath(keyword, source);

      if (!(await fs.pathExists(cacheFile))) {
        return null;
      }

      const cacheData: CacheData = await fs.readJson(cacheFile);

      // 检查是否过期
      if (!includeExpired && Date.now() > cacheData.expiresAt) {
        return null;
      }

      return cacheData.results;
    } catch {
      return null;
    }
  }

  /**
   * 保存到缓存
   */
  private async saveToCache(keyword: string, source: string, results: ExternalPlugin[]): Promise<void> {
    try {
      await fs.ensureDir(this.cacheDir);

      const cacheData: CacheData = {
        keyword,
        source,
        results,
        cachedAt: Date.now(),
        expiresAt: Date.now() + this.cacheDuration
      };

      const cacheFile = this.getCacheFilePath(keyword, source);
      await fs.writeJson(cacheFile, cacheData, { spaces: 2 });
    } catch (error) {
      logger.externalMarket.warn(`保存缓存失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取缓存文件路径
   */
  private getCacheFilePath(keyword: string, source: string): string {
    const hash = Buffer.from(`${source}:${keyword}`).toString('base64').replace(/[\/\\]/g, '_');
    return path.join(this.cacheDir, `${hash}.json`);
  }

  /**
   * 清除所有缓存
   */
  async clearCache(): Promise<void> {
    try {
      if (await fs.pathExists(this.cacheDir)) {
        await fs.remove(this.cacheDir);
      }
    } catch (error) {
      logger.externalMarket.warn(`清除缓存失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ========== GitHub 速率限制 ==========

  /**
   * 检查是否可以调用 GitHub API
   */
  private canCallGithub(): boolean {
    if (this.rateLimitState.githubRemaining <= 0) {
      // 检查是否已重置
      if (Date.now() < this.rateLimitState.githubResetAt) {
        return false;
      }
      // 重置计数
      this.rateLimitState.githubRemaining = 60;
    }
    return true;
  }

  /**
   * 更新 GitHub 速率限制状态
   */
  private updateGithubRateLimit(response: any): void {
    if (response?.headers) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      const resetAt = response.headers.get('x-ratelimit-reset');

      if (remaining) {
        this.rateLimitState.githubRemaining = parseInt(remaining, 10);
      }
      if (resetAt) {
        this.rateLimitState.githubResetAt = parseInt(resetAt, 10) * 1000;
      }
    }
  }

  // ========== 插件详情获取 ==========

  /**
   * 获取 npm 包详情
   */
  async getNpmPackageDetails(packageName: string): Promise<ExternalPlugin | null> {
    try {
      const url = `${this.npmRegistry}/${encodeURIComponent(packageName)}`;
      const response = await this.fetchJson<any>(url);

      if (!response) {
        return null;
      }

      const latestVersion = response['dist-tags']?.latest || '';
      const versionInfo = response.versions?.[latestVersion] || {};

      return {
        id: this.packageNameToPluginId(packageName),
        name: packageName,
        description: response.description || versionInfo.description || '',
        version: latestVersion,
        source: {
          type: 'npm' as const,
          url: packageName
        },
        skills: this.inferSkillsFromKeywords(response.keywords || versionInfo.keywords || []),
        author: response.author?.name || versionInfo.author?.name,
        tags: response.keywords || versionInfo.keywords || [],
        auto_config: packageName.startsWith('@openclaw/'),
        homepage: response.homepage || versionInfo.homepage,
        repository: response.repository?.url || versionInfo.repository?.url,
        license: response.license || versionInfo.license,
        publishedAt: response.time?.[latestVersion]
      };
    } catch (error) {
      logger.externalMarket.warn(`获取 npm 包详情失败: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * 获取 GitHub 仓库详情
   */
  async getGitHubRepoDetails(owner: string, repo: string): Promise<ExternalPlugin | null> {
    // 检查速率限制
    if (!this.canCallGithub()) {
      logger.externalMarket.warn('GitHub API 速率限制');
      return null;
    }

    try {
      const url = `${this.githubApi}/repos/${owner}/${repo}`;
      const response = await this.fetchJson<any>(url, {
        headers: process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}
      });

      if (!response) {
        return null;
      }

      return {
        id: this.repoToPluginId(response.full_name),
        name: response.name,
        description: response.description || '',
        version: 'latest',
        source: {
          type: 'git' as const,
          url: response.clone_url
        },
        skills: this.inferSkillsFromKeywords([
          response.name,
          response.description || '',
          ...(response.topics || [])
        ]),
        author: response.owner?.login,
        tags: response.topics || [],
        auto_config: false,
        stars: response.stargazers_count,
        homepage: response.homepage,
        license: response.license?.spdx_id
      };
    } catch (error) {
      logger.externalMarket.warn(`获取 GitHub 仓库详情失败: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * 从插件 ID 反向解析出 npm 包名
   *
   * ID 格式:
   * - scoped 包: scope--name -> @scope/name
   * - 普通包: name -> name
   */
  private pluginIdToPackageName(pluginId: string): string | null {
    // 检查是否为 scoped 包格式 (包含双横线)
    if (pluginId.includes('--')) {
      // scope--name -> @scope/name
      const parts = pluginId.split('--');
      if (parts.length >= 2) {
        const scope = parts[0];
        const name = parts.slice(1).join('--'); // 处理名称中可能包含的 --
        return `@${scope}/${name}`;
      }
    }
    return null;
  }

  /**
   * 根据 ID 获取插件详情
   */
  async getPluginDetails(pluginId: string): Promise<ExternalPlugin | null> {
    // 尝试从 ID 解析 scoped npm 包名
    const scopedPackageName = this.pluginIdToPackageName(pluginId);
    if (scopedPackageName) {
      const npmDetails = await this.getNpmPackageDetails(scopedPackageName);
      if (npmDetails) return npmDetails;
    }

    // 尝试普通 npm 包名 (不包含双横线的 ID)
    const npmDetails = await this.getNpmPackageDetails(pluginId);
    if (npmDetails) return npmDetails;

    // 尝试作为 GitHub 仓库获取 (格式: owner-repo，使用单横线)
    // 注意: 新格式的 scoped 包 ID 使用双横线，不会误判
    const parts = pluginId.split('-');
    if (parts.length >= 2 && !pluginId.includes('--')) {
      const owner = parts[0];
      const repo = parts.slice(1).join('-');
      const ghDetails = await this.getGitHubRepoDetails(owner, repo);
      if (ghDetails) return ghDetails;
    }

    return null;
  }
}

// 重新导出类型，保持向后兼容
export type { ExternalPlugin } from '../types.js';
