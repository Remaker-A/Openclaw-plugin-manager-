/**
 * plugin_auto_install 工具
 * 自动检测技能并安装插件
 */

import { ISkillResolver, IMarketService } from '../interfaces/index.js';
import { installPlugin, getInstalledPlugins } from './install.js';
import { refreshSkills } from './refresh-skills.js';
import { autoInstallSchema, AutoInstallInput } from '../schemas.js';

// 重新导出 schemas 供 index.ts 使用
export { autoInstallSchema, checkMultipleSkillsSchema } from '../schemas.js';

// 响应类型
interface AutoInstallResponse {
  status: 'installed' | 'installing' | 'confirmation_required' | 'not_found' | 'error';
  skill_name: string;
  plugin?: {
    id: string;
    name: string;
    description: string;
  };
  message: string;
  ready?: boolean;
  next_action?: 'confirm' | 'configure' | 'none';
}

/**
 * 自动检测技能并安装插件
 *
 * 工作流程:
 * 1. 检查技能是否已安装 -> 返回 installed
 * 2. 检查市场是否有对应插件 -> 返回 confirmation_required
 * 3. 用户确认后安装 -> 返回 installing
 * 4. 安装完成刷新技能 -> 返回 ready
 */
export async function autoInstallSkill(
  input: AutoInstallInput,
  skillResolver: ISkillResolver,
  marketService: IMarketService
): Promise<AutoInstallResponse> {
  const { skill_name, auto_confirm, auto_configure } = input;

  try {
    // 1. 初始化技能解析器
    await skillResolver.initialize();

    // 2. 解析技能
    const resolveResult = await skillResolver.resolve(skill_name);

    // 3. 如果已安装
    if (resolveResult.status === 'installed' && resolveResult.installedInfo) {
      return {
        status: 'installed',
        skill_name,
        plugin: {
          id: resolveResult.installedInfo.id,
          name: resolveResult.installedInfo.name,
          description: resolveResult.installedInfo.description || ''
        },
        message: `技能 "${skill_name}" 已就绪，插件 ${resolveResult.installedInfo.name} 已安装`,
        ready: true,
        next_action: 'none'
      };
    }

    // 4. 如果市场有但未安装
    if (resolveResult.status === 'available' && resolveResult.pluginInfo) {
      const plugin = resolveResult.pluginInfo;

      // 需要用户确认
      if (!auto_confirm) {
        return {
          status: 'confirmation_required',
          skill_name,
          plugin: {
            id: plugin.id,
            name: plugin.name,
            description: plugin.description
          },
          message: `找到插件 "${plugin.name}" 可提供技能 "${skill_name}"，是否安装？`,
          next_action: 'confirm'
        };
      }

      // 自动确认安装
      const installResult = await installPlugin(
        {
          plugin_id: plugin.id,
          auto_configure
        },
        marketService,
        null // TODO: 传入真正的 PluginManager
      );

      if (installResult.status === 'success') {
        // 刷新技能缓存
        await refreshSkills({ plugin_id: plugin.id });

        return {
          status: 'installed',
          skill_name,
          plugin: {
            id: plugin.id,
            name: plugin.name,
            description: plugin.description
          },
          message: `插件 "${plugin.name}" 已安装，技能 "${skill_name}" 已就绪`,
          ready: true,
          next_action: 'none'
        };
      } else {
        return {
          status: 'error',
          skill_name,
          plugin: {
            id: plugin.id,
            name: plugin.name,
            description: plugin.description
          },
          message: `安装失败: ${installResult.message}`,
          next_action: 'none'
        };
      }
    }

    // 5. 未找到
    return {
      status: 'not_found',
      skill_name,
      message: `未找到与技能 "${skill_name}" 相关的插件`,
      next_action: 'none'
    };
  } catch (error) {
    return {
      status: 'error',
      skill_name,
      message: `自动安装失败: ${error instanceof Error ? error.message : String(error)}`,
      next_action: 'none'
    };
  }
}

/**
 * 批量检查多个技能
 */
export async function checkMultipleSkills(
  skillNames: string[],
  skillResolver: ISkillResolver
): Promise<{
  installed: string[];
  available: string[];
  not_found: string[];
}> {
  await skillResolver.initialize();

  const result = {
    installed: [] as string[],
    available: [] as string[],
    not_found: [] as string[]
  };

  for (const skill of skillNames) {
    const resolveResult = await skillResolver.resolve(skill);

    if (resolveResult.status === 'installed') {
      result.installed.push(skill);
    } else if (resolveResult.status === 'available') {
      result.available.push(skill);
    } else {
      result.not_found.push(skill);
    }
  }

  return result;
}

/**
 * 获取技能状态摘要
 */
export async function getSkillStatusSummary(
  skillResolver: ISkillResolver
): Promise<{
  total_skills_mapped: number;
  installed_plugins: number;
  available_plugins: number;
}> {
  await skillResolver.initialize();

  const mappings = skillResolver.getMappings();
  const installed = await getInstalledPlugins();

  return {
    total_skills_mapped: mappings.length,
    installed_plugins: installed.length,
    available_plugins: 0 // 需要从市场获取
  };
}
