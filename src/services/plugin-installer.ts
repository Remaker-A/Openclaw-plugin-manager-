/**
 * 插件安装器
 * 实现真正的插件安装逻辑
 */

import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execa } from 'execa';
import { logger } from '../utils/logger.js';
import {
  MarketPlugin,
  PluginManifest,
  InstallResult
} from '../types.js';

// 插件清单文件名
const PLUGIN_MANIFEST_FILE = 'openclaw.plugin.json';

export class PluginInstaller {
  private verbose: boolean;
  private gitTimeout: number;

  constructor(options?: { verbose?: boolean; gitTimeout?: number }) {
    this.verbose = options?.verbose || false;
    this.gitTimeout = options?.gitTimeout ?? 300000; // 默认 5 分钟
  }

  /**
   * 安装插件
   */
  async install(pluginInfo: MarketPlugin): Promise<InstallResult> {
    try {
      this.log(`开始安装插件: ${pluginInfo.id}`);

      // 1. 解析来源路径
      this.log('解析插件来源...');
      const sourcePath = await this.resolveSource(pluginInfo);
      this.log(`来源路径: ${sourcePath}`);

      // 2. 验证插件清单
      this.log('验证插件清单...');
      const manifest = await this.validatePlugin(sourcePath);
      this.log(`插件: ${manifest.name} v${manifest.version}`);

      // 3. 计算校验和
      const checksum = await this.calculateChecksum(sourcePath);

      // 4. 创建链接
      this.log('创建插件链接...');
      const installPath = await this.linkPlugin(sourcePath, manifest.id);
      this.log(`安装路径: ${installPath}`);

      // 5. 安装依赖
      if (manifest.dependencies) {
        this.log('安装依赖...');
        await this.installDependencies(installPath, manifest.dependencies);
      }

      this.log('安装完成!');

      return {
        success: true,
        installPath,
        manifest,
        checksum
      };
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log(`安装失败: ${errorMessage}`, true);
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * 卸载插件
   */
  async uninstall(pluginId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const extensionsDir = await this.getExtensionsDir();
      const installPath = path.join(extensionsDir, pluginId);

      if (!(await fs.pathExists(installPath))) {
        return { success: true }; // 已经不存在
      }

      // 检查是否是符号链接
      const stat = await fs.lstat(installPath);
      if (stat.isSymbolicLink()) {
        await fs.unlink(installPath);
      } else {
        await fs.remove(installPath);
      }

      this.log(`已卸载插件: ${pluginId}`);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 解析来源
   */
  private async resolveSource(pluginInfo: MarketPlugin): Promise<string> {
    const { source } = pluginInfo;

    // 本地路径
    if (source.type === 'local' && source.path) {
      // 验证路径安全性，防止路径遍历攻击
      const validatedPath = this.validateLocalPath(source.path);
      if (!(await fs.pathExists(validatedPath))) {
        throw new Error(`[PluginInstaller] 本地插件路径不存在: ${validatedPath}`);
      }
      return validatedPath;
    }

    // Git 仓库
    if (source.type === 'git' && source.url) {
      // 验证 Git URL 安全性
      if (!this.validateGitUrl(source.url)) {
        throw new Error(`[PluginInstaller] 无效或危险的 Git URL: ${source.url}`);
      }

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-git-'));
      this.log(`克隆 Git 仓库: ${source.url}`);

      try {
        await execa('git', ['clone', '--depth', '1', source.url, tempDir], {
          stdio: this.verbose ? 'inherit' : 'pipe',
          timeout: this.gitTimeout
        });
      } catch (error: any) {
        if (error.timedOut) {
          throw new Error(`[PluginInstaller] Git 克隆超时: 仓库 ${source.url} 在 ${this.gitTimeout / 1000} 秒内未能完成克隆，请检查网络连接或增加超时时间`);
        }
        throw error;
      }

      return tempDir;
    }

    // npm 包
    if (source.type === 'npm') {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-npm-'));
      const packageName = source.url || pluginInfo.id;

      this.log(`安装 npm 包: ${packageName}`);

      // 创建 package.json 并安装
      await fs.writeJson(path.join(tempDir, 'package.json'), {
        name: 'temp-install',
        private: true
      });

      await execa('npm', ['install', '--no-save', '--ignore-scripts', packageName], {
        cwd: tempDir,
        stdio: this.verbose ? 'inherit' : 'pipe'
      });

      // npm 安装后，scoped package 的路径保持原样（如 @scope/package）
      // 普通 package 的路径就是 package-name
      return path.join(tempDir, 'node_modules', packageName);
    }

    throw new Error(`[PluginInstaller] 不支持的来源类型: ${source.type}`);
  }

  /**
   * 验证插件清单
   */
  private async validatePlugin(pluginPath: string): Promise<PluginManifest> {
    const manifestPath = path.join(pluginPath, PLUGIN_MANIFEST_FILE);

    if (!(await fs.pathExists(manifestPath))) {
      throw new Error(`[PluginInstaller] 找不到插件清单文件: ${PLUGIN_MANIFEST_FILE}`);
    }

    let manifest: PluginManifest;
    try {
      manifest = await fs.readJson(manifestPath);
    } catch (error) {
      throw new Error(`[PluginInstaller] 插件清单格式无效: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 验证必填字段 (version 可选，缺少时使用默认值)
    const required = ['id', 'name', 'description'];
    const missing = required.filter(f => !manifest[f]);

    if (missing.length > 0) {
      throw new Error(`[PluginInstaller] 清单缺少必填字段: ${missing.join(', ')}`);
    }

    // 如果缺少版本号，使用默认版本
    if (!manifest.version) {
      this.log('清单缺少版本号，使用默认版本 0.0.1');
      manifest.version = '0.0.1';
    }

    // 验证版本号格式，无效时使用默认版本
    if (!this.isValidVersion(manifest.version)) {
      this.log(`版本号格式无效: ${manifest.version}，使用默认版本 0.0.1`);
      manifest.version = '0.0.1';
    }

    return manifest;
  }

  /**
   * 创建符号链接
   */
  private async linkPlugin(source: string, pluginId: string): Promise<string> {
    const extensionsDir = await this.getExtensionsDir();
    const targetPath = path.join(extensionsDir, pluginId);

    // 删除已存在的
    if (await fs.pathExists(targetPath)) {
      const stat = await fs.lstat(targetPath);
      if (stat.isSymbolicLink()) {
        await fs.unlink(targetPath);
      } else {
        await fs.remove(targetPath);
      }
    }

    // 确保目标目录存在
    await fs.ensureDir(path.dirname(targetPath));

    // 创建链接
    if (os.platform() === 'win32') {
      // Windows: 使用 junction (不需要管理员权限)
      try {
        await fs.symlink(source, targetPath, 'junction');
      } catch (error: any) {
        if (error.code === 'EPERM' || error.code === 'EACCES') {
          // 如果 junction 失败，回退到复制
          this.log('无法创建符号链接，使用文件复制');
          await fs.copy(source, targetPath, { overwrite: true });
        } else {
          throw error;
        }
      }
    } else {
      // Unix: 使用符号链接
      await fs.symlink(source, targetPath);
    }

    return targetPath;
  }

  /**
   * 安装依赖
   */
  private async installDependencies(
    installPath: string,
    dependencies: NonNullable<PluginManifest['dependencies']>
  ): Promise<void> {
    // Node 依赖
    if (dependencies.node && Object.keys(dependencies.node).length > 0) {
      // 验证所有包名和版本号
      for (const [pkg, ver] of Object.entries(dependencies.node)) {
        const pkgValidation = this.validatePackageName(pkg);
        if (!pkgValidation.valid) {
          throw new Error(`[PluginInstaller] 无效的包名: ${pkg} - ${pkgValidation.error}`);
        }

        const verValidation = this.validateVersionRange(ver);
        if (!verValidation.valid) {
          throw new Error(`[PluginInstaller] 无效的版本号: ${ver} - ${verValidation.error}`);
        }
      }

      const args = ['install', '--no-save', '--ignore-scripts'];

      for (const [pkg, ver] of Object.entries(dependencies.node)) {
        args.push(`${pkg}@${ver}`);
      }

      this.log(`安装 Node 依赖: ${Object.keys(dependencies.node).join(', ')}`);

      try {
        await execa('npm', args, {
          cwd: installPath,
          stdio: this.verbose ? 'inherit' : 'pipe'
        });
      } catch (error: any) {
        this.log(`[PluginInstaller] Node 依赖安装失败: ${error.message}`, true);
        throw new Error(`[PluginInstaller] Node 依赖安装失败: ${error.message}`);
      }
    }

    // Python 依赖
    if (dependencies.python && Object.keys(dependencies.python).length > 0) {
      // 验证所有包名和版本号
      for (const [pkg, ver] of Object.entries(dependencies.python)) {
        const pkgValidation = this.validatePackageName(pkg);
        if (!pkgValidation.valid) {
          throw new Error(`[PluginInstaller] 无效的 Python 包名: ${pkg} - ${pkgValidation.error}`);
        }

        // Python 版本验证（相对宽松）
        const dangerousChars = /[;&|`$(){}<>!\\'"\n\r\t]/;
        if (dangerousChars.test(ver)) {
          throw new Error(`[PluginInstaller] Python 版本号包含非法字符: ${ver}`);
        }
      }

      const args = ['-m', 'pip', 'install', '--user'];

      for (const [pkg, ver] of Object.entries(dependencies.python)) {
        args.push(`${pkg}${ver}`);
      }

      this.log(`安装 Python 依赖: ${Object.keys(dependencies.python).join(', ')}`);

      try {
        await execa('python', args, {
          cwd: installPath,
          stdio: this.verbose ? 'inherit' : 'pipe'
        });
      } catch (error: any) {
        this.log(`[PluginInstaller] Python 依赖安装失败: ${error.message}`, true);
        throw new Error(`[PluginInstaller] Python 依赖安装失败: ${error.message}`);
      }
    }
  }

  /**
   * 计算校验和
   */
  private async calculateChecksum(pluginPath: string): Promise<string> {
    const manifestPath = path.join(pluginPath, PLUGIN_MANIFEST_FILE);
    const content = await fs.readFile(manifestPath, 'utf8');
    return 'sha256:' + crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * 获取扩展目录
   */
  async getExtensionsDir(): Promise<string> {
    let dir: string;

    if (os.platform() === 'win32') {
      const appData = process.env.APPDATA;
      dir = appData
        ? path.join(appData, 'openclaw', 'extensions')
        : path.join(os.homedir(), '.openclaw', 'extensions');
    } else {
      dir = path.join(os.homedir(), '.openclaw', 'extensions');
    }

    await fs.ensureDir(dir);
    return dir;
  }

  /**
   * 验证版本号格式
   */
  private isValidVersion(version: string): boolean {
    return /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(version);
  }

  /**
   * 验证 npm 包名格式
   * - 普通包名: 只能包含小写字母、数字、连字符、下划线、点
   * - scoped package (@scope/package): @scope/name 格式
   * - 包名长度: 1-214 字符
   */
  private validatePackageName(pkgName: string): { valid: boolean; error?: string } {
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
   */
  private validateVersionRange(version: string): { valid: boolean; error?: string } {
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

  /**
   * 验证 Git URL 安全性
   * - 只允许 https://, http://, git@ 协议
   * - 检查可疑字符模式，防止命令注入
   */
  private validateGitUrl(url: string): boolean {
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
   */
  private validateLocalPath(inputPath: string): string {
    if (!inputPath || typeof inputPath !== 'string') {
      throw new Error('[PluginInstaller] 本地插件路径不能为空');
    }

    // 解析为绝对路径
    const absolutePath = path.resolve(inputPath);

    // 规范化路径，处理 .. 和 . 等
    const normalizedPath = path.normalize(absolutePath);

    // 定义允许的基础目录白名单
    const allowedBaseDirs = [
      path.join(os.homedir(), '.openclaw'),
      // Windows 下也允许 APPDATA/openclaw 目录
      ...(os.platform() === 'win32' && process.env.APPDATA
        ? [path.join(process.env.APPDATA, 'openclaw')]
        : []),
      // 允许系统临时目录（用于测试场景）
      os.tmpdir()
    ];

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
        `[PluginInstaller] 本地插件路径必须在允许的目录内。允许的目录: ${allowedBaseDirs.join(', ')}`
      );
    }

    return absolutePath;
  }

  /**
   * 日志输出
   */
  private log(message: string, isError: boolean = false): void {
    if (this.verbose || isError) {
      if (isError) {
        logger.pluginInstaller.error(message);
      } else {
        logger.pluginInstaller.info(message);
      }
    }
  }
}

// 重新导出类型，保持向后兼容
export type { PluginManifest, InstallResult } from '../types.js';
