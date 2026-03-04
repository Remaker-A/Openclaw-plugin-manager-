/**
 * 安全验证工具
 * 提供输入验证函数，防止各种安全攻击
 */

import * as path from 'path';
import * as os from 'os';

/**
 * 验证 Git URL 安全性
 * - 只允许 https://, http://, git@ 协议
 * - 检查可疑字符模式，防止命令注入
 *
 * @param url - 要验证的 Git URL
 * @returns 是否为安全的 Git URL
 */
export function validateGitUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  // 允许的协议白名单
  const allowedProtocols = ['https://', 'http://', 'git@'];

  // 检查是否以允许的协议开头
  const hasValidProtocol = allowedProtocols.some(p => url.startsWith(p));
  if (!hasValidProtocol) {
    return false;
  }

  // 检查可疑字符模式（命令注入防护）
  // 这些字符可能被用于命令注入攻击
  const suspiciousPatterns = /[;&|`$(){}<>'"]/;
  if (suspiciousPatterns.test(url)) {
    return false;
  }

  // 检查控制字符
  if (/[\x00-\x1f\x7f]/.test(url)) {
    return false;
  }

  return true;
}

/**
 * 验证本地路径安全性
 * - 防止路径遍历攻击（如 ../../../etc/passwd）
 * - 确保路径必须在允许的目录内
 *
 * @param inputPath - 要验证的路径
 * @param allowedDirs - 可选的允许目录列表
 * @returns 验证后的安全路径
 * @throws 如果路径不安全或不在允许的目录内
 */
export function validateLocalPath(
  inputPath: string,
  allowedDirs?: string[]
): string {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('[Security] 本地路径不能为空');
  }

  // 解析为绝对路径
  const absolutePath = path.resolve(inputPath);

  // 规范化路径，处理 .. 和 . 等
  const normalizedPath = path.normalize(absolutePath);

  // 定义允许的基础目录白名单
  const defaultAllowedDirs = [
    path.join(os.homedir(), '.openclaw'),
    // Windows 下也允许 APPDATA/openclaw 目录
    ...(os.platform() === 'win32' && process.env.APPDATA
      ? [path.join(process.env.APPDATA, 'openclaw')]
      : []),
    // 允许系统临时目录（用于测试场景）
    os.tmpdir()
  ];

  const allowedBaseDirs = allowedDirs || defaultAllowedDirs;

  // 检查路径是否在允许的目录内
  // 使用规范化路径比较，防止路径遍历
  const isInAllowedDir = allowedBaseDirs.some(baseDir => {
    const normalizedBase = path.normalize(baseDir);
    // 确保路径以允许的基础目录开头
    return normalizedPath.startsWith(normalizedBase + path.sep) ||
           normalizedPath === normalizedBase;
  });

  if (!isInAllowedDir) {
    throw new Error(
      `[Security] 本地路径必须在允许的目录内。允许的目录: ${allowedBaseDirs.join(', ')}`
    );
  }

  return absolutePath;
}

/**
 * 检测是否为内网地址 (SSRF 防护)
 * - 检测 localhost、私有 IP 地址段、IPv6 本地地址
 *
 * @param url - 要检测的 URL
 * @returns 是否为内网地址
 */
export function isInternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    const internalPatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^::1$/,
      /^fc00:/i,
      /^fe80:/i
    ];

    return internalPatterns.some(p => p.test(hostname));
  } catch {
    return true; // 无效 URL 视为内部
  }
}

/**
 * 验证 npm 包名格式
 * - 普通包名: 只能包含小写字母、数字、连字符、下划线、点
 * - scoped package (@scope/package): @scope/name 格式
 * - 包名长度: 1-214 字符
 *
 * @param pkgName - 要验证的包名
 * @returns 验证结果
 */
export function validatePackageName(pkgName: string): { valid: boolean; error?: string } {
  if (!pkgName || typeof pkgName !== 'string') {
    return { valid: false, error: '包名不能为空' };
  }

  // 检查包名总长度
  if (pkgName.length > 214) {
    return { valid: false, error: `包名过长: ${pkgName.length} 字符 (最大 214)` };
  }

  // 检查是否包含危险字符（命令注入防护）
  // 只允许: 字母、数字、连字符、下划线、点、@ 符号、斜杠
  const dangerousChars = /[;&|`$(){}<>!\\'"\n\r\t]/;
  if (dangerousChars.test(pkgName)) {
    return { valid: false, error: `包名包含非法字符: ${pkgName}` };
  }

  // scoped package 格式 (@scope/package)
  if (pkgName.startsWith('@')) {
    const scopedPattern = /^@([a-z0-9][-a-z0-9._]*)\/([a-z0-9][-a-z0-9._]*)$/;
    if (!scopedPattern.test(pkgName)) {
      return { valid: false, error: `scoped 包名格式无效: ${pkgName}` };
    }
    return { valid: true };
  }

  // 普通包名格式
  const normalPattern = /^[a-z0-9][-a-z0-9._]*$/;
  if (!normalPattern.test(pkgName)) {
    return { valid: false, error: `包名格式无效: ${pkgName}` };
  }

  return { valid: true };
}

/**
 * 验证版本号/版本范围格式
 * - 支持 semver 格式: x.y.z
 * - 支持预发布标签: 1.0.0-alpha.1
 * - 支持版本范围: ^, ~, >=, <=, >, <, ||, *, x, X
 *
 * @param version - 要验证的版本号
 * @returns 验证结果
 */
export function validateVersionRange(version: string): { valid: boolean; error?: string } {
  if (!version || typeof version !== 'string') {
    return { valid: false, error: '版本号不能为空' };
  }

  // 检查是否包含危险字符（命令注入防护）
  const dangerousChars = /[;&|`$(){}<>!\\'"\n\r\t]/;
  if (dangerousChars.test(version)) {
    return { valid: false, error: `版本号包含非法字符: ${version}` };
  }

  // 允许的特殊值
  if (version === '*' || version === 'latest' || version === 'next') {
    return { valid: true };
  }

  // semver 版本号正则
  const semverPattern = /^\d+\.\d+\.\d+(-[\w.-]+)?(\+[\w.-]+)?$/;

  // 版本范围符号
  const rangePattern = /^[\^~]/;
  const comparisonPattern = /^[<>=]+\s*\d/;

  // 复合版本范围 (用 || 或空格分隔)
  const parts = version.split(/\s*\|\|\s*|\s+/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // 移除范围前缀后检查
    let versionPart = trimmed;
    if (rangePattern.test(trimmed)) {
      versionPart = trimmed.slice(1);
    } else if (comparisonPattern.test(trimmed)) {
      versionPart = trimmed.replace(/^[<>=]+\s*/, '');
    }

    // 检查版本部分
    // 允许: x.y.z, x.y, x, x.x.x (通配符)
    const validVersionPattern = /^(\d+|x|X|\*)(\.(\d+|x|X|\*))?(\.(\d+|x|X|\*))?(-[\w.-]+)?$/;
    if (!validVersionPattern.test(versionPart) && !semverPattern.test(versionPart)) {
      return { valid: false, error: `版本号格式无效: ${version}` };
    }
  }

  return { valid: true };
}
