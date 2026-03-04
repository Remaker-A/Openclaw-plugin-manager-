/**
 * plugin_install 工具
 * 一键安装插件
 *
 * 集成方案:
 * 1. 优先使用官方 @openclaw/config-tool 的 PluginManager
 * 2. 备选使用本地 PluginInstaller 实现
 * 3. 支持调用 openclaw CLI 命令
 */

import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { IMarketService, IPluginInstaller } from '../interfaces/index.js';
import { PluginInstaller } from '../services/plugin-installer.js';
import { ExternalMarketService } from '../services/external-market-service.js';
import { logger } from '../utils/logger.js';
import { writeSecureConfig, readSecureConfig, encryptConfig, CONFIG_FILE_MODE } from '../utils/encryption.js';
import {
  installSchema,
  uninstallSchema,
  InstallInput,
  UninstallInput
} from '../schemas.js';
import {
  MarketPlugin,
  PluginManifest,
  InstalledPluginRecord
} from '../types.js';

// 重新导出 schemas 供 index.ts 使用
export { installSchema, uninstallSchema } from '../schemas.js';

// 默认值
const DEFAULT_INSTALL_OPTIONS = {
  auto_configure: true,
  use_cli: false,
  verbose: false,
  force: false
};

// 响应类型
interface InstallResponse {
  status: 'success' | 'error';
  plugin_id?: string;
  message: string;
  skills?: string[];
  ready?: boolean;
  installPath?: string;
  error?: string;
}

// 官方 PluginManager 接口 (动态导入)
interface OfficialPluginManager {
  install(source: string, options?: any): Promise<{ installPath: string }>;
  uninstall(pluginId: string): Promise<void>;
  list(): Promise<any[]>;
}

// 全局安装器实例
let installerInstance: PluginInstaller | null = null;

/**
 * 获取 PluginInstaller 实例
 */
function getInstaller(verbose: boolean = false): PluginInstaller {
  if (!installerInstance) {
    installerInstance = new PluginInstaller({ verbose });
  }
  return installerInstance;
}

/**
 * 安装插件
 */
