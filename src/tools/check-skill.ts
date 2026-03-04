/**
 * plugin_check_skill 工具
 * 检查技能是否可用
 */

import { ISkillResolver } from '../interfaces/index.js';
import { InstalledPluginInfo } from '../types.js';
import { checkSkillSchema, CheckSkillInput } from '../schemas.js';

// 重新导出 schemas 供 index.ts 使用
export { checkSkillSchema, checkMultipleSkillsSchema } from '../schemas.js';

// 响应类型
interface CheckSkillResponse {
  status: 'installed' | 'available' | 'not_found';
  plugin_id?: string;
  plugin?: {
    id: string;
    name: string;
    description: string;
    version?: string;
  };
  message: string;
  ready?: boolean;
  action_required?: 'confirm_install';
}

/**
 * 检查技能是否可用
 */
export async function checkSkill(
  input: CheckSkillInput,
  skillResolver: ISkillResolver,
  installedPlugins: InstalledPluginInfo[]
): Promise<CheckSkillResponse> {
  const { skill_name, skill_description } = input;

  // 使用技能解析器
  const result = await skillResolver.resolve(skill_name, installedPlugins);

  if (result.status === 'installed') {
    return {
      status: 'installed',
      plugin_id: result.pluginId,
      message: result.message,
      ready: true
    };
  }

  if (result.status === 'available' && result.pluginInfo) {
    return {
      status: 'available',
      plugin: {
        id: result.pluginInfo.id,
        name: result.pluginInfo.name,
        description: result.pluginInfo.description,
        version: result.pluginInfo.version
      },
      message: result.message,
      action_required: 'confirm_install'
    };
  }

  return {
    status: 'not_found',
    message: result.message
  };
}
