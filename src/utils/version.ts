/**
 * 版本工具
 * 提供版本比较和解析功能
 */

/**
 * 比较版本号
 * @param a - 版本 a
 * @param b - 版本 b
 * @returns 1: a > b, -1: a < b, 0: a == b
 *
 * @example
 * compareVersions('1.0.0', '1.0.1') // -1
 * compareVersions('2.0.0', '1.9.9') // 1
 * compareVersions('1.0.0', '1.0.0') // 0
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(p => parseInt(p, 10) || 0);
  const partsB = b.split('.').map(p => parseInt(p, 10) || 0);

  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;

    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }

  return 0;
}

/**
 * 验证版本号格式
 * 支持 semver 格式: x.y.z，可选预发布标签和构建元数据
 *
 * @param version - 版本号
 * @returns 是否为有效的版本号
 */
export function isValidVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(version);
}

/**
 * 清理版本标签
 * 移除 'v' 前缀
 *
 * @param tag - 版本标签
 * @returns 清理后的版本号
 */
export function cleanVersionTag(tag: string): string {
  return tag.replace(/^v/i, '');
}
