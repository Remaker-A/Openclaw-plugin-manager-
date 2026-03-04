/**
 * 安装进度反馈工具
 * 提供详细的安装步骤反馈和进度信息
 *
 * 由于 MCP 工具的同步调用特性，进度通过以下方式反馈:
 * 1. 返回详细的步骤日志
 * 2. 返回每个步骤的耗时
 * 3. 支持预估剩余时间
 */

import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execa } from 'execa';
import { IMarketService } from '../interfaces/index.js';
import { getInstalledPlugins, updateInstalledPluginsRecord, applyDefaultConfig, updateMainConfig } from './install.js';
import { logger } from '../utils/logger.js';
import { installProgressSchema, InstallProgressInput } from '../schemas.js';

// 重新导出 schemas 供 index.ts 使用
export { installProgressSchema } from '../schemas.js';

// 安装步骤
export type InstallStep =
  | 'initializing'
  | 'fetching_info'
  | 'checking_installed'
  | 'resolving_source'
  | 'downloading'
  | 'extracting'
  | 'validating'
  | 'installing_deps'
  | 'configuring'
  | 'registering'
  | 'refreshing_skills'
  | 'completed'
  | 'error';

// 步骤状态
export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'error';

// 进度事件
export interface ProgressEvent {
  step: InstallStep;
  status: StepStatus;
  message: string;
  progress: number;      // 0-100 总体进度
  duration?: number;     // 步骤耗时（毫秒）
  details?: Record<string, any>;
  timestamp: string;
}

// 安装结果
export interface InstallProgressResponse {
  status: 'success' | 'error';
  plugin_id: string;
  message: string;
  total_duration?: number;
  steps: ProgressEvent[];
  result?: {
    plugin_name: string;
    version: string;
    skills: string[];
    installPath: string;
  };
  error?: string;
}

// 步骤配置
const STEP_CONFIG: Record<InstallStep, { weight: number; description: string }> = {
  initializing: { weight: 5, description: '初始化安装环境' },
  fetching_info: { weight: 10, description: '获取插件信息' },
  checking_installed: { weight: 5, description: '检查安装状态' },
  resolving_source: { weight: 15, description: '解析插件来源' },
  downloading: { weight: 20, description: '下载插件' },
  extracting: { weight: 10, description: '解压/链接插件' },
  validating: { weight: 10, description: '验证插件完整性' },
  installing_deps: { weight: 15, description: '安装依赖' },
  configuring: { weight: 5, description: '应用配置' },
  registering: { weight: 3, description: '注册插件' },
  refreshing_skills: { weight: 2, description: '刷新技能缓存' },
  completed: { weight: 0, description: '安装完成' },
  error: { weight: 0, description: '安装失败' }
};

// 进度跟踪器
class ProgressTracker {
  private steps: ProgressEvent[] = [];
  private currentStepStart: number = 0;
  private accumulatedProgress: number = 0;

  startStep(step: InstallStep, message?: string): void {
    this.currentStepStart = Date.now();
    const config = STEP_CONFIG[step];

    this.steps.push({
      step,
      status: 'in_progress',
      message: message || config.description,
      progress: this.accumulatedProgress,
      timestamp: new Date().toISOString()
    });
  }

  completeStep(step: InstallStep, message?: string, details?: Record<string, any>): void {
    const config = STEP_CONFIG[step];
    const duration = Date.now() - this.currentStepStart;
    this.accumulatedProgress += config.weight;

    // 更新最后一个匹配的步骤
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i].step === step && this.steps[i].status === 'in_progress') {
        this.steps[i].status = 'completed';
        this.steps[i].message = message || this.steps[i].message;
        this.steps[i].progress = Math.min(this.accumulatedProgress, 100);
        this.steps[i].duration = duration;
        this.steps[i].details = details;
        break;
      }
    }
  }

  skipStep(step: InstallStep, reason: string): void {
    const config = STEP_CONFIG[step];

    this.steps.push({
      step,
      status: 'skipped',
      message: reason,
      progress: this.accumulatedProgress,
      timestamp: new Date().toISOString()
    });

    this.accumulatedProgress += config.weight;
  }

  errorStep(step: InstallStep, error: string): void {
    this.steps.push({
      step,
      status: 'error',
      message: error,
      progress: this.accumulatedProgress,
      timestamp: new Date().toISOString()
    });
  }

  getSteps(): ProgressEvent[] {
    return this.steps;
  }

  getCurrentProgress(): number {
    return Math.min(this.accumulatedProgress, 100);
  }
}

/**
 * 带进度反馈的插件安装
 */
