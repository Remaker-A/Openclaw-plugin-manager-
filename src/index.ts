#!/usr/bin/env node

/**
 * OpenClaw 插件管理器 MCP 服务器
 * 提供插件检查、安装、技能刷新等工具
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ServiceContainer, getDefaultContainer } from './container.js';
import { ISkillResolver, IMarketService, IPluginRegistry } from './interfaces/index.js';
import { logger } from './utils/logger.js';

import { checkSkillSchema, checkSkill } from './tools/check-skill.js';
import { installSchema, installPlugin, uninstallSchema, uninstallPlugin, getInstalledPlugins } from './tools/install.js';
import { searchMarketSchema, searchMarket } from './tools/search-market.js';
import { listInstalledSchema, listInstalled } from './tools/list-installed.js';
import { refreshSkillsSchema, refreshSkills } from './tools/refresh-skills.js';
import { autoInstallSchema, autoInstallSkill, checkMultipleSkillsSchema, checkMultipleSkills, getSkillStatusSummary } from './tools/auto-install.js';
import { checkUpdatesSchema, checkUpdates } from './tools/check-updates.js';
import { installProgressSchema, installWithProgress } from './tools/install-progress.js';

// 从服务容器获取服务实例
const container = getDefaultContainer();
const marketService: IMarketService = container.getMarketService();
const skillResolver: ISkillResolver = container.getSkillResolver();
const pluginRegistry: IPluginRegistry = container.getPluginRegistry();

// 创建 MCP 服务器
const server = new Server(
  {
    name: 'openclaw-plugin-manager',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 工具列表定义
const TOOLS = [
  {
    name: 'plugin_check_skill',
    description: `检查技能是否可用。

返回状态:
- installed: 技能已就绪，可直接使用
- available: 市场有对应插件，需要安装
- not_found: 未找到相关插件

使用场景: 当 OpenClaw 需要某个功能时，先调用此工具检查技能状态。`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        skill_name: {
          type: 'string',
          description: '技能名称或关键词，如 "web_search"、"小红书搜索"、"翻译"',
        },
        skill_description: {
          type: 'string',
          description: '技能描述（可选）',
        },
      },
      required: ['skill_name'],
    },
  },
  {
    name: 'plugin_install',
    description: `一键安装插件。

从市场获取插件信息，安装插件，应用默认配置，并返回技能列表。
安装完成后会自动刷新技能缓存，立即可用。`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        plugin_id: {
          type: 'string',
          description: '插件ID，如 "web-search"、"xiaohongshu-mcp"',
        },
        auto_configure: {
          type: 'boolean',
          description: '是否自动配置默认值',
          default: true,
        },
      },
      required: ['plugin_id'],
    },
  },
  {
    name: 'plugin_search_market',
    description: `搜索插件市场。

支持多个搜索来源:
- local: 本地市场数据
- npm: npm 仓库
- github: GitHub 仓库
- mcp-marketplace: MCP 官方市场
- all: 全部来源（默认）

返回匹配的插件列表，包含安装状态。`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        keyword: {
          type: 'string',
          description: '搜索关键词',
        },
        source: {
          type: 'string',
          enum: ['local', 'npm', 'github', 'mcp-marketplace', 'all'],
          description: '搜索来源',
          default: 'all',
        },
        include_installed: {
          type: 'boolean',
          description: '是否包含已安装插件',
          default: true,
        },
        refresh: {
          type: 'boolean',
          description: '是否强制刷新缓存',
          default: false,
        },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'plugin_list_installed',
    description: '列出已安装的插件及其状态。',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'plugin_refresh_skills',
    description: `刷新技能缓存。

在以下情况需要调用:
- 安装新插件后
- 启用/禁用插件后
- 插件配置变更后

让 OpenClaw 识别最新的技能状态。`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        plugin_id: {
          type: 'string',
          description: '指定插件ID，只刷新该插件的技能（可选，不指定则刷新全部）',
        },
      },
    },
  },
  {
    name: 'plugin_auto_install',
    description: `自动检测技能并安装插件。

工作流程:
1. 检查技能是否已安装 -> 返回 installed
2. 市场有对应插件 -> 返回 confirmation_required（需用户确认）
3. 用户确认后安装 -> 返回 installed

参数:
- auto_confirm: 设为 true 可跳过确认直接安装
- auto_configure: 是否自动配置默认值

这是最智能的安装方式，推荐使用。`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        skill_name: {
          type: 'string',
          description: '技能名称或关键词',
        },
        auto_confirm: {
          type: 'boolean',
          description: '是否自动确认安装（不询问用户）',
          default: false,
        },
        auto_configure: {
          type: 'boolean',
          description: '是否自动配置默认值',
          default: true,
        },
      },
      required: ['skill_name'],
    },
  },
  {
    name: 'plugin_check_multiple_skills',
    description: `批量检查多个技能的状态。

一次性检查多个技能，返回分类结果:
- installed: 已安装
- available: 可安装
- not_found: 未找到`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        skills: {
          type: 'array',
          items: { type: 'string' },
          description: '技能名称列表',
        },
      },
      required: ['skills'],
    },
  },
  {
    name: 'plugin_status_summary',
    description: '获取插件系统状态摘要，包括技能映射数量、已安装插件数量等。',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'plugin_uninstall',
    description: `卸载已安装的插件。

功能:
- 从扩展目录移除插件文件
- 从已安装记录中删除
- 更新主配置文件
- 清理技能缓存

注意: 卸载后相关技能将不再可用。`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        plugin_id: {
          type: 'string',
          description: '要卸载的插件ID',
        },
      },
      required: ['plugin_id'],
    },
  },
  {
    name: 'plugin_check_updates',
    description: `检查已安装插件是否有新版本可用。

检查来源:
- npm: npm 仓库
- github: GitHub Releases
- market: 本地市场数据
- all: 全部来源（默认）

返回每个插件的当前版本和最新版本信息。`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        plugin_id: {
          type: 'string',
          description: '指定插件ID，不指定则检查所有已安装插件',
        },
        source: {
          type: 'string',
          enum: ['npm', 'github', 'market', 'all'],
          description: '检查来源',
          default: 'all',
        },
        include_prerelease: {
          type: 'boolean',
          description: '是否包含预发布版本',
          default: false,
        },
      },
    },
  },
  {
    name: 'plugin_install_progress',
    description: `带详细进度反馈的插件安装。

返回每个安装步骤的详细信息:
- 步骤名称和状态
- 总体进度百分比 (0-100)
- 每个步骤的耗时
- 详细错误信息

安装步骤:
1. 初始化环境
2. 获取插件信息
3. 检查安装状态
4. 解析插件来源
5. 下载插件 (如需要)
6. 解压/链接插件
7. 验证插件完整性
8. 安装依赖
9. 应用配置
10. 注册插件
11. 刷新技能缓存

适用于需要了解安装详细进度的场景。`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        plugin_id: {
          type: 'string',
          description: '插件ID',
        },
        auto_configure: {
          type: 'boolean',
          description: '是否自动配置默认值',
          default: true,
        },
        verbose: {
          type: 'boolean',
          description: '是否返回详细进度',
          default: true,
        },
        force: {
          type: 'boolean',
          description: '强制重新安装',
          default: false,
        },
      },
      required: ['plugin_id'],
    },
  },
];

// 注册工具列表处理器
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// 注册工具调用处理器
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // 初始化服务
    await skillResolver.initialize();

    // 获取已安装插件
    const installedPlugins = await getInstalledPlugins();

    switch (name) {
      case 'plugin_check_skill': {
        const input = checkSkillSchema.parse(args);
        const result = await checkSkill(input, skillResolver, installedPlugins);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'plugin_install': {
        const input = installSchema.parse(args);
        // TODO: 集成真正的 PluginManager
        const result = await installPlugin(input, marketService, null);

        // 安装成功后刷新技能
        if (result.status === 'success') {
          await refreshSkills({ plugin_id: input.plugin_id });
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'plugin_search_market': {
        const input = searchMarketSchema.parse(args);
        const result = await searchMarket(input, marketService, installedPlugins);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'plugin_list_installed': {
        const input = listInstalledSchema.parse(args);
        const result = await listInstalled(input, pluginRegistry);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'plugin_refresh_skills': {
        const input = refreshSkillsSchema.parse(args);
        const result = await refreshSkills(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'plugin_auto_install': {
        const input = autoInstallSchema.parse(args);
        const result = await autoInstallSkill(input, skillResolver, marketService);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'plugin_check_multiple_skills': {
        const input = checkMultipleSkillsSchema.parse(args);
        const result = await checkMultipleSkills(input.skills, skillResolver);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'plugin_status_summary': {
        const result = await getSkillStatusSummary(skillResolver);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'plugin_uninstall': {
        const input = uninstallSchema.parse(args);
        const result = await uninstallPlugin(input.plugin_id);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'plugin_check_updates': {
        const input = checkUpdatesSchema.parse(args);
        const result = await checkUpdates(input, marketService);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'plugin_install_progress': {
        const input = installProgressSchema.parse(args);
        const result = await installWithProgress(input, marketService);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.core.info('OpenClaw Plugin Manager MCP Server started');
}

main().catch((error) => {
  logger.core.error(`Server error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
