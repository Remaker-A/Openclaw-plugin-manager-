/**
 * plugin_list_installed 工具
 * 列出已安装插件
 */

import { IPluginRegistry } from '../interfaces/index.js';
import { InstalledPluginInfo } from '../types.js';
import { logger } from '../utils/logger.js';
import { listInstalledSchema, ListInstalledInput } from '../schemas.js';

// 重新导出 schemas 供 index.ts 使用
export { listInstalledSchema } from '../schemas.js';

// 已安装插件信息
interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  status: string;
  description?: string;
  skills?: string[];
}

// 响应类型
interface ListInstalledResponse {
  status: 'success' | 'error';
  count: number;
  plugins: InstalledPlugin[];
  message?: string;
}

/**
 * 列出已安装插件
 */
export async function listInstalled(
  _input: ListInstalledInput,
  pluginRegistry: IPluginRegistry | null
): Promise<ListInstalledResponse> {
  try {
    let plugins: InstalledPlugin[] = [];

    if (pluginRegistry) {
      // 从注册表获取
      const registered: InstalledPluginInfo[] = await pluginRegistry.list();
      plugins = registered.map((p) => ({
        id: p.id,
        name: p.name,
        version: p.version,
        status: p.status,
        description: p.description,
        skills: p.skills || []
      }));
    } else {
      // 返回空列表
      logger.general.warn('PluginRegistry 不可用');
    }

    return {
      status: 'success',
      count: plugins.length,
      plugins,
      message: plugins.length > 0
        ? `已安装 ${plugins.length} 个插件`
        : '暂无已安装的插件'
    };
  } catch (error) {
    return {
      status: 'error',
      count: 0,
      plugins: [],
      message: `获取插件列表失败: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
