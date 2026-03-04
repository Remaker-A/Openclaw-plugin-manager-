/**
 * 共享的 Zod Schema 定义
 * 统一管理工具输入参数验证模式
 */

import { z } from 'zod';

// ==================== check-skill 工具 ====================

/**
 * 检查技能输入参数 Schema
 */
export const checkSkillSchema = z.object({
  skill_name: z.string().describe('技能名称或关键词'),
  skill_description: z.string().optional().describe('技能描述（可选）')
});

export type CheckSkillInput = z.infer<typeof checkSkillSchema>;

/**
 * 批量检查技能参数 Schema
 */
export const checkMultipleSkillsSchema = z.object({
  skills: z.array(z.string()).min(1).describe('技能名称列表')
});

export type CheckMultipleSkillsInput = z.infer<typeof checkMultipleSkillsSchema>;

// ==================== auto-install 工具 ====================

/**
 * 自动安装输入参数 Schema
 */
export const autoInstallSchema = z.object({
  skill_name: z.string().describe('技能名称或关键词'),
  auto_confirm: z.boolean().default(false).describe('是否自动确认安装（不询问用户）'),
  auto_configure: z.boolean().default(true).describe('是否自动配置默认值')
});

export type AutoInstallInput = z.infer<typeof autoInstallSchema>;

// ==================== install 工具 ====================

/**
 * 安装插件输入参数 Schema
 */
export const installSchema = z.object({
  plugin_id: z.string().describe('插件ID'),
  auto_configure: z.boolean().default(true).describe('是否自动配置默认值'),
  use_cli: z.boolean().default(false).describe('是否使用 openclaw CLI 安装'),
  verbose: z.boolean().default(false).describe('是否显示详细日志'),
  force: z.boolean().default(false).describe('强制重新安装')
});

export type InstallInput = z.infer<typeof installSchema>;

/**
 * 卸载插件输入参数 Schema
 */
export const uninstallSchema = z.object({
  plugin_id: z.string().describe('要卸载的插件ID')
});

export type UninstallInput = z.infer<typeof uninstallSchema>;

// ==================== refresh-skills 工具 ====================

/**
 * 刷新技能输入参数 Schema
 */
export const refreshSkillsSchema = z.object({
  plugin_id: z.string().optional().describe('指定插件ID，只刷新该插件的技能（可选）')
});

export type RefreshSkillsInput = z.infer<typeof refreshSkillsSchema>;

// ==================== search-market 工具 ====================

/**
 * 搜索市场输入参数 Schema
 */
export const searchMarketSchema = z.object({
  keyword: z.string().describe('搜索关键词'),
  source: z.enum(['local', 'npm', 'github', 'mcp-marketplace', 'all']).default('all').describe('搜索来源'),
  include_installed: z.boolean().default(true).describe('是否包含已安装插件'),
  refresh: z.boolean().default(false).describe('是否强制刷新缓存')
});

export type SearchMarketInput = z.infer<typeof searchMarketSchema>;

// ==================== list-installed 工具 ====================

/**
 * 列出已安装插件输入参数 Schema
 */
export const listInstalledSchema = z.object({});

export type ListInstalledInput = z.infer<typeof listInstalledSchema>;

// ==================== check-updates 工具 ====================

/**
 * 检查更新输入参数 Schema
 */
export const checkUpdatesSchema = z.object({
  plugin_id: z.string().optional().describe('指定插件ID，不指定则检查所有已安装插件'),
  source: z.enum(['npm', 'github', 'market', 'all']).default('all').describe('检查来源'),
  include_prerelease: z.boolean().default(false).describe('是否包含预发布版本')
});

export type CheckUpdatesInput = z.infer<typeof checkUpdatesSchema>;

// ==================== install-progress 工具 ====================

/**
 * 带进度的安装输入参数 Schema
 */
export const installProgressSchema = z.object({
  plugin_id: z.string().describe('插件ID'),
  auto_configure: z.boolean().default(true).describe('是否自动配置默认值'),
  verbose: z.boolean().default(true).describe('是否返回详细进度'),
  force: z.boolean().default(false).describe('强制重新安装')
});

export type InstallProgressInput = z.infer<typeof installProgressSchema>;
