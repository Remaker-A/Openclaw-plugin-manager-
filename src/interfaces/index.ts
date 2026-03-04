/**
 * 服务接口定义
 * 定义依赖注入所需的服务抽象接口
 */

import { MarketPlugin } from '../services/market-service.js';
import { ExternalPlugin } from '../services/external-market-service.js';
import {
  SkillMapping,
  OfficialSkill,
  InstalledPluginInfo,
  SkillResolveResult
} from '../services/skill-resolver.js';
import { InstallResult, PluginManifest } from '../services/plugin-installer.js';

// ========== 市场服务接口 ==========

/**
 * 市场服务接口
 * 负责插件市场数据获取和缓存
 */
export interface IMarketService {
  /**
   * 获取所有插件列表
   * @param forceRefresh 是否强制刷新缓存
   */
  getPlugins(forceRefresh?: boolean): Promise<MarketPlugin[]>;

  /**
   * 根据 ID 获取插件详情
   * @param pluginId 插件ID
   * @param forceRefresh 是否强制刷新缓存
   */
  getPluginById(pluginId: string, forceRefresh?: boolean): Promise<MarketPlugin | null>;

  /**
   * 搜索插件
   * @param keyword 搜索关键词
   * @param forceRefresh 是否强制刷新缓存
   */
  searchPlugins(keyword: string, forceRefresh?: boolean): Promise<MarketPlugin[]>;

  /**
   * 根据技能查找插件
   * @param skillName 技能名称
   * @param forceRefresh 是否强制刷新缓存
   */
  findPluginBySkill(skillName: string, forceRefresh?: boolean): Promise<MarketPlugin | null>;

  /**
   * 清除缓存
   */
  clearCache(): Promise<void>;
}

// ========== 外部市场服务接口 ==========

/**
 * 外部市场服务接口
 * 负责从 npm、GitHub、MCP Marketplace 搜索插件
 */
export interface IExternalMarketService {
  /**
   * 搜索 npm 包
   * @param keyword 搜索关键词
   * @param limit 返回数量限制
   * @param useCache 是否使用缓存
   */
  searchNpm(keyword: string, limit?: number, useCache?: boolean): Promise<ExternalPlugin[]>;

  /**
   * 搜索 GitHub 仓库
   * @param keyword 搜索关键词
   * @param limit 返回数量限制
   * @param useCache 是否使用缓存
   */
  searchGitHub(keyword: string, limit?: number, useCache?: boolean): Promise<ExternalPlugin[]>;

  /**
   * 搜索 MCP Marketplace
   * @param keyword 搜索关键词
   * @param useCache 是否使用缓存
   */
  searchMCPMarketplace(keyword: string, useCache?: boolean): Promise<ExternalPlugin[]>;

  /**
   * 综合搜索所有来源
   * @param keyword 搜索关键词
   */
  searchAll(keyword: string): Promise<ExternalPlugin[]>;

  /**
   * 从指定来源搜索
   * @param keyword 搜索关键词
   * @param source 搜索来源
   */
  search(keyword: string, source?: 'npm' | 'github' | 'mcp-marketplace' | 'all'): Promise<ExternalPlugin[]>;

  /**
   * 获取 npm 包详情
   * @param packageName 包名
   */
  getNpmPackageDetails(packageName: string): Promise<ExternalPlugin | null>;

  /**
   * 获取 GitHub 仓库详情
   * @param owner 仓库所有者
   * @param repo 仓库名称
   */
  getGitHubRepoDetails(owner: string, repo: string): Promise<ExternalPlugin | null>;

  /**
   * 根据 ID 获取插件详情
   * @param pluginId 插件ID
   */
  getPluginDetails(pluginId: string): Promise<ExternalPlugin | null>;

  /**
   * 清除缓存
   */
  clearCache(): Promise<void>;
}

// ========== 技能解析服务接口 ==========

/**
 * 技能解析服务接口
 * 负责技能到插件的映射和解析
 */
export interface ISkillResolver {
  /**
   * 初始化服务
   */
  initialize(): Promise<void>;

  /**
   * 解析技能
   * @param skillName 技能名称或关键词
   * @param installedPlugins 已安装插件列表（可选）
   */
  resolve(skillName: string, installedPlugins?: InstalledPluginInfo[]): Promise<SkillResolveResult>;

  /**
   * 获取已安装插件列表
   */
  getInstalledPlugins(): Promise<InstalledPluginInfo[]>;

  /**
   * 使缓存失效
   */
  invalidateCache(): Promise<void>;

  /**
   * 获取所有技能映射
   */
  getMappings(): SkillMapping[];

  /**
   * 添加技能映射
   * @param mapping 技能映射
   */
  addMapping(mapping: SkillMapping): void;

  /**
   * 保存映射配置
   */
  saveMappings(): Promise<void>;

  /**
   * 获取插件的所有技能
   * @param plugin 插件信息
   */
  getPluginSkills(plugin: InstalledPluginInfo): Promise<OfficialSkill[]>;

  /**
   * 从插件目录读取技能详情
   * @param installPath 安装路径
   * @param skillPath 技能路径
   */
  readSkillFromPlugin(installPath: string, skillPath: string): Promise<OfficialSkill | null>;
}

// ========== 插件安装器接口 ==========

/**
 * 插件安装器接口
 * 负责插件的安装、卸载等操作
 */
export interface IPluginInstaller {
  /**
   * 安装插件
   * @param pluginInfo 插件信息
   */
  install(pluginInfo: MarketPlugin): Promise<InstallResult>;

  /**
   * 卸载插件
   * @param pluginId 插件ID
   */
  uninstall(pluginId: string): Promise<{ success: boolean; error?: string }>;

  /**
   * 获取扩展目录
   */
  getExtensionsDir(): Promise<string>;
}

// ========== 插件注册表接口 ==========

/**
 * 插件注册表接口
 * 负责已安装插件的记录管理
 */
export interface IPluginRegistry {
  /**
   * 获取已安装插件列表
   */
  list(): Promise<InstalledPluginInfo[]>;

  /**
   * 获取单个插件信息
   * @param pluginId 插件ID
   */
  get(pluginId: string): Promise<InstalledPluginInfo | undefined>;

  /**
   * 更新插件记录
   * @param plugin 插件信息
   */
  update(plugin: InstalledPluginInfo): Promise<void>;

  /**
   * 移除插件记录
   * @param pluginId 插件ID
   */
  remove(pluginId: string): Promise<void>;
}

// ========== 服务工厂接口 ==========

/**
 * 服务工厂接口
 * 用于创建服务实例
 */
export interface IServiceFactory {
  /**
   * 创建市场服务实例
   */
  createMarketService(): IMarketService;

  /**
   * 创建外部市场服务实例
   */
  createExternalMarketService(): IExternalMarketService;

  /**
   * 创建技能解析服务实例
   * @param marketService 市场服务实例
   */
  createSkillResolver(marketService: IMarketService): ISkillResolver;

  /**
   * 创建插件安装器实例
   * @param options 安装器选项
   */
  createPluginInstaller(options?: { verbose?: boolean; gitTimeout?: number }): IPluginInstaller;
}
