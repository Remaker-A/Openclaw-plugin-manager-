/**
 * plugin_check_updates 工具
 * 检测已安装插件是否有新版本可用
 *
 * 支持多来源版本检测:
 * 1. npm 仓库
 * 2. GitHub Releases
 * 3. 本地市场数据
 */

import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import fetch from 'node-fetch';
import { IMarketService } from '../interfaces/index.js';
import { getInstalledPlugins } from './install.js';
import { logger } from '../utils/logger.js';
import { checkUpdatesSchema, CheckUpdatesInput } from '../schemas.js';

// 重新导出 schemas 供 index.ts 使用
export { checkUpdatesSchema } from '../schemas.js';

// 版本信息
interface VersionInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
  releaseNotes?: string;
  publishedAt?: string;
}

// 单个插件更新结果
interface PluginUpdateResult {
  plugin_id: string;
  plugin_name: string;
  status: 'up_to_date' | 'update_available' | 'error' | 'not_found';
  version?: VersionInfo;
  error?: string;
}

// 响应类型
interface CheckUpdatesResponse {
  status: 'success' | 'error';
  message: string;
  total_checked?: number;
  updates_available?: number;
  plugins?: PluginUpdateResult[];
  error?: string;
}

// npm 包信息响应
interface NpmPackageInfo {
  name: string;
  'dist-tags': {
    latest: string;
    [key: string]: string;
  };
  versions: {
    [version: string]: {
      version: string;
      time?: string;
    };
  };
  time: {
    [version: string]: string;
  };
}

// GitHub Release 响应
interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  prerelease: boolean;
}

/**
 * 检查插件更新
 */
export async function checkUpdates(
  input: CheckUpdatesInput,
  marketService: IMarketService
): Promise<CheckUpdatesResponse> {
  const { plugin_id, source, include_prerelease } = input;

  try {
    // 1. 获取已安装插件列表
    const installedPlugins = await getInstalledPlugins();

    if (installedPlugins.length === 0) {
      return {
        status: 'success',
        message: '没有已安装的插件',
        total_checked: 0,
        updates_available: 0,
        plugins: []
      };
    }

    // 2. 筛选要检查的插件
    const pluginsToCheck = plugin_id
      ? installedPlugins.filter(p => p.id === plugin_id)
      : installedPlugins;

    if (pluginsToCheck.length === 0) {
      return {
        status: 'error',
        message: `未找到插件: ${plugin_id}`,
        error: 'PLUGIN_NOT_FOUND'
      };
    }

    // 3. 检查每个插件的更新
    const results: PluginUpdateResult[] = [];

    for (const plugin of pluginsToCheck) {
      const result = await checkPluginUpdate(plugin, source, include_prerelease, marketService);
      results.push(result);
    }

    // 4. 统计结果
    const updatesAvailable = results.filter(r => r.status === 'update_available').length;

    return {
      status: 'success',
      message: `检查完成，${updatesAvailable} 个插件有可用更新`,
      total_checked: results.length,
      updates_available: updatesAvailable,
      plugins: results
    };
  } catch (error) {
    return {
      status: 'error',
      message: `检查更新失败: ${error instanceof Error ? error.message : String(error)}`,
      error: 'CHECK_FAILED'
    };
  }
}

/**
 * 检查单个插件的更新
 */
