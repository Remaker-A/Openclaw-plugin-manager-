/**
 * 加密工具模块 - 敏感配置加密存储
 *
 * 功能:
 * 1. 使用 AES-256-GCM 加密算法保护敏感配置
 * 2. 自动生成和管理加密密钥
 * 3. 密钥存储在用户主目录的 .openclaw/encryption.key 文件中
 * 4. 设置适当的文件权限 (仅所有者可读写)
 */

import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { createLogger } from './logger.js';

const logger = createLogger('Encryption');

// 加密算法
const ALGORITHM = 'aes-256-gcm';

// 密钥文件路径
const KEY_DIR = path.join(os.homedir(), '.openclaw');
const KEY_PATH = path.join(KEY_DIR, 'encryption.key');

// 密钥文件权限: 600 (仅所有者可读写)
const KEY_FILE_MODE = 0o600;

// 配置文件权限: 600 (仅所有者可读写)
const CONFIG_FILE_MODE = 0o600;

// 敏感字段名称列表 (常见敏感配置字段)
const SENSITIVE_FIELDS = [
  'apiKey',
  'api_key',
  'apiSecret',
  'api_secret',
  'secretKey',
  'secret_key',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'token',
  'password',
  'passwd',
  'credential',
  'credentials',
  'privateKey',
  'private_key',
  'authToken',
  'auth_token',
  'bearer',
  'authorization'
];

// 加密值前缀，用于识别已加密的值
const ENCRYPTED_PREFIX = 'enc:';

/**
 * 加密文本
 * @param text 要加密的明文
 * @returns 加密后的字符串 (格式: iv:authTag:encrypted)
 */
