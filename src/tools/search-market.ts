/**
 * plugin_search_market 工具
 * 搜索插件市场 - 支持本地市场和外部市场（npm、GitHub、MCP Marketplace）
 */

import { IMarketService, IExternalMarketService } from '../interfaces/index.js';
import { ExternalMarketService, ExternalPlugin } from '../services/external-market-service.js';
import { InstalledPluginInfo } from '../types.js';
import { logger } from '../utils/logger.js';
import { searchMarketSchema, SearchMarketInput } from '../schemas.js';

// 重新导出 schemas 供 index.ts 使用
export { searchMarketSchema } from '../schemas.js';

// 插件搜索结果
export interface PluginSearchResult {
  id: string;
  name: string;
  description: string;
  version: string;
  installed: boolean;
  skills: string[];
  source: 'local' | 'npm' | 'github' | 'mcp-marketplace';
  author?: string;
  tags?: string[];
}

// 响应类型
export interface SearchMarketResponse {
  status: 'success' | 'error';
  count: number;
  plugins: PluginSearchResult[];
  sources_searched: string[];
  message?: string;
}

/**
 * 搜索插件市场
 */
export async function searchMarket(
  input: SearchMarketInput,
  marketService: IMarketService,
  installedPlugins: any[]
): Promise<SearchMarketResponse> {
  const { keyword, source, include_installed, refresh } = input;
  const sourcesSearched: string[] = [];
  const allResults: PluginSearchResult[] = [];
  const seen = new Set<string>();

  try {
    // 1. 搜索本地市场
    if (source === 'local' || source === 'all') {
      sourcesSearched.push('local');
      const localPlugins = await marketService.searchPlugins(keyword, refresh);

      for (const plugin of localPlugins) {
        if (seen.has(plugin.id)) continue;
        seen.add(plugin.id);

        const isInstalled = installedPlugins.some(p => p.id === plugin.id);
        if (!include_installed && isInstalled) continue;

        allResults.push({
          id: plugin.id,
          name: plugin.name,
          description: plugin.description,
          version: plugin.version,
          installed: isInstalled,
          skills: plugin.skills,
          source: 'local',
          author: plugin.author,
          tags: plugin.tags
        });
      }
    }

    // 2. 搜索外部市场
    if (source !== 'local') {
      const externalService = new ExternalMarketService();
      const externalSource = source === 'all' ? 'all' : source;
      sourcesSearched.push(externalSource);

      let externalPlugins: ExternalPlugin[] = [];

      try {
        externalPlugins = await externalService.search(keyword, externalSource);
      } catch (error) {
        logger.externalMarket.warn(`外部市场搜索失败: ${error instanceof Error ? error.message : String(error)}`);
      }

      for (const plugin of externalPlugins) {
        if (seen.has(plugin.id)) continue;
        seen.add(plugin.id);

        const isInstalled = installedPlugins.some(p => p.id === plugin.id);
        if (!include_installed && isInstalled) continue;

        allResults.push({
          id: plugin.id,
          name: plugin.name,
          description: plugin.description,
          version: plugin.version,
          installed: isInstalled,
          skills: plugin.skills,
          source: plugin.source.type === 'npm' ? 'npm' :
                  plugin.source.type === 'git' ? 'github' : 'mcp-marketplace',
          author: plugin.author,
          tags: plugin.tags
        });
      }
    }

    // 3. 排序：已安装的排在前面，然后按名称排序
    allResults.sort((a, b) => {
      if (a.installed !== b.installed) {
        return a.installed ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return {
      status: 'success',
      count: allResults.length,
      plugins: allResults,
      sources_searched: sourcesSearched,
      message: allResults.length > 0
        ? `从 ${sourcesSearched.join(', ')} 找到 ${allResults.length} 个相关插件`
        : `在 ${sourcesSearched.join(', ')} 中未找到相关插件`
    };
  } catch (error) {
    return {
      status: 'error',
      count: 0,
      plugins: [],
      sources_searched: sourcesSearched,
      message: `搜索失败: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