async function checkPluginUpdate(
  plugin: { id: string; name: string; version: string; installPath?: string },
  source: string,
  includePrerelease: boolean,
  marketService: IMarketService
): Promise<PluginUpdateResult> {
  const currentVersion = plugin.version || '0.0.0';

  try {
    // 1. 获取市场插件信息
    const marketPlugin = await marketService.getPluginById(plugin.id);

    // 2. 根据来源获取最新版本
    let versionInfo: VersionInfo | null = null;

    if (source === 'all' || source === 'npm') {
      if (marketPlugin?.source?.type === 'npm' && marketPlugin.source.url) {
        versionInfo = await checkNpmUpdate(marketPlugin.source.url, currentVersion, includePrerelease);
      }
    }

    if (!versionInfo && (source === 'all' || source === 'github')) {
      if (marketPlugin?.source?.type === 'git' && marketPlugin.source.url) {
        versionInfo = await checkGithubUpdate(marketPlugin.source.url, currentVersion, includePrerelease);
      }
    }

    if (!versionInfo && (source === 'all' || source === 'market')) {
      // 从本地市场数据获取版本
      if (marketPlugin) {
        const latestVersion = marketPlugin.version;
        versionInfo = {
          current: currentVersion,
          latest: latestVersion,
          updateAvailable: compareVersions(latestVersion, currentVersion) > 0
        };
      }
    }

    if (!versionInfo) {
      // 无法检查更新，可能是本地插件或无源信息
      return {
        plugin_id: plugin.id,
        plugin_name: plugin.name || plugin.id,
        status: 'not_found',
        error: '无法获取版本信息'
      };
    }

    return {
      plugin_id: plugin.id,
      plugin_name: plugin.name || plugin.id,
      status: versionInfo.updateAvailable ? 'update_available' : 'up_to_date',
      version: versionInfo
    };
  } catch (error) {
    return {
      plugin_id: plugin.id,
      plugin_name: plugin.name || plugin.id,
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * 从 npm 检查更新
 */
async function checkNpmUpdate(
  packageName: string,
  currentVersion: string,
  includePrerelease: boolean
): Promise<VersionInfo | null> {
  try {
    // 处理包名格式
    const encodedName = encodeURIComponent(packageName);
    const url = `https://registry.npmjs.org/${encodedName}`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'OpenClaw-PluginManager/1.0'
      },
      timeout: 10000
    });

    if (!response.ok) {
      return null;
    }

    const data: NpmPackageInfo = await response.json();

    // 获取最新版本
    let latestVersion = data['dist-tags']?.latest;

    if (includePrerelease) {
      // 查找所有版本中的最新版本
      const versions = Object.keys(data.versions || {});
      if (versions.length > 0) {
        latestVersion = versions.sort((a, b) => compareVersions(b, a))[0];
      }
    }

    if (!latestVersion) {
      return null;
    }

    const publishedAt = data.time?.[latestVersion];

    return {
      current: currentVersion,
      latest: latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      publishedAt
    };
  } catch (error) {
    logger.externalMarket.warn(`npm 检查失败: ${packageName} - ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * 从 GitHub 检查更新
 */
async function checkGithubUpdate(
  repoUrl: string,
  currentVersion: string,
  includePrerelease: boolean
): Promise<VersionInfo | null> {
  try {
    // 解析 GitHub 仓库 URL
    const repoInfo = parseGithubUrl(repoUrl);
    if (!repoInfo) {
      return null;
    }

    const { owner, repo } = repoInfo;
    const url = `https://api.github.com/repos/${owner}/${repo}/releases`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'OpenClaw-PluginManager/1.0'
      },
      timeout: 10000
    });

    if (!response.ok) {
      return null;
    }

    const releases: GitHubRelease[] = await response.json();

    // 过滤预发布版本
    const filteredReleases = includePrerelease
      ? releases
      : releases.filter(r => !r.prerelease);

    if (filteredReleases.length === 0) {
      return null;
    }

    const latestRelease = filteredReleases[0];
    const latestVersion = cleanVersionTag(latestRelease.tag_name);

    return {
      current: currentVersion,
      latest: latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      releaseNotes: latestRelease.body?.substring(0, 500),
      publishedAt: latestRelease.published_at
    };
  } catch (error) {
    logger.externalMarket.warn(`GitHub 检查失败: ${repoUrl} - ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * 解析 GitHub URL
 */
function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  // 支持多种格式
  // https://github.com/owner/repo
  // git@github.com:owner/repo.git
  // owner/repo

  const patterns = [
    /github\.com[\/:]([^\/]+)\/([^\/\.]+)/,
    /^([^\/]+)\/([^\/]+)$/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return {
        owner: match[1],
        repo: match[2].replace(/\.git$/, '')
      };
    }
  }

  return null;
}

/**
 * 清理版本标签
 */
function cleanVersionTag(tag: string): string {
  // 移除 'v' 前缀
  return tag.replace(/^v/i, '');
}

/**
 * 比较版本号
 * @returns 1: a > b, -1: a < b, 0: a == b
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(p => parseInt(p, 10) || 0);
  const partsB = b.split('.').map(p => parseInt(p, 10) || 0);

  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;

    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }

  return 0;
}

/**
 * 批量更新检查（简化接口）
 */
export async function checkAllUpdates(
  marketService: IMarketService
): Promise<{ hasUpdates: boolean; updates: PluginUpdateResult[] }> {
  const result = await checkUpdates({ source: 'all', include_prerelease: false }, marketService);

  const updates = result.plugins?.filter(p => p.status === 'update_available') || [];

  return {
    hasUpdates: updates.length > 0,
    updates
  };
}
