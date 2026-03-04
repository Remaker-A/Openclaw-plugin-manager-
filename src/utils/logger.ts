/**
 * 日志工具 - 基于 winston 的统一日志管理
 *
 * 功能:
 * 1. 支持多日志级别 (error, warn, info, debug)
 * 2. 支持输出到控制台和文件
 * 3. 支持通过环境变量控制日志级别
 * 4. 统一的日志格式 (时间戳 + 级别 + 模块 + 消息)
 */

import winston from 'winston';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';

// 日志级别定义
const LOG_LEVELS: winston.config.AbstractConfigSetLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// 日志级别颜色
const LOG_COLORS: winston.config.AbstractConfigSetColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue'
};

winston.addColors(LOG_COLORS);

// 日志文件路径
const LOG_DIR = path.join(os.homedir(), '.openclaw', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'plugin-manager.log');

// 确保日志目录存在
fs.ensureDirSync(LOG_DIR);

// 自定义日志格式
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, module }) => {
    const modulePrefix = module ? `[${module}]` : '';
    return `${timestamp} [${level.toUpperCase().padEnd(5)}] ${modulePrefix} ${message}`;
  })
);

// 控制台格式 (带颜色)
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ level, message, timestamp, module }) => {
    const modulePrefix = module ? `[${module}]` : '';
    return `${timestamp} ${modulePrefix} ${message}`;
  })
);

// 创建基础 logger
const baseLogger = winston.createLogger({
  levels: LOG_LEVELS,
  level: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  format: customFormat,
  transports: [
    // 文件输出 - 所有日志
    new winston.transports.File({
      filename: LOG_FILE,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true,
      format: customFormat
    }),
    // 文件输出 - 错误日志
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 3,
      tailable: true
    })
  ],
  // 不退出于未捕获异常
  exitOnError: false
});

// 在非生产环境下添加控制台输出
if (process.env.NODE_ENV !== 'production' || process.env.LOG_CONSOLE === 'true') {
  baseLogger.add(new winston.transports.Console({
    format: consoleFormat,
    stderrLevels: ['error', 'warn']
  }));
}

// 模块日志器接口
export interface ModuleLogger {
  error(message: string, ...meta: any[]): void;
  warn(message: string, ...meta: any[]): void;
  info(message: string, ...meta: any[]): void;
  debug(message: string, ...meta: any[]): void;
}

/**
 * 创建模块专用日志器
 * @param moduleName 模块名称
 * @returns 模块日志器
 */
export function createLogger(moduleName: string): ModuleLogger {
  return {
    error: (message: string, ...meta: any[]) => {
      baseLogger.error(message, { module: moduleName, ...meta });
    },
    warn: (message: string, ...meta: any[]) => {
      baseLogger.warn(message, { module: moduleName, ...meta });
    },
    info: (message: string, ...meta: any[]) => {
      baseLogger.info(message, { module: moduleName, ...meta });
    },
    debug: (message: string, ...meta: any[]) => {
      baseLogger.debug(message, { module: moduleName, ...meta });
    }
  };
}

// 预创建常用模块日志器
export const logger = {
  // 核心模块
  core: createLogger('Core'),
  // 市场服务
  market: createLogger('MarketService'),
  // 外部市场服务
  externalMarket: createLogger('ExternalMarket'),
  // 技能解析器
  skillResolver: createLogger('SkillResolver'),
  // 插件安装器
  pluginInstaller: createLogger('PluginInstaller'),
  // 安装工具
  installTool: createLogger('InstallTool'),
  // 安装进度
  installProgress: createLogger('InstallProgress'),
  // 通用日志器
  general: createLogger('General')
};

// 导出基础日志器 (用于特殊情况)
export { baseLogger };

// 导出日志文件路径
export const LOG_PATH = LOG_FILE;

// 导出日志目录
export const LOG_DIRECTORY = LOG_DIR;

/**
 * 设置日志级别
 * @param level 日志级别 (error, warn, info, debug)
 */
export function setLogLevel(level: keyof typeof LOG_LEVELS): void {
  baseLogger.level = level as string;
}

/**
 * 获取当前日志级别
 */
export function getLogLevel(): string {
  return baseLogger.level;
}

/**
 * 清除日志文件
 */
export async function clearLogs(): Promise<void> {
  try {
    if (await fs.pathExists(LOG_DIR)) {
      const files = await fs.readdir(LOG_DIR);
      for (const file of files) {
        if (file.endsWith('.log')) {
          await fs.remove(path.join(LOG_DIR, file));
        }
      }
    }
  } catch (error) {
    // 静默失败
  }
}

// 默认导出
export default logger;
