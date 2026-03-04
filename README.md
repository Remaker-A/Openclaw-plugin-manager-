# OpenClaw 插件管理器

一个基于 MCP (Model Context Protocol) 的插件管理器，支持技能发现、插件搜索和一键安装。

## 功能特性

- **技能检查** - 检查某个技能是否已安装或可用
- **插件搜索** - 从本地市场、npm、GitHub、MCP Marketplace 搜索插件
- **一键安装** - 自动安装插件及其依赖
- **进度反馈** - 详细的安装步骤和进度追踪
- **版本检测** - 检查已安装插件是否有更新

## MCP 工具列表

| 工具名称 | 功能 |
|---------|------|
| `plugin_check_skill` | 检查技能是否可用 |
| `plugin_auto_install` | 自动检测并安装技能对应的插件 |
| `plugin_install` | 一键安装插件 |
| `plugin_install_progress` | 带详细进度反馈的安装 |
| `plugin_uninstall` | 卸载插件 |
| `plugin_search_market` | 搜索插件市场 |
| `plugin_list_installed` | 列出已安装插件 |
| `plugin_refresh_skills` | 刷新技能缓存 |
| `plugin_check_updates` | 检查插件更新 |
| `plugin_check_multiple_skills` | 批量检查多个技能 |
| `plugin_status_summary` | 获取插件系统状态摘要 |

## 安装

```bash
# 安装依赖
npm install

# 构建
npm run build
```

## 使用方式

### 作为 MCP 服务器运行

```bash
# 开发模式
npm run dev

# 生产模式
npm run build && npm start
```

### 配置到 Claude Desktop

在 Claude Desktop 配置文件中添加：

```json
{
  "mcpServers": {
    "openclaw-plugin-manager": {
      "command": "node",
      "args": ["/path/to/openclaw-plugin-manager/dist/index.js"]
    }
  }
}
```

## 项目结构

```
openclaw-plugin-manager/
├── src/
│   ├── index.ts                    # MCP 服务入口
│   ├── types.ts                    # 类型定义
│   ├── services/
│   │   ├── market-service.ts       # 本地市场服务
│   │   ├── external-market-service.ts  # 外部市场服务
│   │   ├── skill-resolver.ts       # 技能解析器
│   │   └── plugin-installer.ts     # 插件安装器
│   └── tools/
│       ├── check-skill.ts          # 检查技能
│       ├── install.ts              # 安装/卸载插件
│       ├── install-progress.ts     # 带进度的安装
│       ├── auto-install.ts         # 自动安装
│       ├── list-installed.ts       # 列出已安装
│       ├── search-market.ts        # 搜索市场
│       ├── refresh-skills.ts       # 刷新技能
│       └── check-updates.ts        # 检查更新
├── data/
│   └── market_plugins.json         # 市场插件数据
├── package.json
└── tsconfig.json
```

## 使用示例

### 检查技能

```json
{
  "tool": "plugin_check_skill",
  "arguments": {
    "skill_name": "web_search"
  }
}
```

响应：
```json
{
  "status": "installed",
  "plugin_id": "web-search",
  "message": "网页搜索插件已就绪",
  "ready": true
}
```

### 自动安装

```json
{
  "tool": "plugin_auto_install",
  "arguments": {
    "skill_name": "xiaohongshu_search",
    "auto_confirm": true
  }
}
```

### 搜索市场

```json
{
  "tool": "plugin_search_market",
  "arguments": {
    "keyword": "搜索",
    "source": "all"
  }
}
```

## 数据存储

- 插件安装目录: `~/.openclaw/extensions/`
- 已安装记录: `~/.openclaw/extensions/installed_plugins.json`
- 主配置文件: `~/.openclaw/openclaw.json`
- 技能缓存: `~/.openclaw/cache/skills_cache.json`
- 市场缓存: `~/.openclaw/cache/market_cache.json`

## 开发

```bash
# 开发模式运行
npm run dev

# 构建
npm run build

# 清理构建
npm run clean
```

## 许可证

MIT
