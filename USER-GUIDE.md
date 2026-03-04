# OpenClaw 插件管理器 - 用户使用指南

## 快速开始

插件管理器提供了 11 个工具，帮助你在 OpenClaw 中管理插件。

---

## 常用场景

### 场景1：我想使用某个功能，怎么知道有没有对应的插件？

**使用 `plugin_check_skill` 检查技能状态**

```
用户: 我想用网页搜索功能，有这个插件吗？

操作: 调用 plugin_check_skill
参数: { "skill_name": "web_search" }

返回结果:
{
  "status": "installed",      // installed=已安装, available=可安装, not_found=未找到
  "plugin_id": "exa-search",
  "message": "Exa Search 已就绪",
  "ready": true
}
```

---

### 场景2：我想看看有哪些插件可以安装

**使用 `plugin_search_market` 搜索市场**

```
用户: 有什么搜索相关的插件？

操作: 调用 plugin_search_market
参数: { "keyword": "搜索" }

返回结果:
{
  "status": "success",
  "count": 7,
  "plugins": [
    { "id": "xiaohongshu-mcp", "name": "小红书MCP插件", "installed": true },
    { "id": "web-search", "name": "网页搜索插件", "installed": false },
    { "id": "github-mcp", "name": "GitHub集成插件", "installed": false }
    ...
  ]
}
```

---

### 场景3：一键安装插件

**使用 `plugin_auto_install` 自动安装**

```
用户: 帮我安装翻译功能

操作: 调用 plugin_auto_install
参数: { "skill_name": "translate", "auto_confirm": true }

返回结果:
{
  "status": "installed",
  "plugin_id": "ai-translate",
  "message": "AI翻译插件 安装成功"
}
```

**或者使用 `plugin_install` 指定插件ID安装**

```
用户: 安装 github-mcp 插件

操作: 调用 plugin_install
参数: { "plugin_id": "github-mcp" }
```

---

### 场景4：查看已安装的插件

**使用 `plugin_list_installed`**

```
用户: 我安装了哪些插件？

操作: 调用 plugin_list_installed
参数: {}

返回结果:
{
  "status": "success",
  "count": 3,
  "plugins": [
    { "id": "plugin-manager-mcp", "name": "插件管理器", "version": "1.0.0" },
    { "id": "xiaohongshu-mcp", "name": "小红书MCP插件", "version": "2.0.0" },
    { "id": "openclaw-exa-search", "name": "Exa Search", "version": "1.0.5" }
  ]
}
```

---

### 场景5：查看系统状态

**使用 `plugin_status_summary`**

```
用户: 插件系统状态怎么样？

操作: 调用 plugin_status_summary
参数: {}

返回结果:
{
  "total_skills_mapped": 48,    // 已映射的技能数量
  "installed_plugins": 3,        // 已安装插件数量
  "available_plugins": 20        // 市场可用插件数量
}
```

---

### 场景6：批量检查多个功能

**使用 `plugin_check_multiple_skills`**

```
用户: 帮我检查网页搜索、翻译、天气这三个功能有没有

操作: 调用 plugin_check_multiple_skills
参数: {
  "skills": ["web_search", "translate", "weather"]
}

返回结果:
{
  "installed": ["web_search"],      // 已安装
  "available": ["translate", "weather"],  // 可安装
  "not_found": []                   // 未找到
}
```

---

### 场景7：卸载插件

**使用 `plugin_uninstall`**

```
用户: 卸载 weather-mcp 插件

操作: 调用 plugin_uninstall
参数: { "plugin_id": "weather-mcp" }
```

---

### 场景8：检查插件更新

**使用 `plugin_check_updates`**

```
用户: 检查一下插件有没有更新

操作: 调用 plugin_check_updates
参数: { "source": "all" }

返回结果:
{
  "status": "success",
  "updates": [
    { "plugin_id": "xiaohongshu-mcp", "current": "2.0.0", "latest": "2.1.0" }
  ]
}
```

---

## 工具完整列表

| 工具名称 | 用途 | 常用参数 |
|---------|------|---------|
| `plugin_check_skill` | 检查单个技能 | skill_name |
| `plugin_search_market` | 搜索插件市场 | keyword |
| `plugin_install` | 安装指定插件 | plugin_id |
| `plugin_auto_install` | 自动安装技能 | skill_name, auto_confirm |
| `plugin_list_installed` | 列出已安装插件 | 无 |
| `plugin_status_summary` | 系统状态摘要 | 无 |
| `plugin_check_multiple_skills` | 批量检查技能 | skills[] |
| `plugin_refresh_skills` | 刷新技能缓存 | plugin_id(可选) |
| `plugin_uninstall` | 卸载插件 | plugin_id |
| `plugin_check_updates` | 检查更新 | source |
| `plugin_install_progress` | 带进度安装 | plugin_id |

---

## 典型工作流程

### 新用户入门流程

```
1. 查看状态 → plugin_status_summary
   了解当前安装了几个插件，有多少技能可用

2. 搜索插件 → plugin_search_market
   搜索感兴趣的功能，如 "搜索"、"翻译"、"天气"

3. 检查技能 → plugin_check_skill
   确认某个具体功能是否已安装

4. 安装插件 → plugin_auto_install
   一键安装需要的插件

5. 验证安装 → plugin_list_installed
   确认插件安装成功
```

### 示例对话

```
用户: 我刚用 OpenClaw，能帮我看看有什么插件吗？

AI: 好的，让我帮你查看一下插件系统状态...
[调用 plugin_status_summary]

当前已安装 3 个插件，支持 48 个技能。
已安装的插件有：
1. plugin-manager-mcp - 插件管理器
2. xiaohongshu-mcp - 小红书功能
3. openclaw-exa-search - 网页搜索

你想要什么功能？我可以帮你搜索或安装。

用户: 我想要翻译功能

AI: 让我检查一下翻译功能...
[调用 plugin_check_skill, skill_name="translate"]

找到了 AI翻译插件，需要安装。帮你安装吗？

用户: 好的，帮我安装

AI: 正在安装...
[调用 plugin_auto_install, skill_name="translate", auto_confirm=true]

✅ 安装成功！现在你可以使用翻译功能了。
```

---

## 注意事项

1. **安装新插件后** - 插件管理器会自动刷新技能缓存，无需手动操作

2. **插件ID vs 技能名称**
   - `plugin_install` 需要插件ID（如 "github-mcp"）
   - `plugin_auto_install` 可以用技能名称（如 "github" 或 "代码搜索"）

3. **卸载插件** - 卸载后相关技能将不再可用，请谨慎操作

4. **网络要求** - 搜索市场和安装插件需要网络连接
