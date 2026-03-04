/**
 * 服务容器
 * 实现依赖注入模式，管理服务实例的生命周期
 */

import { IMarketService, IExternalMarketService, ISkillResolver, IPluginInstaller, IPluginRegistry } from './interfaces/index.js';
import { MarketService } from './services/market-service.js';
import { ExternalMarketService } from './services/external-market-service.js';
import { SkillResolver } from './services/skill-resolver.js';
import { PluginInstaller } from './services/plugin-installer.js';
import { InstalledPluginInfo } from './services/skill-resolver.js';
import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { logger } from './utils/logger.js';
import { CONFIG_FILE_MODE } from './utils/encryption.js';

// 服务标识符
export type ServiceIdentifier =
  | 'marketService'
  | 'externalMarketService'
  | 'skillResolver'
  | 'pluginInstaller'
  | 'pluginRegistry';

// 安装器配置
export interface PluginInstallerConfig {
  verbose?: boolean;
  gitTimeout?: number;
}

// 容器配置
export interface ServiceContainerConfig {
  marketApiUrl?: string;
  pluginInstaller?: PluginInstallerConfig;
}

/**
 * 服务容器
 * 单例模式，管理所有服务实例
 */
export class ServiceContainer {
  private static instance: ServiceContainer | null = null;
  private services: Map<ServiceIdentifier, any> = new Map();
  private config: ServiceContainerConfig;

  private constructor(config: ServiceContainerConfig = {}) {
    this.config = config;
  }

  /**
   * 获取容器单例实例
   */
  static getInstance(config?: ServiceContainerConfig): ServiceContainer {
    if (!ServiceContainer.instance) {
      ServiceContainer.instance = new ServiceContainer(config);
    }
    return ServiceContainer.instance;
  }

  /**
   * 重置容器（用于测试）
   */
  static reset(): void {
    if (ServiceContainer.instance) {
      ServiceContainer.instance.services.clear();
      ServiceContainer.instance = null;
    }
  }

  /**
   * 注册服务实例
   * @param identifier 服务标识符
   * @param instance 服务实例
   */
  register<T>(identifier: ServiceIdentifier, instance: T): void {
    this.services.set(identifier, instance);
  }

  /**
   * 获取市场服务
   */
  getMarketService(): IMarketService {
    if (!this.services.has('marketService')) {
      const service = new MarketService(this.config.marketApiUrl);
      this.services.set('marketService', service);
    }
    return this.services.get('marketService');
  }

  /**
   * 获取外部市场服务
   */
  getExternalMarketService(): IExternalMarketService {
    if (!this.services.has('externalMarketService')) {
      const service = new ExternalMarketService();
      this.services.set('externalMarketService', service);
    }
    return this.services.get('externalMarketService');
  }

  /**
   * 获取技能解析服务
   */
  getSkillResolver(): ISkillResolver {
    if (!this.services.has('skillResolver')) {
      const marketService = this.getMarketService();
      const service = new SkillResolver(marketService as MarketService);
      this.services.set('skillResolver', service);
    }
    return this.services.get('skillResolver');
  }

  /**
   * 获取插件安装器
   */
  getPluginInstaller(): IPluginInstaller {
    if (!this.services.has('pluginInstaller')) {
      const service = new PluginInstaller(this.config.pluginInstaller);
      this.services.set('pluginInstaller', service);
    }
    return this.services.get('pluginInstaller');
  }

  /**
   * 获取插件注册表
   */
  getPluginRegistry(): IPluginRegistry {
    if (!this.services.has('pluginRegistry')) {
      const service = new PluginRegistryImpl();
      this.services.set('pluginRegistry', service);
    }
    return this.services.get('pluginRegistry');
  }

  /**
   * 检查服务是否已注册
   */
  has(identifier: ServiceIdentifier): boolean {
    return this.services.has(identifier);
  }

  /**
   * 清除所有服务实例
   */
  clear(): void {
    this.services.clear();
  }
}

/**
 * 插件注册表实现
 */
class PluginRegistryImpl implements IPluginRegistry {
  private installedPluginsPath: string;

  constructor() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    this.installedPluginsPath = path.join(homeDir, '.openclaw', 'extensions', 'installed_plugins.json');
  }

  async list(): Promise<InstalledPluginInfo[]> {
    try {
      if (await fs.pathExists(this.installedPluginsPath)) {
        const data = await fs.readJson(this.installedPluginsPath);
        return data.plugins || [];
      }
      return [];
    } catch (error) {
      logger.general.warn(`读取已安装插件记录失败: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  async get(pluginId: string): Promise<InstalledPluginInfo | undefined> {
    const plugins = await this.list();
    return plugins.find(p => p.id === pluginId);
  }

  async update(plugin: InstalledPluginInfo): Promise<void> {
    const plugins = await this.list();
    const existingIndex = plugins.findIndex(p => p.id === plugin.id);

    if (existingIndex >= 0) {
      plugins[existingIndex] = plugin;
    } else {
      plugins.push(plugin);
    }

    await fs.ensureDir(path.dirname(this.installedPluginsPath));
    await fs.writeJson(this.installedPluginsPath, {
      version: '2.0',
      lastUpdated: new Date().toISOString(),
      plugins
    }, { spaces: 2 });

    // 设置文件权限
    await this.setSecureFilePermission();
  }

  async remove(pluginId: string): Promise<void> {
    const plugins = await this.list();
    const filtered = plugins.filter(p => p.id !== pluginId);

    await fs.ensureDir(path.dirname(this.installedPluginsPath));
    await fs.writeJson(this.installedPluginsPath, {
      version: '2.0',
      lastUpdated: new Date().toISOString(),
      plugins: filtered
    }, { spaces: 2 });

    // 设置文件权限
    await this.setSecureFilePermission();
  }

  /**
   * 设置配置文件权限 (仅所有者可读写)
   */
  private async setSecureFilePermission(): Promise<void> {
    try {
      await fs.chmod(this.installedPluginsPath, CONFIG_FILE_MODE);
    } catch {
      // Windows 系统可能不支持 chmod，忽略错误
    }
  }
}

/**
 * 创建默认容器实例
 */
export function createContainer(config?: ServiceContainerConfig): ServiceContainer {
  return ServiceContainer.getInstance(config);
}

/**
 * 获取默认容器实例
 */
export function getDefaultContainer(): ServiceContainer {
  return ServiceContainer.getInstance();
}
