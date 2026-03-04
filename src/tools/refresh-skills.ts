/**
 * plugin_refresh_skills 工具
 * 刷新技能缓存，让 OpenClaw 识别新安装插件的技能
 *
 * 支持官方 Skills 机制:
 * - 从插件的 openclaw.plugin.json 读取技能声明
 * - 从 skills/<name>/SKILL.md 解析工具列表
 */

import fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { CONFIG_FILE_MODE } from '../utils/encryption.js';
import {
  OfficialSkill,
  SkillCache,
  PluginManifest
} from '../types.js';
import {
  getSkillDescription,
  parseSkillFromPath
} from '../utils/skill-parser.js';
import { refreshSkillsSchema, RefreshSkillsInput } from '../schemas.js';

// 重新导出 schemas 供 index.ts 使用
export { refreshSkillsSchema } from '../schemas.js';

// 响应类型
interface RefreshSkillsResponse {
  status: 'success' | 'error';
  message: string;
  skills_refreshed?: number;
  plugins_refreshed?: string[];
  error?: string;
}

/**
 * 刷新技能缓存
 */
export async function refreshSkills(
  input: RefreshSkillsInput
): Promise<RefreshSkillsResponse> {
  const { plugin_id } = input;

  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const extensionsDir = path.join(homeDir, '.openclaw', 'extensions');
    const cachePath = path.join(homeDir, '.openclaw', 'cache', 'skills_cache.json');
    const installedPath = path.join(extensionsDir, 'installed_plugins.json');

    // 1. 读取已安装插件
    let installedPlugins: any[] = [];
    if (await fs.pathExists(installedPath)) {
      const data = await fs.readJson(installedPath);
      installedPlugins = data.plugins || [];
    }

    // 2. 如果指定了插件ID，只刷新该插件
    if (plugin_id) {
      const plugin = installedPlugins.find(p => p.id === plugin_id);
      if (!plugin) {
        return {
          status: 'error',
          message: `未找到插件: ${plugin_id}`,
          error: 'PLUGIN_NOT_FOUND'
        };
      }
      installedPlugins = [plugin];
    }

    // 3. 构建技能列表 - 支持官方格式
    const skills: OfficialSkill[] = [];
    const legacySkills: SkillCache['legacySkills'] = [];

    for (const plugin of installedPlugins) {
      if (plugin.status !== 'enabled') continue;

      // 尝试读取官方 openclaw.plugin.json
      const officialSkills = await readOfficialSkills(plugin.installPath, plugin.id);

      if (officialSkills.length > 0) {
        // 使用官方格式
        skills.push(...officialSkills);
      } else if (plugin.skills) {
        // 兼容旧格式
        for (const skillName of plugin.skills) {
          // 检查是否已经是官方路径格式
          if (skillName.startsWith('skills/')) {
            const skill = await parseSkillFromPath(plugin.installPath, skillName);
            if (skill) {
              skills.push(skill);
            }
          } else {
            // 旧格式转换
            legacySkills?.push({
              name: skillName,
              plugin_id: plugin.id,
              description: getSkillDescription(skillName),
              enabled: true
            });
          }
        }
      }
    }

    // 4. 保存技能缓存
    const skillCache: SkillCache = {
      version: '2.0',
      lastRefreshed: new Date().toISOString(),
      skills,
      legacySkills: legacySkills.length > 0 ? legacySkills : undefined
    };

    await fs.ensureDir(path.dirname(cachePath));
    await fs.writeJson(cachePath, skillCache, { spaces: 2 });

    // 设置缓存文件权限
    await setSecureFilePermission(cachePath);

    // 5. 同时更新主配置文件的插件列表
    await updateMainConfig(extensionsDir, installedPlugins);

    const totalSkills = skills.length + (legacySkills?.length || 0);
    return {
      status: 'success',
      message: `技能缓存已刷新，共 ${totalSkills} 个技能`,
      skills_refreshed: totalSkills,
      plugins_refreshed: installedPlugins.map(p => p.id)
    };
  } catch (error) {
    return {
      status: 'error',
      message: `刷新技能缓存失败: ${error instanceof Error ? error.message : String(error)}`,
      error: 'REFRESH_FAILED'
    };
  }
}

/**
 * 从插件目录读取官方格式的技能
 */
async function readOfficialSkills(
  installPath: string,
  pluginId: string
): Promise<OfficialSkill[]> {
  const skills: OfficialSkill[] = [];

  try {
    // 读取 openclaw.plugin.json
    const manifestPath = path.join(installPath, 'openclaw.plugin.json');

    if (!(await fs.pathExists(manifestPath))) {
      return [];
    }

    const manifest: PluginManifest = await fs.readJson(manifestPath);

    if (!manifest.skills || manifest.skills.length === 0) {
      return [];
    }

    // 解析每个技能
    for (const skillPath of manifest.skills) {
      const skill = await parseSkillFromPath(installPath, skillPath);
      if (skill) {
        skills.push(skill);
      }
    }
  } catch (error) {
    logger.skillResolver.warn(`读取插件 ${pluginId} 的官方技能失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  return skills;
}

/**
 * 设置配置文件权限 (仅所有者可读写)
 */
async function setSecureFilePermission(filePath: string): Promise<void> {
  try {
    await fs.chmod(filePath, CONFIG_FILE_MODE);
  } catch {
    // Windows 系统可能不支持 chmod，忽略错误
  }
}

/**
 * 更新主配置文件
 */
async function updateMainConfig(extensionsDir: string, plugins: any[]): Promise<void> {
  const mainConfigPath = path.join(path.dirname(extensionsDir), 'openclaw.json');

  try {
    if (await fs.pathExists(mainConfigPath)) {
      const config = await fs.readJson(mainConfigPath);

      // 更新插件列表
      config.plugins = plugins
        .filter(p => p.status === 'enabled')
        .map(p => p.id);

      await fs.writeJson(mainConfigPath, config, { spaces: 2 });
      await setSecureFilePermission(mainConfigPath);
      logger.general.info('已更新主配置文件');
    }
  } catch (error) {
    logger.general.warn(`更新主配置文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 获取技能缓存
 */
export async function getSkillCache(): Promise<SkillCache | null> {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const cachePath = path.join(homeDir, '.openclaw', 'cache', 'skills_cache.json');

  try {
    if (await fs.pathExists(cachePath)) {
      return await fs.readJson(cachePath);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 根据技能名称查找插件
 */
export async function findPluginBySkillName(skillName: string): Promise<{ pluginId: string; skillPath: string } | null> {
  const cache = await getSkillCache();
  if (!cache) return null;

  // 在官方技能中查找
  const skill = cache.skills.find(s =>
    s.name === skillName ||
    s.path === `skills/${skillName}` ||
    s.tools.some(t => t.name === skillName)
  );

  if (skill) {
    // 需要从 installed_plugins.json 查找插件ID
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const installedPath = path.join(homeDir, '.openclaw', 'extensions', 'installed_plugins.json');

    try {
      if (await fs.pathExists(installedPath)) {
        const data = await fs.readJson(installedPath);
        const plugins = data.plugins || [];
        // 遍历插件找到包含此技能的
        for (const plugin of plugins) {
          if (plugin.skills?.some((s: string) => s === skill.path || s === skill.name)) {
            return { pluginId: plugin.id, skillPath: skill.path };
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 在旧格式技能中查找
  if (cache.legacySkills) {
    const legacySkill = cache.legacySkills.find(s => s.name === skillName);
    if (legacySkill) {
      return { pluginId: legacySkill.plugin_id, skillPath: skillName };
    }
  }

  return null;
}