export async function installPlugin(
  input: Partial<InstallInput> & { plugin_id: string },
  marketService: IMarketService,
  officialManager?: OfficialPluginManager | null
): Promise<InstallResponse> {
  const { plugin_id, auto_configure, use_cli, verbose, force } = {
    ...DEFAULT_INSTALL_OPTIONS,
    ...input
  };

  try {
    // 1. 从市场获取插件信息
    logger.installTool.info(`正在获取插件信息: ${plugin_id}...`);
    let pluginInfo = await marketService.getPluginById(plugin_id);

    // 如果本地市场没找到，尝试从外部市场获取 (npm/GitHub/MCP Marketplace)
    if (!pluginInfo) {
      logger.installTool.info(`本地市场未找到插件，尝试从外部市场获取: ${plugin_id}...`);
      const externalMarket = new ExternalMarketService();
      const externalPlugin = await externalMarket.getPluginDetails(plugin_id);

      if (externalPlugin) {
        // 将 ExternalPlugin 转换为 MarketPlugin 兼容格式
        // 处理版本号：如果是 "latest" 或无效版本，使用默认版本号
        let version = externalPlugin.version;
        if (!version || version === 'latest' || version === '*' || !/^\d/.test(version)) {
          version = '0.0.1';
        }

        pluginInfo = {
          id: externalPlugin.id,
          name: externalPlugin.name,
          description: externalPlugin.description,
          version: version,
          source: externalPlugin.source,
          skills: externalPlugin.skills,
          author: externalPlugin.author,
          tags: externalPlugin.tags,
          auto_config: externalPlugin.auto_config,
          default_config: externalPlugin.default_config,
          configSchema: externalPlugin.configSchema
        };
        logger.installTool.info(`从外部市场获取到插件: ${pluginInfo.name}`);
      }
    }

    if (!pluginInfo) {
      return {
        status: 'error',
        plugin_id,
        message: `[InstallTool] 未找到插件: ${plugin_id}`,
        error: 'PLUGIN_NOT_FOUND'
      };
    }

    // 2. 检查是否已安装
    const installed = await getInstalledPluginRecord(plugin_id);
    if (installed && !force) {
      return {
        status: 'success',
        plugin_id,
        message: `${pluginInfo.name} 已安装`,
        skills: pluginInfo.skills,
        ready: true,
        installPath: installed.installPath
      };
    }

    // 3. 如果强制重装，先卸载
    if (installed && force) {
      logger.installTool.info(`强制重装: 先卸载已存在的插件...`);
      const uninstaller = new PluginInstaller();
      await uninstaller.uninstall(plugin_id);
    }

    // 4. 执行安装 - 支持多种方式
    let installPath = '';
    let manifest: PluginManifest | undefined;

    // 方式1: 尝试使用 openclaw CLI
    if (use_cli) {
      const cliResult = await installViaCLI(pluginInfo);
      if (cliResult.success) {
        installPath = cliResult.installPath || '';
      } else {
        logger.installTool.warn(`CLI 安装失败，尝试其他方式: ${cliResult.error}`);
      }
    }

    // 方式2: 尝试使用官方 PluginManager
    if (!installPath && officialManager) {
      const source = resolveSource(pluginInfo);
      try {
        logger.installTool.info('尝试使用官方 PluginManager...');
        const entry = await officialManager.install(source, {
          force: false,
          noDeps: false,
          verbose: true
        });
        installPath = entry?.installPath || '';
      } catch (error) {
        logger.installTool.warn(`官方 PluginManager 安装失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 方式3: 使用本地 PluginInstaller
    if (!installPath) {
      logger.installTool.info(`使用本地安装器安装: ${pluginInfo.name}...`);
      const installer = getInstaller(verbose);
      const result = await installer.install(pluginInfo);

      if (!result.success) {
        return {
          status: 'error',
          plugin_id,
          message: `[InstallTool] 安装失败: ${result.error}`,
          error: 'INSTALL_FAILED'
        };
      }

      installPath = result.installPath!;
      manifest = result.manifest;
    }

    // 5. 读取插件清单（如果没有）
    if (!manifest && installPath) {
      manifest = await readPluginManifest(installPath);
    }

    // 6. 更新已安装插件记录
    const installedRecord: InstalledPluginRecord = {
      id: pluginInfo.id,
      name: manifest?.name || pluginInfo.name,
      version: manifest?.version || pluginInfo.version,
      description: manifest?.description || pluginInfo.description,
      status: 'enabled',
      installPath: installPath,
      installedAt: new Date().toISOString(),
      skills: manifest?.skills || pluginInfo.skills,
      config: auto_configure ? pluginInfo.default_config : undefined,
      manifest
    };

    await updateInstalledPluginsRecord(installedRecord);

    // 7. 应用默认配置
    if (auto_configure && pluginInfo.default_config) {
      await applyDefaultConfig(pluginInfo.id, pluginInfo.default_config, installPath);
    }

    // 8. 更新主配置文件
    await updateMainConfig(plugin_id);

    logger.installTool.info(`安装成功: ${pluginInfo.name}`);

    return {
      status: 'success',
      plugin_id,
      message: `${installedRecord.name} 安装成功`,
      skills: installedRecord.skills,
      ready: true,
      installPath
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.installTool.error(`安装失败: ${errorMessage}`);

    return {
      status: 'error',
      plugin_id,
      message: `[InstallTool] 安装失败: ${errorMessage}`,
      error: 'INSTALL_FAILED'
    };
  }
}

/**
 * 解析安装源
 */
function resolveSource(pluginInfo: any): string {
  const { source } = pluginInfo;

  if (source.type === 'local' && source.path) {
    return source.path;
  }

  if (source.type === 'git' && source.url) {
    return source.url;
  }

  if (source.type === 'npm') {
    return source.url || pluginInfo.id;
  }

  return pluginInfo.id;
}

/**
 * 通过 CLI 安装
 */
async function installViaCLI(pluginInfo: any): Promise<{ success: boolean; installPath?: string; error?: string }> {
  try {
    // 动态导入 execSync
    const { execSync } = await import('child_process');

    // 检查 openclaw CLI 是否可用
    try {
      execSync('openclaw --version', { stdio: 'pipe' });
    } catch {
      return { success: false, error: '[InstallTool] openclaw CLI 未安装' };
    }

    const source = resolveSource(pluginInfo);
    const command = `openclaw plugins install "${source}"`;

    logger.installTool.info(`执行 CLI 命令: ${command}`);
    execSync(command, { stdio: 'inherit' });

    // 获取安装路径
    const homeDir = os.homedir();
    const installPath = path.join(homeDir, '.openclaw', 'extensions', pluginInfo.id);

    return { success: true, installPath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * 读取插件清单
 */
async function readPluginManifest(installPath: string): Promise<PluginManifest | undefined> {
  const manifestPath = path.join(installPath, 'openclaw.plugin.json');

  try {
    if (await fs.pathExists(manifestPath)) {
      return await fs.readJson(manifestPath);
    }
  } catch (error) {
    logger.installTool.warn(`读取插件清单失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  return undefined;
}

/**
 * 卸载插件
 */
export async function uninstallPlugin(
  pluginId: string,
  officialManager?: OfficialPluginManager | null
): Promise<InstallResponse> {
  try {
    // 1. 检查是否已安装
    const installed = await getInstalledPluginRecord(pluginId);
    if (!installed) {
      return {
        status: 'error',
        plugin_id: pluginId,
        message: `[InstallTool] 插件未安装: ${pluginId}`,
        error: 'PLUGIN_NOT_INSTALLED'
      };
    }

    // 2. 尝试使用官方 PluginManager 卸载
    if (officialManager) {
      try {
        await officialManager.uninstall(pluginId);
      } catch (error) {
        logger.installTool.warn(`官方 PluginManager 卸载失败，回退到本地卸载: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 3. 使用本地卸载
    const installer = getInstaller();
    const result = await installer.uninstall(pluginId);

    if (!result.success) {
      return {
        status: 'error',
        plugin_id: pluginId,
        message: `[InstallTool] 卸载失败: ${result.error}`,
        error: 'UNINSTALL_FAILED'
      };
    }

    // 4. 从记录中移除
    await removeInstalledPluginRecord(pluginId);

    // 5. 更新主配置
    await removeFromMainConfig(pluginId);

    return {
      status: 'success',
      plugin_id: pluginId,
      message: `${installed.name} 已卸载`,
      ready: false
    };
  } catch (error) {
    return {
      status: 'error',
      plugin_id: pluginId,
      message: `[InstallTool] 卸载失败: ${error instanceof Error ? error.message : String(error)}`,
      error: 'UNINSTALL_FAILED'
    };
  }
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
 * 更新已安装插件记录文件
 * 设置文件权限为 600 (仅所有者可读写)
 */
export async function updateInstalledPluginsRecord(plugin: InstalledPluginRecord): Promise<void> {
  const installedPath = getInstalledPluginsPath();

  try {
    // 确保目录存在
    await fs.ensureDir(path.dirname(installedPath));

    // 读取现有记录
    let records: InstalledPluginRecord[] = [];
    if (await fs.pathExists(installedPath)) {
      const data = await fs.readJson(installedPath);
      records = data.plugins || [];
    }

    // 检查是否已存在，存在则更新
    const existingIndex = records.findIndex(r => r.id === plugin.id);
    if (existingIndex >= 0) {
      records[existingIndex] = plugin;
    } else {
      records.push(plugin);
    }

    // 保存记录
    await fs.writeJson(installedPath, {
      version: '2.0',
      lastUpdated: new Date().toISOString(),
      plugins: records
    }, { spaces: 2 });

    // 设置文件权限
    await setSecureFilePermission(installedPath);

    logger.installTool.info(`已更新插件记录: ${plugin.id}`);
  } catch (error) {
    logger.installTool.error(`更新插件记录失败: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * 获取单个已安装插件记录
 */
async function getInstalledPluginRecord(pluginId: string): Promise<InstalledPluginRecord | null> {
  const plugins = await getInstalledPlugins();
  return plugins.find(p => p.id === pluginId) || null;
}

/**
 * 从记录中移除插件
 * 设置文件权限为 600 (仅所有者可读写)
 */
async function removeInstalledPluginRecord(pluginId: string): Promise<void> {
  const installedPath = getInstalledPluginsPath();

  try {
    if (!(await fs.pathExists(installedPath))) {
      return;
    }

    const data = await fs.readJson(installedPath);
    const records: InstalledPluginRecord[] = (data.plugins || []).filter((p: InstalledPluginRecord) => p.id !== pluginId);

    await fs.writeJson(installedPath, {
      version: '2.0',
      lastUpdated: new Date().toISOString(),
      plugins: records
    }, { spaces: 2 });

    // 设置文件权限
    await setSecureFilePermission(installedPath);

    logger.installTool.info(`已移除插件记录: ${pluginId}`);
  } catch (error) {
    logger.installTool.error(`移除插件记录失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 应用默认配置
 * 使用加密存储保护敏感配置字段
 */
export async function applyDefaultConfig(
  pluginId: string,
  config: Record<string, any>,
  installPath: string
): Promise<void> {
  const homeDir = os.homedir();

  // 1. 写入插件目录的 config.json (使用加密存储)
  const pluginConfigPath = path.join(installPath, 'config.json');
  try {
    await writeSecureConfig(pluginConfigPath, config);
    logger.installTool.info(`已应用插件目录配置 (已加密敏感字段): ${pluginId}`);
  } catch (error) {
    logger.installTool.warn(`写入插件目录配置失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 2. 同时写入 extensions/<pluginId>/config.json (使用加密存储)
  const extConfigPath = path.join(homeDir, '.openclaw', 'extensions', pluginId, 'config.json');

  try {
    await fs.ensureDir(path.dirname(extConfigPath));
    await writeSecureConfig(extConfigPath, config);
    logger.installTool.info(`已应用扩展目录配置 (已加密敏感字段): ${pluginId}`);
  } catch (error) {
    logger.installTool.warn(`应用扩展目录配置失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 更新主配置文件
 * OpenClaw 的 plugins.entries 格式为: { "plugin-id": { "enabled": true } }
 * 设置文件权限为 600 (仅所有者可读写)
 */
export async function updateMainConfig(pluginId: string): Promise<void> {
  const homeDir = os.homedir();
  const mainConfigPath = path.join(homeDir, '.openclaw', 'openclaw.json');

  try {
    if (!(await fs.pathExists(mainConfigPath))) {
      // 创建默认配置
      await fs.writeJson(mainConfigPath, {
        version: '1.0',
        plugins: {
          entries: {
            [pluginId]: { enabled: true }
          }
        }
      }, { spaces: 2 });
      // 设置文件权限
      await setSecureFilePermission(mainConfigPath);
      return;
    }

    const config = await fs.readJson(mainConfigPath);

    // 更新插件列表 - entries 是对象格式
    if (!config.plugins) {
      config.plugins = { entries: {} };
    }
    if (!config.plugins.entries) {
      config.plugins.entries = {};
    }

    // 添加或更新插件条目
    config.plugins.entries[pluginId] = { enabled: true };

    await fs.writeJson(mainConfigPath, config, { spaces: 2 });
    // 设置文件权限
    await setSecureFilePermission(mainConfigPath);
    logger.installTool.info('已更新主配置文件');
  } catch (error) {
    logger.installTool.warn(`更新主配置文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 从主配置中移除插件
 * OpenClaw 的 plugins.entries 格式为: { "plugin-id": { "enabled": true } }
 * 设置文件权限为 600 (仅所有者可读写)
 */
async function removeFromMainConfig(pluginId: string): Promise<void> {
  const homeDir = os.homedir();
  const mainConfigPath = path.join(homeDir, '.openclaw', 'openclaw.json');

  try {
    if (!(await fs.pathExists(mainConfigPath))) {
      return;
    }

    const config = await fs.readJson(mainConfigPath);

    // entries 是对象格式，使用 delete 操作符移除
    if (config.plugins?.entries && typeof config.plugins.entries === 'object') {
      if (config.plugins.entries[pluginId]) {
        delete config.plugins.entries[pluginId];
        await fs.writeJson(mainConfigPath, config, { spaces: 2 });
        // 设置文件权限
        await setSecureFilePermission(mainConfigPath);
        logger.installTool.info('已从主配置中移除插件');
      }
    }
  } catch (error) {
    logger.installTool.warn(`更新主配置文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 获取已安装插件记录路径
 */
function getInstalledPluginsPath(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.openclaw', 'extensions', 'installed_plugins.json');
}

/**
 * 获取已安装插件记录
 */
export async function getInstalledPlugins(): Promise<InstalledPluginRecord[]> {
  const installedPath = getInstalledPluginsPath();

  try {
    if (await fs.pathExists(installedPath)) {
      const data = await fs.readJson(installedPath);
      return data.plugins || [];
    }
    return [];
  } catch (error) {
    logger.installTool.warn(`读取已安装插件记录失败: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
