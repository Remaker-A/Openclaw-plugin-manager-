#!/usr/bin/env node

/**
 * OpenClaw 插件管理器 MCP 一键集成脚本
 *
 * 功能：
 * 1. 将 plugin-manager-mcp 安装到 OpenClaw 扩展目录
 * 2. 创建 openclaw.plugin.json 清单文件
 * 3. 更新 OpenClaw 主配置
 * 4. 注册 MCP 服务器
 */

import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const homeDir = os.homedir();
const openclawDir = path.join(homeDir, '.openclaw');
const extensionsDir = path.join(openclawDir, 'extensions');
const mainConfigPath = path.join(openclawDir, 'openclaw.json');
const pluginsJsonPath = path.join(openclawDir, 'plugins.json');

// 插件信息
const PLUGIN_ID = 'plugin-manager-mcp';
const PLUGIN_NAME = 'OpenClaw 插件管理器';
const PLUGIN_VERSION = '1.0.0';

// MCP 服务器配置
const MCP_SERVER_CONFIG = {
  "command": "node",
  "args": [path.join(extensionsDir, PLUGIN_ID, 'dist', 'index.js')],
  "env": {}
};

async function main() {
  console.log('========================================');
  console.log('OpenClaw 插件管理器 MCP 一键集成');
  console.log('========================================\n');

  try {
    // 1. 检查当前目录是否是 plugin-manager-mcp
    const currentDir = process.cwd();
    const packageJsonPath = path.join(currentDir, 'package.json');

    if (!await fs.pathExists(packageJsonPath)) {
      console.error('❌ 请在 plugin-manager-mcp 项目目录下运行此脚本');
      process.exit(1);
    }

    const packageJson = await fs.readJson(packageJsonPath);
    if (packageJson.name !== 'openclaw-plugin-manager' && packageJson.name !== '@openclaw/plugin-manager-mcp') {
      console.error('❌ 当前目录不是 plugin-manager-mcp 项目');
      process.exit(1);
    }

    console.log('✅ 检测到 plugin-manager-mcp 项目\n');

    // 2. 确保已构建
    const distPath = path.join(currentDir, 'dist');
    if (!await fs.pathExists(distPath)) {
      console.log('📦 正在构建项目...');
      execSync('npm run build', { stdio: 'inherit' });
      console.log('✅ 构建完成\n');
    } else {
      console.log('✅ 构建产物已存在\n');
    }

    // 3. 创建扩展目录
    const targetDir = path.join(extensionsDir, PLUGIN_ID);
    console.log('📁 创建扩展目录:', targetDir);
    await fs.ensureDir(targetDir);

    // 4. 复制必要文件
    console.log('📋 复制文件...');
    await fs.copy(distPath, path.join(targetDir, 'dist'), { overwrite: true });
    await fs.copy(path.join(currentDir, 'data'), path.join(targetDir, 'data'), { overwrite: true });
    await fs.copy(packageJsonPath, path.join(targetDir, 'package.json'), { overwrite: true });

    // 复制 node_modules（如果存在）
    const nodeModulesPath = path.join(currentDir, 'node_modules');
    if (await fs.pathExists(nodeModulesPath)) {
      console.log('📋 复制依赖（这可能需要一些时间）...');
      await fs.copy(nodeModulesPath, path.join(targetDir, 'node_modules'), { overwrite: true });
    }
    console.log('✅ 文件复制完成\n');

    // 5. 创建 openclaw.plugin.json
    const pluginManifest = {
      id: PLUGIN_ID,
      name: PLUGIN_NAME,
      version: PLUGIN_VERSION,
      description: 'OpenClaw 官方插件管理器，提供插件搜索、安装、更新、卸载等功能',
      skills: ['skills/plugin_manager'],
      configSchema: {
        type: 'object',
        properties: {
          cacheDuration: {
            type: 'number',
            description: '搜索缓存时长（毫秒）',
            default: 3600000
          },
          githubToken: {
            type: 'string',
            description: 'GitHub API Token（可选，提高搜索限额）'
          }
        }
      },
      mcp: MCP_SERVER_CONFIG
    };

    const manifestPath = path.join(targetDir, 'openclaw.plugin.json');
    await fs.writeJson(manifestPath, pluginManifest, { spaces: 2 });
    console.log('✅ 创建插件清单:', manifestPath, '\n');

    // 6. 更新 plugins.json
    let pluginsJson = { version: '1.0', plugins: [], lastUpdated: new Date().toISOString() };
    if (await fs.pathExists(pluginsJsonPath)) {
      pluginsJson = await fs.readJson(pluginsJsonPath);
    }

    if (!pluginsJson.plugins) {
      pluginsJson.plugins = [];
    }

    // 检查是否已存在
    const existingIndex = pluginsJson.plugins.findIndex((p: any) => p.id === PLUGIN_ID);
    const pluginEntry = {
      id: PLUGIN_ID,
      name: PLUGIN_NAME,
      version: PLUGIN_VERSION,
      enabled: true,
      installPath: targetDir,
      installedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      pluginsJson.plugins[existingIndex] = pluginEntry;
    } else {
      pluginsJson.plugins.push(pluginEntry);
    }
    pluginsJson.lastUpdated = new Date().toISOString();

    await fs.writeJson(pluginsJsonPath, pluginsJson, { spaces: 2 });
    console.log('✅ 更新 plugins.json\n');

    // 7. 更新主配置
    if (await fs.pathExists(mainConfigPath)) {
      const mainConfig = await fs.readJson(mainConfigPath);

      if (!mainConfig.plugins) {
        mainConfig.plugins = { entries: {} };
      }
      if (!mainConfig.plugins.entries) {
        mainConfig.plugins.entries = {};
      }

      mainConfig.plugins.entries[PLUGIN_ID] = { enabled: true };

      // 添加 MCP 服务器配置
      if (!mainConfig.mcpServers) {
        mainConfig.mcpServers = {};
      }
      mainConfig.mcpServers[PLUGIN_ID] = MCP_SERVER_CONFIG;

      await fs.writeJson(mainConfigPath, mainConfig, { spaces: 2 });
      console.log('✅ 更新主配置文件:', mainConfigPath, '\n');
    }

    // 8. 创建技能目录和 SKILL.md
    const skillsDir = path.join(targetDir, 'skills', 'plugin_manager');
    await fs.ensureDir(skillsDir);

    const skillMd = `# Plugin Manager Skill

提供 OpenClaw 插件管理能力，包括搜索、安装、更新、卸载插件等功能。

## Tools

### plugin_check_skill
检查技能是否可用，返回 installed/available/not_found 状态。

**Parameters:**
- skill_name: 技能名称或关键词 (required)
- skill_description: 技能描述 (optional)

### plugin_install
一键安装插件，自动配置并刷新技能缓存。

**Parameters:**
- plugin_id: 插件ID (required)
- auto_configure: 是否自动配置默认值 (default: true)

### plugin_search_market
搜索插件市场，支持 npm、GitHub、MCP Marketplace 多来源。

**Parameters:**
- keyword: 搜索关键词 (required)
- source: 搜索来源 (default: all)

### plugin_list_installed
列出已安装的插件及其状态。

### plugin_auto_install
智能检测技能并自动安装对应插件。

**Parameters:**
- skill_name: 技能名称 (required)
- auto_confirm: 是否自动确认安装 (default: false)

### plugin_uninstall
卸载已安装的插件。

**Parameters:**
- plugin_id: 要卸载的插件ID (required)

### plugin_check_updates
检查已安装插件是否有新版本。

### plugin_refresh_skills
刷新技能缓存。
`;

    await fs.writeFile(path.join(skillsDir, 'SKILL.md'), skillMd);
    console.log('✅ 创建技能文件:', path.join(skillsDir, 'SKILL.md'), '\n');

    // 9. 完成
    console.log('========================================');
    console.log('✅ 集成完成！');
    console.log('========================================\n');

    console.log('安装位置:', targetDir);
    console.log('\n可用工具:');
    console.log('  - plugin_check_skill');
    console.log('  - plugin_install');
    console.log('  - plugin_uninstall');
    console.log('  - plugin_search_market');
    console.log('  - plugin_list_installed');
    console.log('  - plugin_refresh_skills');
    console.log('  - plugin_auto_install');
    console.log('  - plugin_check_multiple_skills');
    console.log('  - plugin_status_summary');
    console.log('  - plugin_check_updates');
    console.log('  - plugin_install_progress');
    console.log('\n重启 OpenClaw 后即可使用插件管理功能！');

  } catch (error) {
    console.error('❌ 集成失败:', error);
    process.exit(1);
  }
}

main();