export async function installWithProgress(
  input: InstallProgressInput,
  marketService: IMarketService
): Promise<InstallProgressResponse> {
  const { plugin_id, auto_configure, verbose, force } = input;
  const tracker = new ProgressTracker();
  const startTime = Date.now();

  try {
    // 1. 初始化
    tracker.startStep('initializing');
    const homeDir = os.homedir();
    const extensionsDir = path.join(homeDir, '.openclaw', 'extensions');
    await fs.ensureDir(extensionsDir);
    tracker.completeStep('initializing', '安装环境准备完成');

    // 2. 获取插件信息
    tracker.startStep('fetching_info');
    const pluginInfo = await marketService.getPluginById(plugin_id);

    if (!pluginInfo) {
      tracker.errorStep('fetching_info', `未找到插件: ${plugin_id}`);
      return {
        status: 'error',
        plugin_id,
        message: `未找到插件: ${plugin_id}`,
        steps: tracker.getSteps(),
        error: 'PLUGIN_NOT_FOUND'
      };
    }
    tracker.completeStep('fetching_info', `找到插件: ${pluginInfo.name} v${pluginInfo.version}`, {
      name: pluginInfo.name,
      version: pluginInfo.version,
      skills: pluginInfo.skills
    });

    // 3. 检查是否已安装
    tracker.startStep('checking_installed');
    const installedPlugins = await getInstalledPlugins();
    const existingPlugin = installedPlugins.find(p => p.id === plugin_id);

    if (existingPlugin && !force) {
      tracker.skipStep('checking_installed', '插件已安装，跳过');
      tracker.startStep('completed');
      tracker.completeStep('completed', '插件已就绪');

      return {
        status: 'success',
        plugin_id,
        message: `${pluginInfo.name} 已安装`,
        total_duration: Date.now() - startTime,
        steps: tracker.getSteps(),
        result: {
          plugin_name: pluginInfo.name,
          version: pluginInfo.version,
          skills: pluginInfo.skills,
          installPath: existingPlugin.installPath
        }
      };
    }
    tracker.completeStep('checking_installed', existingPlugin ? '将强制重新安装' : '插件未安装');

    // 4. 解析来源
    tracker.startStep('resolving_source');
    const { sourcePath, sourceType } = await resolvePluginSource(pluginInfo, extensionsDir, (msg) => {
      // 更新进度消息
      const lastStep = tracker.getSteps().find(s => s.step === 'resolving_source' && s.status === 'in_progress');
      if (lastStep) {
        lastStep.message = msg;
      }
    });
    tracker.completeStep('resolving_source', `来源: ${sourceType}`, { sourcePath });

    // 5. 下载（如果需要）
    if (sourceType === 'git' || sourceType === 'npm') {
      tracker.startStep('downloading');
      // 下载已在 resolvePluginSource 中完成
      tracker.completeStep('downloading', '下载完成');
    } else {
      tracker.skipStep('downloading', '本地插件，无需下载');
    }

    // 6. 验证插件
    tracker.startStep('validating');
    const manifest = await validatePlugin(sourcePath);
    tracker.completeStep('validating', `验证通过: ${manifest.name}`, {
      id: manifest.id,
      version: manifest.version
    });

    // 7. 创建链接/安装
    tracker.startStep('extracting');
    const installPath = await linkPlugin(sourcePath, plugin_id, extensionsDir);
    tracker.completeStep('extracting', `安装到: ${installPath}`);

    // 8. 安装依赖
    if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
      tracker.startStep('installing_deps');
      await installDependencies(installPath, manifest.dependencies, (msg) => {
        const lastStep = tracker.getSteps().find(s => s.step === 'installing_deps' && s.status === 'in_progress');
        if (lastStep) {
          lastStep.message = msg;
        }
      });
      tracker.completeStep('installing_deps', '依赖安装完成');
    } else {
      tracker.skipStep('installing_deps', '无依赖需要安装');
    }

    // 9. 应用配置
    if (auto_configure && pluginInfo.default_config) {
      tracker.startStep('configuring');
      await applyDefaultConfig(plugin_id, pluginInfo.default_config, installPath);
      tracker.completeStep('configuring', '默认配置已应用');
    } else {
      tracker.skipStep('configuring', auto_configure ? '无默认配置' : '跳过自动配置');
    }

    // 10. 注册插件
    tracker.startStep('registering');
    await updateInstalledPluginsRecord({
      id: plugin_id,
      name: manifest.name || pluginInfo.name,
      version: manifest.version || pluginInfo.version,
      description: manifest.description || pluginInfo.description,
      status: 'enabled',
      installPath,
      installedAt: new Date().toISOString(),
      skills: manifest.skills || pluginInfo.skills,
      config: auto_configure ? pluginInfo.default_config : undefined,
      manifest
    });
    await updateMainConfig(plugin_id);
    tracker.completeStep('registering', '插件已注册');

    // 11. 刷新技能
    tracker.startStep('refreshing_skills');
    // 调用 refreshSkills
    const { refreshSkills } = await import('./refresh-skills.js');
    await refreshSkills({ plugin_id });
    tracker.completeStep('refreshing_skills', '技能缓存已刷新');

    // 12. 完成
    tracker.startStep('completed');
    tracker.completeStep('completed', '安装成功');

    return {
      status: 'success',
      plugin_id,
      message: `${manifest.name || pluginInfo.name} 安装成功`,
      total_duration: Date.now() - startTime,
      steps: tracker.getSteps(),
      result: {
        plugin_name: manifest.name || pluginInfo.name,
        version: manifest.version || pluginInfo.version,
        skills: manifest.skills || pluginInfo.skills,
        installPath
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      status: 'error',
      plugin_id,
      message: `安装失败: ${errorMessage}`,
      total_duration: Date.now() - startTime,
      steps: tracker.getSteps(),
      error: errorMessage
    };
  }
}