export async function encrypt(text: string): Promise<string> {
  if (!text || typeof text !== 'string') {
    throw new Error('Encryption failed: invalid input text');
  }

  try {
    const key = await getOrCreateKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // 返回格式: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    logger.error(`Encryption failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * 解密文本
 * @param encrypted 加密的字符串 (格式: iv:authTag:encrypted)
 * @returns 解密后的明文
 */
export async function decrypt(encrypted: string): Promise<string> {
  if (!encrypted || typeof encrypted !== 'string') {
    throw new Error('Decryption failed: invalid input');
  }

  // 检查是否是加密格式
  if (!isEncrypted(encrypted)) {
    throw new Error('Decryption failed: input is not in encrypted format');
  }

  try {
    const key = await getOrCreateKey();

    // 移除前缀
    const dataStr = encrypted.substring(ENCRYPTED_PREFIX.length);
    const parts = dataStr.split(':');

    if (parts.length !== 3) {
      throw new Error('Decryption failed: invalid encrypted data format');
    }

    const [ivHex, authTagHex, data] = parts;

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    logger.error(`Decryption failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * 检查值是否已加密
 * @param value 要检查的值
 * @returns 是否已加密
 */
export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * 获取或创建加密密钥
 * @returns 加密密钥 Buffer
 */
async function getOrCreateKey(): Promise<Buffer> {
  try {
    // 确保目录存在
    await fs.ensureDir(KEY_DIR);

    // 检查密钥文件是否存在
    if (await fs.pathExists(KEY_PATH)) {
      const key = await fs.readFile(KEY_PATH);

      // 验证密钥长度 (AES-256 需要 32 字节)
      if (key.length !== 32) {
        logger.warn('Existing key has invalid length, regenerating...');
        return await generateAndSaveKey();
      }

      return key;
    }

    // 生成新密钥
    return await generateAndSaveKey();
  } catch (error) {
    logger.error(`Failed to get or create key: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * 生成并保存新密钥
 * @returns 新生成的密钥
 */
async function generateAndSaveKey(): Promise<Buffer> {
  const key = crypto.randomBytes(32);

  // 写入密钥文件，设置权限为 600
  await fs.writeFile(KEY_PATH, key, { mode: KEY_FILE_MODE });

  logger.info('Generated new encryption key');

  return key;
}

/**
 * 判断字段名是否为敏感字段
 * @param fieldName 字段名
 * @returns 是否为敏感字段
 */
export function isSensitiveField(fieldName: string): boolean {
  if (!fieldName || typeof fieldName !== 'string') {
    return false;
  }

  const lowerFieldName = fieldName.toLowerCase();

  return SENSITIVE_FIELDS.some(sensitive =>
    lowerFieldName === sensitive.toLowerCase() ||
    lowerFieldName.includes(sensitive.toLowerCase())
  );
}

/**
 * 添加自定义敏感字段
 * @param fieldName 敏感字段名
 */
export function addSensitiveField(fieldName: string): void {
  if (fieldName && !SENSITIVE_FIELDS.includes(fieldName)) {
    SENSITIVE_FIELDS.push(fieldName);
  }
}

/**
 * 加密配置对象中的敏感字段
 * @param config 配置对象
 * @returns 加密后的配置对象
 */
export async function encryptConfig(config: Record<string, any>): Promise<Record<string, any>> {
  if (!config || typeof config !== 'object') {
    return config;
  }

  const encryptedConfig: Record<string, any> = {};

  for (const [key, value] of Object.entries(config)) {
    if (isSensitiveField(key) && typeof value === 'string') {
      // 如果已经加密，保持不变
      if (isEncrypted(value)) {
        encryptedConfig[key] = value;
      } else {
        // 加密敏感字段
        encryptedConfig[key] = ENCRYPTED_PREFIX + await encrypt(value);
        logger.info(`Encrypted sensitive field: ${key}`);
      }
    } else if (typeof value === 'object' && value !== null) {
      // 递归处理嵌套对象
      encryptedConfig[key] = await encryptConfig(value);
    } else {
      encryptedConfig[key] = value;
    }
  }

  return encryptedConfig;
}

/**
 * 解密配置对象中的敏感字段
 * @param config 加密的配置对象
 * @returns 解密后的配置对象
 */
export async function decryptConfig(config: Record<string, any>): Promise<Record<string, any>> {
  if (!config || typeof config !== 'object') {
    return config;
  }

  const decryptedConfig: Record<string, any> = {};

  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && isEncrypted(value)) {
      try {
        decryptedConfig[key] = await decrypt(value);
      } catch (error) {
        // 解密失败，保留原值
        logger.warn(`Failed to decrypt field ${key}: ${error instanceof Error ? error.message : String(error)}`);
        decryptedConfig[key] = value;
      }
    } else if (typeof value === 'object' && value !== null) {
      // 递归处理嵌套对象
      decryptedConfig[key] = await decryptConfig(value);
    } else {
      decryptedConfig[key] = value;
    }
  }

  return decryptedConfig;
}

/**
 * 安全写入配置文件 (加密敏感字段并设置权限)
 * @param filePath 文件路径
 * @param config 配置对象
 */
export async function writeSecureConfig(
  filePath: string,
  config: Record<string, any>
): Promise<void> {
  try {
    // 确保目录存在
    await fs.ensureDir(path.dirname(filePath));

    // 加密敏感字段
    const encryptedConfig = await encryptConfig(config);

    // 写入文件
    await fs.writeJson(filePath, encryptedConfig, { spaces: 2 });

    // 设置文件权限 (Windows 上 chmod 可能不完全生效，但仍尝试)
    try {
      await fs.chmod(filePath, CONFIG_FILE_MODE);
    } catch {
      // Windows 系统可能不支持 chmod，忽略错误
    }

    logger.info(`Wrote secure config to: ${filePath}`);
  } catch (error) {
    logger.error(`Failed to write secure config: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * 安全读取配置文件 (解密敏感字段)
 * @param filePath 文件路径
 * @returns 解密后的配置对象
 */
export async function readSecureConfig(
  filePath: string
): Promise<Record<string, any> | null> {
  try {
    if (!(await fs.pathExists(filePath))) {
      return null;
    }

    const config = await fs.readJson(filePath);

    // 解密敏感字段
    return await decryptConfig(config);
  } catch (error) {
    logger.error(`Failed to read secure config: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * 获取密钥文件路径
 * @returns 密钥文件路径
 */
export function getKeyPath(): string {
  return KEY_PATH;
}

/**
 * 检查密钥是否存在
 * @returns 密钥是否存在
 */
export async function hasKey(): Promise<boolean> {
  return fs.pathExists(KEY_PATH);
}

/**
 * 删除加密密钥 (用于重置)
 * 注意: 删除密钥后，之前加密的数据将无法解密
 */
export async function deleteKey(): Promise<void> {
  try {
    if (await fs.pathExists(KEY_PATH)) {
      await fs.remove(KEY_PATH);
      logger.info('Deleted encryption key');
    }
  } catch (error) {
    logger.error(`Failed to delete key: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// 导出常量
export { ENCRYPTED_PREFIX, SENSITIVE_FIELDS, KEY_FILE_MODE, CONFIG_FILE_MODE };

// 默认导出
export default {
  encrypt,
  decrypt,
  isEncrypted,
  isSensitiveField,
  addSensitiveField,
  encryptConfig,
  decryptConfig,
  writeSecureConfig,
  readSecureConfig,
  getKeyPath,
  hasKey,
  deleteKey,
  ENCRYPTED_PREFIX,
  SENSITIVE_FIELDS
};
