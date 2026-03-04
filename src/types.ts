/**
 * 共享类型定义
 * 统一管理所有公共类型，避免重复定义
 */

// ==================== 插件相关类型 ====================

/**
 * 已安装插件信息
 */
export interface InstalledPluginInfo {
  id: string;
  name: string;
  version: string;
  status: 'enabled' | 'disabled';
  skills: string[];
  installPath?: string;
  description?: string;
}

/**
 * 插件清单结构 (openclaw.plugin.json)
 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  skills?: string[];
  dependencies?: {
    node?: Record<string, string>;
    python?: Record<string, string>;
  };
  configSchema?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * 已安装插件记录 (用于持久化存储)
 */
export interface InstalledPluginRecord {
  id: string;
  name: string;
  version: string;
  description: string;
  status: 'enabled' | 'disabled';
  installPath: string;
  installedAt: string;
  skills: string[];
  config?: Record<string, unknown>;
  checksum?: string;
  manifest?: PluginManifest;
}

// ==================== 市场相关类型 ====================

/**
 * 插件来源类型
 */
export type PluginSourceType = 'local' | 'npm' | 'git' | 'market' | 'mcp-marketplace';

/**
 * 插件来源信息
 */
export interface PluginSource {
  type: PluginSourceType;
  url?: string;
  path?: string;
}

/**
 * 市场插件基础信息
 */
export interface MarketPluginBase {
  id: string;
  name: string;
  description: string;
  version: string;
  source: PluginSource;
  skills: string[];
  author?: string;
  tags?: string[];
}

/**
 * 市场插件信息 (本地市场)
 */
export interface MarketPluginInfo extends MarketPluginBase {
  source: PluginSource;
  default_config?: Record<string, unknown>;
}

/**
 * 市场插件信息 (API 返回格式)
 */
export interface MarketPlugin extends MarketPluginBase {
  source: PluginSource;
  auto_config: boolean;
  default_config?: Record<string, unknown>;
  configSchema?: Record<string, unknown>;
}

/**
 * 外部市场插件信息 (npm/GitHub/MCP Marketplace)
 */
export interface ExternalPlugin extends MarketPluginBase {
  source: PluginSource;
  auto_config: boolean;
  default_config?: Record<string, unknown>;
  configSchema?: Record<string, unknown>;
  // 扩展字段
  stars?: number;
  downloads?: number;
  homepage?: string;
  repository?: string;
  license?: string;
  publishedAt?: string;
}

// ==================== 技能相关类型 ====================

/**
 * 技能工具参数
 */
export interface SkillToolParameter {
  description: string;
  required?: boolean;
}

/**
 * 技能工具结构
 */
export interface SkillTool {
  name: string;
  description?: string;
  parameters?: Record<string, SkillToolParameter>;
}

/**
 * 官方技能结构
 */
export interface OfficialSkill {
  name: string;
  path: string;
  description?: string;
  tools: SkillTool[];
  enabled: boolean;
}

/**
 * 技能映射结构 (智能发现辅助)
 */
export interface SkillMapping {
  skill_name: string;
  keywords: string[];
  plugin_id: string;
  description: string;
}

/**
 * 解析后的技能信息
 */
export interface ParsedSkill {
  name: string;
  description: string;
  trigger?: string;
  content: string;
  tools: SkillTool[];
}

// ==================== 缓存相关类型 ====================

/**
 * 技能缓存结构
 */
export interface SkillCache {
  version: string;
  lastRefreshed: string;
  skills: OfficialSkill[];
  legacySkills?: Array<{
    name: string;
    plugin_id: string;
    description?: string;
    enabled: boolean;
  }>;
}

// ==================== 接口定义 ====================

/**
 * Registry Manager 接口
 */
export interface RegistryManager {
  list(): Promise<InstalledPluginInfo[]>;
  get(pluginId: string): Promise<InstalledPluginInfo | undefined>;
}

/**
 * 解析结果
 */
export interface SkillResolveResult {
  status: 'installed' | 'available' | 'not_found';
  pluginId?: string;
  pluginInfo?: MarketPlugin;
  installedInfo?: InstalledPluginInfo;
  skillInfo?: OfficialSkill;
  message: string;
}

/**
 * 安装结果
 */
export interface InstallResult {
  success: boolean;
  installPath?: string;
  manifest?: PluginManifest;
  checksum?: string;
  error?: string;
}
