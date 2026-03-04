/**
 * SKILL.md 解析工具
 * 提供统一的技能文件解析逻辑，消除代码重复
 */

import fs from 'fs-extra';
import * as path from 'path';
import { SkillTool, SkillToolParameter, OfficialSkill, ParsedSkill } from '../types.js';

/**
 * 解析 SKILL.md 文件内容
 *
 * SKILL.md 格式示例:
 * # Xiaohongshu Search Skill
 *
 * 提供小红书内容搜索能力
 *
 * ## Tools
 *
 * ### xiaohongshu_search
 * 搜索小红书笔记
 *
 * **Parameters:**
 * - keyword: 搜索关键词 (required)
 * - limit: 返回数量
 */
export function parseSkillMd(content: string): { tools: SkillTool[]; description: string } {
  const tools: SkillTool[] = [];
  let description = '';

  const lines = content.split('\n');
  let currentTool: SkillTool | null = null;
  let inDescription = true;
  let inTools = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // 检测主标题
    if (trimmedLine.startsWith('# ')) {
      inDescription = true;
      inTools = false;
      continue;
    }

    // 检测 Tools 部分
    if (trimmedLine.toLowerCase().startsWith('## tools')) {
      inDescription = false;
      inTools = true;
      continue;
    }

    // 收集描述
    if (inDescription && trimmedLine && !trimmedLine.startsWith('#')) {
      if (!trimmedLine.toLowerCase().startsWith('##')) {
        description += (description ? ' ' : '') + trimmedLine;
      }
    }

    // 解析工具
    if (inTools) {
      if (trimmedLine.startsWith('### ')) {
        // 保存上一个工具
        if (currentTool) {
          tools.push(currentTool);
        }
        // 新工具
        currentTool = {
          name: trimmedLine.substring(4).trim(),
          description: ''
        };
      } else if (currentTool) {
        // 工具描述或参数
        if (trimmedLine.startsWith('**Parameters:**') || trimmedLine.startsWith('Parameters:')) {
          currentTool.parameters = {};
        } else if (trimmedLine.startsWith('- ') && currentTool.parameters) {
          // 解析参数: "- keyword: 搜索关键词 (required)"
          const paramMatch = trimmedLine.substring(2).match(/^(\w+):\s*(.+?)(?:\s*\((\w+)\))?$/);
          if (paramMatch) {
            currentTool.parameters[paramMatch[1]] = {
              description: paramMatch[2],
              required: paramMatch[3] === 'required'
            };
          }
        } else if (trimmedLine && !currentTool.description) {
          currentTool.description = trimmedLine;
        }
      }
    }
  }

  // 保存最后一个工具
  if (currentTool) {
    tools.push(currentTool);
  }

  return { tools, description: description.trim() };
}

/**
 * 获取技能描述（内置描述映射）
 */
export function getSkillDescription(skillName: string): string {
  const descriptions: Record<string, string> = {
    'web_search': '搜索互联网内容',
    'content_extract': '提取网页内容',
    'xiaohongshu_search': '搜索小红书笔记',
    'xiaohongshu_publish': '发布小红书内容',
    'xiaohongshu_comment': '小红书评论功能',
    'document_process': '处理各种文档格式',
    'pdf_convert': 'PDF格式转换',
    'word_convert': 'Word格式转换',
    'image_generation': 'AI图片生成',
    'image_edit': '图片编辑',
    'translate_text': '文本翻译',
    'translate_document': '文档翻译',
    'github_issue': 'GitHub Issue管理',
    'github_pr': 'GitHub Pull Request管理',
    'execute_code': '执行代码',
    'execute_python': '执行Python代码',
    'execute_javascript': '执行JavaScript代码',
    'db_query': '数据库查询',
    'http_get': 'HTTP GET请求',
    'http_post': 'HTTP POST请求',
    'weather_current': '查询当前天气',
    'weather_forecast': '天气预报',
    'email_send': '发送邮件',
    'calendar_create': '创建日历事件'
  };
  return descriptions[skillName] || skillName;
}

/**
 * 从技能路径解析技能信息
 *
 * @param installPath 插件安装路径
 * @param skillPath 技能相对路径 (如 "skills/xiaohongshu")
 * @returns 解析后的技能信息，失败返回 null
 */
export async function parseSkillFromPath(
  installPath: string,
  skillPath: string
): Promise<OfficialSkill | null> {
  try {
    // skillPath 格式: "skills/xiaohongshu" 或 "skills/web_search"
    const fullSkillPath = path.join(installPath, skillPath);
    const skillMdPath = path.join(fullSkillPath, 'SKILL.md');

    // 提取技能名称
    const skillName = path.basename(skillPath);

    // 尝试读取 SKILL.md
    let tools: SkillTool[] = [];
    let description = '';

    if (await fs.pathExists(skillMdPath)) {
      const skillContent = await fs.readFile(skillMdPath, 'utf-8');
      const parsed = parseSkillMd(skillContent);
      tools = parsed.tools;
      description = parsed.description;
    }

    return {
      name: skillName,
      path: skillPath,
      description: description || getSkillDescription(skillName),
      tools,
      enabled: true
    };
  } catch {
    return null;
  }
}

/**
 * 从插件目录读取所有官方格式的技能
 *
 * @param installPath 插件安装路径
 * @returns 技能列表
 */
export async function readPluginSkills(
  installPath: string
): Promise<OfficialSkill[]> {
  const skills: OfficialSkill[] = [];

  try {
    // 读取 openclaw.plugin.json
    const manifestPath = path.join(installPath, 'openclaw.plugin.json');

    if (!(await fs.pathExists(manifestPath))) {
      return [];
    }

    const manifest = await fs.readJson(manifestPath);

    if (!manifest.skills || manifest.skills.length === 0) {
      return [];
    }

    // 解析每个技能
    for (const skillPath of manifest.skills) {
      const skill = await parseSkillFromPath(installPath, skillPath);
      if (skill) {
        skills.push(skill);
      }
    }
  } catch {
    // 忽略错误，返回已解析的技能
  }

  return skills;
}

/**
 * 解析技能文件内容 (用于外部调用)
 *
 * @param filePath SKILL.md 文件路径
 * @returns 解析后的技能信息数组
 */
export async function parseSkillFile(filePath: string): Promise<ParsedSkill[]> {
  try {
    if (!(await fs.pathExists(filePath))) {
      return [];
    }

    const content = await fs.readFile(filePath, 'utf-8');
    return parseSkillContent(content);
  } catch {
    return [];
  }
}

/**
 * 解析技能内容字符串
 *
 * @param content SKILL.md 内容
 * @returns 解析后的技能信息数组
 */
export function parseSkillContent(content: string): ParsedSkill[] {
  const { tools, description } = parseSkillMd(content);

  // 如果有工具，每个工具作为一个独立的技能返回
  if (tools.length > 0) {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description || description,
      content: description,
      tools: [tool]
    }));
  }

  // 如果没有工具，返回一个基本技能
  return [{
    name: '',
    description,
    content,
    tools: []
  }];
}

/**
 * 从技能路径提取技能名称
 */
export function extractSkillName(skillPath: string): string {
  return skillPath.split('/').pop() || skillPath;
}
