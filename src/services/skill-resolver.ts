/**
 * 技能解析服务 - 处理技能到插件的映射和解析
 *
 * 支持两种技能发现模式:
 * 1. 官方格式: 从插件的 skills/<name>/SKILL.md 读取技能信息
 * 2. 智能发现辅助: 使用 skill_mappings.json 进行关键词匹配
 */

import fs from 'fs-extra';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { MarketService } from './market-service.js';
import { logger } from '../utils/logger.js';
import {
  InstalledPluginInfo,
  OfficialSkill,
  SkillTool,
  SkillMapping,
  SkillResolveResult,
  MarketPlugin
} from '../types.js';
import {
  parseSkillMd,
  getSkillDescription,
  parseSkillFromPath,
  readPluginSkills
} from '../utils/skill-parser.js';

// ES 模块中获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class SkillResolver {
  private skillMappings: SkillMapping[] = [];
  private marketService: MarketService;
  private mappingsPath: string;
  private installedPluginsPath: string;

  // 技能索引缓存
  private skillIndex: Map<string, InstalledPluginInfo> = new Map();
  private pluginSkillsIndex: Map<string, string[]> = new Map(); // pluginId -> skills[]
  private indexBuilt: boolean = false;

  constructor(marketService: MarketService, mappingsPath?: string) {
    this.marketService = marketService;
    // 默认映射文件路径
    this.mappingsPath = mappingsPath || path.join(__dirname, '../../data/skill_mappings.json');
    // 已安装插件记录路径
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    this.installedPluginsPath = path.join(homeDir, '.openclaw', 'extensions', 'installed_plugins.json');
  }

  /**
   * 初始化 - 加载技能映射配置
   */
  async initialize(): Promise<void> {
    try {
      if (await fs.pathExists(this.mappingsPath)) {
        const data = await fs.readJson(this.mappingsPath);
        this.skillMappings = data.mappings || [];
      }
    } catch (error) {
      logger.skillResolver.warn(`加载技能映射配置失败: ${error instanceof Error ? error.message : String(error)}`);
      this.skillMappings = [];
    }

    // 构建技能索引
    const installedPlugins = await this.getInstalledPlugins();
    await this.buildSkillIndex(installedPlugins);
  }

  /**
   * 构建技能索引缓存
   */
  private async buildSkillIndex(installedPlugins: InstalledPluginInfo[]): Promise<void> {
    this.skillIndex.clear();
    this.pluginSkillsIndex.clear();

    for (const plugin of installedPlugins) {
      if (plugin.status !== 'enabled') continue;

      const pluginSkills: string[] = [];

      // 从插件的 skills 目录读取技能信息
      if (plugin.installPath) {
        const skills = await this.getPluginSkills(plugin);
        for (const skill of skills) {
          const skillNameLower = skill.name.toLowerCase();
          this.skillIndex.set(skillNameLower, plugin);
          pluginSkills.push(skillNameLower);

          // 同时索引技能中的工具名称
          for (const tool of skill.tools) {
            const toolNameLower = tool.name.toLowerCase();
            this.skillIndex.set(toolNameLower, plugin);
          }
        }
      }

      // 同时索引 plugin.skills 数组
      for (const skillPath of plugin.skills || []) {
        const skillName = path.basename(skillPath).toLowerCase();
        if (!this.skillIndex.has(skillName)) {
          this.skillIndex.set(skillName, plugin);
        }
        if (!pluginSkills.includes(skillName)) {
          pluginSkills.push(skillName);
        }
      }

      this.pluginSkillsIndex.set(plugin.id, pluginSkills);
    }

    this.indexBuilt = true;
  }

  /**
   * 使缓存失效 - 在插件安装/卸载后调用
   */
  async invalidateCache(): Promise<void> {
    this.indexBuilt = false;
    this.skillIndex.clear();
    this.pluginSkillsIndex.clear();

    // 重新构建索引
    const installedPlugins = await this.getInstalledPlugins();
    await this.buildSkillIndex(installedPlugins);
  }

  /**
   * 获取已安装插件列表
   */
  async getInstalledPlugins(): Promise<InstalledPluginInfo[]> {
    try {
      if (await fs.pathExists(this.installedPluginsPath)) {
        const data = await fs.readJson(this.installedPluginsPath);
        return data.plugins || [];
      }
      return [];
    } catch (error) {
      logger.skillResolver.warn(`读取已安装插件记录失败: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * 解析技能
   * @param skillName 技能名称或关键词
   * @param installedPlugins 已安装插件列表（可选，如不提供则从文件读取）
   */
  async resolve(skillName: string, installedPlugins?: InstalledPluginInfo[]): Promise<SkillResolveResult> {
    const lowerName = skillName.toLowerCase();

    // 如果没有传入已安装列表，从文件读取
    if (!installedPlugins) {
      installedPlugins = await this.getInstalledPlugins();
    }

    // 1. 优先使用索引查找已安装的技能
    if (this.indexBuilt && this.skillIndex.has(lowerName)) {
      const plugin = this.skillIndex.get(lowerName)!;
      // 获取技能详情
      const skillInfo = await this.getSkillDetailFromPlugin(plugin, skillName);
      return {
        status: 'installed',
        pluginId: plugin.id,
        installedInfo: plugin,
        skillInfo: skillInfo || undefined,
        message: skillInfo
          ? `${plugin.name || plugin.id} 已就绪，提供 ${skillInfo.name} 技能`
          : `${plugin.name || plugin.id} 已就绪`
      };
    }

    // 2. 如果索引未命中，回退到遍历查找（兼容旧逻辑）
    const installedResult = await this.findInInstalledPlugins(skillName, installedPlugins);
    if (installedResult) {
      return installedResult;
    }

    // 3. 在技能映射表中查找（智能发现辅助）
    const mapping = this.findMapping(skillName);

    if (mapping) {
      const pluginId = mapping.plugin_id;

      // 检查市场是否有
      const marketPlugin = await this.marketService.getPluginById(pluginId);
      if (marketPlugin) {
        return {
          status: 'available',
          pluginId,
          pluginInfo: marketPlugin,
          message: `找到 ${marketPlugin.name}，是否安装？`
        };
      }
    }

    // 4. 直接在市场中搜索技能
    const marketPlugin = await this.marketService.findPluginBySkill(skillName);
    if (marketPlugin) {
      // 检查是否已安装
      const installed = installedPlugins.find(p => p.id === marketPlugin.id);
      if (installed && installed.status === 'enabled') {
        return {
          status: 'installed',
          pluginId: marketPlugin.id,
          installedInfo: installed,
          message: `${installed.name || marketPlugin.id} 已就绪`
        };
      }

      return {
        status: 'available',
        pluginId: marketPlugin.id,
        pluginInfo: marketPlugin,
        message: `找到 ${marketPlugin.name}，是否安装？`
      };
    }

    // 5. 未找到
    return {
      status: 'not_found',
      message: `未找到与 "${skillName}" 相关的插件`
    };
  }

  /**
   * 从插件获取技能详情（用于索引命中后获取详细信息）
   */
  private async getSkillDetailFromPlugin(
    plugin: InstalledPluginInfo,
    skillName: string
  ): Promise<OfficialSkill | null> {
    if (!plugin.installPath) {
      return null;
    }

    const lowerName = skillName.toLowerCase();

    // 尝试从插件目录读取技能详情
    try {
      const manifestPath = path.join(plugin.installPath, 'openclaw.plugin.json');
      if (await fs.pathExists(manifestPath)) {
        const manifest = await fs.readJson(manifestPath);
        for (const skillPath of manifest.skills || []) {
          const skillBaseName = path.basename(skillPath);
          if (skillBaseName.toLowerCase() === lowerName) {
            return await parseSkillFromPath(plugin.installPath, skillPath);
          }
        }
      }
    } catch (error) {
      logger.skillResolver.warn(`获取插件技能详情失败: ${error instanceof Error ? error.message : String(error)}`);
    }

    return null;
  }

  /**
   * 在已安装插件中查找技能
   */
  private async findInInstalledPlugins(
    skillName: string,
    installedPlugins: InstalledPluginInfo[]
  ): Promise<SkillResolveResult | null> {
    const lowerName = skillName.toLowerCase();

    for (const plugin of installedPlugins) {
      if (plugin.status !== 'enabled') continue;

      // 如果插件有安装路径，尝试读取官方技能
      if (plugin.installPath) {
        const skill = await this.findSkillInPlugin(plugin.installPath, skillName);
        if (skill) {
          return {
            status: 'installed',
            pluginId: plugin.id,
            installedInfo: plugin,
            skillInfo: skill,
            message: `${plugin.name || plugin.id} 已就绪，提供 ${skill.name} 技能`
          };
        }
      }

      // 兼容旧格式的技能列表
      if (plugin.skills) {
        for (const skillPath of plugin.skills) {
          // 检查技能路径或名称匹配
          const skillBaseName = path.basename(skillPath);
          if (skillPath.toLowerCase() === lowerName ||
              skillBaseName.toLowerCase() === lowerName ||
              skillPath === `skills/${skillName}`) {

            // 尝试从插件目录读取技能详情
            if (plugin.installPath) {
              const skill = await parseSkillFromPath(plugin.installPath, skillPath);
              if (skill) {
                return {
                  status: 'installed',
                  pluginId: plugin.id,
                  installedInfo: plugin,
                  skillInfo: skill,
                  message: `${plugin.name || plugin.id} 已就绪，提供 ${skill.name} 技能`
                };
              }
            }

            // 旧格式匹配
            return {
              status: 'installed',
              pluginId: plugin.id,
              installedInfo: plugin,
              message: `${plugin.name || plugin.id} 已就绪`
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * 在插件目录中查找匹配的技能
   */
  private async findSkillInPlugin(
    installPath: string,
    skillName: string
  ): Promise<OfficialSkill | null> {
    try {
      // 读取 openclaw.plugin.json
      const manifestPath = path.join(installPath, 'openclaw.plugin.json');
      if (!(await fs.pathExists(manifestPath))) {
        return null;
      }

      const manifest = await fs.readJson(manifestPath);
      const skills = manifest.skills || [];
      const lowerName = skillName.toLowerCase();

      for (const skillPath of skills) {
        const skillBaseName = path.basename(skillPath);

        // 匹配技能名称
        if (skillBaseName.toLowerCase() === lowerName ||
            skillPath.toLowerCase() === lowerName) {
          return await parseSkillFromPath(installPath, skillPath);
        }

        // 检查技能中的工具名称
        const skill = await parseSkillFromPath(installPath, skillPath);
        if (skill && skill.tools.some(t => t.name.toLowerCase() === lowerName)) {
          return skill;
        }
      }
    } catch (error) {
      logger.skillResolver.warn(`在插件目录中查找技能失败: ${error instanceof Error ? error.message : String(error)}`);
    }

    return null;
  }

  /**
   * 从插件目录读取技能详情
   */
  async readSkillFromPlugin(
    installPath: string,
    skillPath: string
  ): Promise<OfficialSkill | null> {
    try {
      const skill = await parseSkillFromPath(installPath, skillPath);
      if (skill) {
        return skill;
      }

      // 如果解析失败，返回基本结构
      const skillName = path.basename(skillPath);
      return {
        name: skillName,
        path: skillPath,
        description: getSkillDescription(skillName),
        tools: [],
        enabled: true
      };
    } catch (error) {
      logger.skillResolver.warn(`从插件目录读取技能详情失败: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * 在映射表中查找
   */
  private findMapping(skillName: string): SkillMapping | null {
    const lowerName = skillName.toLowerCase();

    // 精确匹配 skill_name
    let mapping = this.skillMappings.find(m =>
      m.skill_name.toLowerCase() === lowerName
    );

    if (mapping) return mapping;

    // 关键词匹配
    mapping = this.skillMappings.find(m =>
      m.keywords.some(kw => lowerName.includes(kw.toLowerCase()))
    );

    return mapping || null;
  }

  /**
   * 添加技能映射
   */
  addMapping(mapping: SkillMapping): void {
    this.skillMappings.push(mapping);
  }

  /**
   * 获取所有映射
   */
  getMappings(): SkillMapping[] {
    return this.skillMappings;
  }

  /**
   * 保存映射配置
   */
  async saveMappings(): Promise<void> {
    await fs.ensureDir(path.dirname(this.mappingsPath));
    await fs.writeJson(this.mappingsPath, { mappings: this.skillMappings }, { spaces: 2 });
  }

  /**
   * 获取插件的所有技能
   */
  async getPluginSkills(plugin: InstalledPluginInfo): Promise<OfficialSkill[]> {
    if (!plugin.installPath) {
      return [];
    }

    try {
      return await readPluginSkills(plugin.installPath);
    } catch (error) {
      logger.skillResolver.warn(`获取插件技能列表失败: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
}

// 重新导出类型，保持向后兼容
export type {
  InstalledPluginInfo,
  OfficialSkill,
  SkillTool,
  SkillMapping,
  SkillResolveResult
} from '../types.js';
