/**
 * 插件 ID 工具
 * 提供插件 ID 与包名之间的转换功能
 */

/**
 * 将 npm 包名转换为唯一的插件 ID
 *
 * ID 生成策略:
 * - scoped 包 (@scope/name) -> scope--name (使用双横线分隔，避免冲突)
 * - 普通包 (name) -> name (保持不变)
 *
 * 示例:
 * - @openclaw/search -> openclaw--search
 * - openclaw-search -> openclaw-search
 * - @scope/sub/name -> scope--sub--name
 *
 * @param packageName - npm 包名
 * @returns 插件 ID
 */
export function packageNameToPluginId(packageName: string): string {
  if (!packageName || typeof packageName !== 'string') {
    return '';
  }

  if (packageName.startsWith('@')) {
    // 移除 @ 前缀，然后用双横线替换所有斜杠
    return packageName.slice(1).replace(/\//g, '--');
  }
  return packageName;
}

/**
 * 从插件 ID 反向解析出 npm 包名
 *
 * ID 格式:
 * - scoped 包: scope--name -> @scope/name
 * - 普通包: name -> name
 *
 * 注意: 此函数只能识别 scoped 包格式（包含双横线的 ID）
 * 对于普通包名，返回 null（因为无法区分是普通包还是其他来源）
 *
 * @param pluginId - 插件 ID
 * @returns npm 包名，如果不是 scoped 包格式则返回 null
 */
export function pluginIdToPackageName(pluginId: string): string | null {
  if (!pluginId || typeof pluginId !== 'string') {
    return null;
  }

  // 检查是否为 scoped 包格式 (包含双横线)
  if (pluginId.includes('--')) {
    // scope--name -> @scope/name
    const parts = pluginId.split('--');
    if (parts.length >= 2) {
      const scope = parts[0];
      const name = parts.slice(1).join('--'); // 处理名称中可能包含的 --
      return `@${scope}/${name}`;
    }
  }
  return null;
}

/**
 * 将 GitHub 仓库名转换为插件 ID
 *
 * @param repoFullName - 完整的仓库名 (owner/repo)
 * @returns 插件 ID
 */
export function repoToPluginId(repoFullName: string): string {
  if (!repoFullName || typeof repoFullName !== 'string') {
    return '';
  }
  return repoFullName.replace(/\//g, '-').toLowerCase();
}

/**
 * 从插件 ID 解析 GitHub 仓库信息
 *
 * 注意: 这假设 ID 格式为 owner-repo（使用单横线）
 * 新格式的 scoped 包 ID 使用双横线，不会误判
 *
 * @param pluginId - 插件 ID
 * @returns 仓库信息 { owner, repo } 或 null
 */
export function pluginIdToRepo(pluginId: string): { owner: string; repo: string } | null {
  if (!pluginId || typeof pluginId !== 'string') {
    return null;
  }

  // 排除 scoped 包格式（双横线）
  if (pluginId.includes('--')) {
    return null;
  }

  const parts = pluginId.split('-');
  if (parts.length >= 2) {
    return {
      owner: parts[0],
      repo: parts.slice(1).join('-')
    };
  }

  return null;
}