/**
 * 解析插件来源
 */
async function resolvePluginSource(
  pluginInfo: any,
  extensionsDir: string,
  onProgress: (msg: string) => void
): Promise<{ sourcePath: string; sourceType: string }> {
  const { source } = pluginInfo;

  // 本地路径
  if (source.type === 'local' && source.path) {
    const absolutePath = path.resolve(source.path);
    if (!(await fs.pathExists(absolutePath))) {
      throw new Error(`本地插件路径不存在: ${absolutePath}`);
    }
    return { sourcePath: absolutePath, sourceType: 'local' };
  }

  // Git 仓库
  if (source.type === 'git' && source.url) {
    onProgress(`克隆 Git 仓库: ${source.url}`);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-git-'));

    await execa('git', ['clone', '--depth', '1', source.url, tempDir], {
      stdio: 'pipe'
    });

    return { sourcePath: tempDir, sourceType: 'git' };
  }

  // npm 包
  if (source.type === 'npm') {
    const packageName = source.url || pluginInfo.id;
    onProgress(`安装 npm 包: ${packageName}`);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-npm-'));

    await fs.writeJson(path.join(tempDir, 'package.json'), {
      name: 'temp-install',
      private: true
    });

    await execa('npm', ['install', packageName], {
      cwd: tempDir,
      stdio: 'pipe'
    });

    const packagePath = path.join(tempDir, 'node_modules', packageName);

    return { sourcePath: packagePath, sourceType: 'npm' };
  }

  throw new Error(`不支持的来源类型: ${source.type}`);
}

/**
 * 验证插件
 */
async function validatePlugin(pluginPath: string): Promise<any> {
  const manifestPath = path.join(pluginPath, 'openclaw.plugin.json');

  if (!(await fs.pathExists(manifestPath))) {
    throw new Error(`找不到插件清单文件: openclaw.plugin.json`);
  }

  const manifest = await fs.readJson(manifestPath);

  // 验证必填字段
  const required = ['id', 'name', 'version', 'description'];
  const missing = required.filter(f => !manifest[f]);

  if (missing.length > 0) {
    throw new Error(`清单缺少必填字段: ${missing.join(', ')}`);
  }

  return manifest;
}

/**
 * 创建插件链接
 */
async function linkPlugin(
  sourcePath: string,
  pluginId: string,
  extensionsDir: string
): Promise<string> {
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

  // 创建链接
  if (os.platform() === 'win32') {
    try {
      await fs.symlink(sourcePath, targetPath, 'junction');
    } catch (error: any) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        await fs.copy(sourcePath, targetPath, { overwrite: true });
      } else {
        throw error;
      }
    }
  } else {
    await fs.symlink(sourcePath, targetPath);
  }

  return targetPath;
}

/**
 * 安装依赖
 */
async function installDependencies(
  installPath: string,
  dependencies: { node?: Record<string, string>; python?: Record<string, string> },
  onProgress: (msg: string) => void
): Promise<void> {
  // Node 依赖
  if (dependencies.node && Object.keys(dependencies.node).length > 0) {
    onProgress(`安装 Node 依赖: ${Object.keys(dependencies.node).join(', ')}`);

    const args = ['install', '--no-save'];
    for (const [pkg, ver] of Object.entries(dependencies.node)) {
      args.push(`${pkg}@${ver}`);
    }

    try {
      await execa('npm', args, { cwd: installPath, stdio: 'pipe' });
    } catch (error: any) {
      logger.installProgress.warn(`Node 依赖安装失败: ${error.message}`);
    }
  }

  // Python 依赖
  if (dependencies.python && Object.keys(dependencies.python).length > 0) {
    onProgress(`安装 Python 依赖: ${Object.keys(dependencies.python).join(', ')}`);

    const args = ['-m', 'pip', 'install', '--user'];
    for (const [pkg, ver] of Object.entries(dependencies.python)) {
      args.push(`${pkg}${ver}`);
    }

    try {
      await execa('python', args, { cwd: installPath, stdio: 'pipe' });
    } catch (error: any) {
      logger.installProgress.warn(`Python 依赖安装失败: ${error.message}`);
    }
  }
}

/**
 * 获取步骤描述
 */
export function getStepDescription(step: InstallStep): string {
  return STEP_CONFIG[step]?.description || step;
}
