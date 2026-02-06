# OpenClaw - MINIMAX + Deepseek 自动切换配置

## 🎯 功能特性

- **主模型**: MiniMax M2.1 (国内API)
- **备用模型**: Deepseek Chat/Coder (国内API)
- **智能切换**: MINIMAX限额自动切换到Deepseek，恢复后自动切回
- **实时监控**: 每60秒检测一次模型状态
- **指数退避**: 动态调整检测间隔（最大5分钟）

## 🚀 快速开始

### 1. 配置 API 密钥

编辑 `.env` 文件：

```bash
# MiniMax API 密钥
MINIMAX_API_KEY=your-minimax-api-key-here

# Deepseek API 密钥
DEEPSEEK_API_KEY=your-deepseek-api-key-here
```

### 2. 获取 API 密钥

- **MiniMax**: https://platform.minimax.io/
- **Deepseek**: https://platform.deepseek.com/

### 3. 启动服务

```bash
# 启动网关
pnpm start gateway

# 或使用 TUI 界面
pnpm start tui
```

## ⚙️ 配置说明

### 核心配置 (`openclaw.json`)

```json
{
  "models": {
    "router": {
      "enabled": true,
      "primary": "minimax",
      "fallback": "deepseek",
      "checkIntervalMs": 60000,
      "maxBackoffMs": 300000,
      "quotaThreshold": 95
    }
  }
}
```

### 切换逻辑

1. **正常状态**: 使用 MiniMax M2.1 作为主模型
2. **限额检测**: 当使用量达到95%或API返回429错误
3. **自动切换**: 立即切换到 Deepseek 模型
4. **恢复检测**: 指数退避检测 MiniMax 恢复状态
5. **自动恢复**: MiniMax 恢复后自动切回主模型

## 📝 常用命令

```bash
# 查看模型列表
pnpm start models list

# 切换主模型
pnpm start models set minimax/MiniMax-M2.1
pnpm start models set deepseek/deepseek-chat

# 查看状态
pnpm start status

# 查看日志
pnpm start logs -f

# 配置向导
pnpm start configure
```

## 🔍 监控与调试

### 查看切换状态

```bash
# 实时日志
grep -i "switcher\|router" ~/.openclaw/logs/gateway.log

# 模型状态
pnpm start models list
```

### 日志位置

```
~/.openclaw/logs/
├── gateway.log      # 网关日志
└── agent.log        # 代理日志
```

## 🛠️ 高级配置

### 自定义切换参数

编辑 `openclaw.json`：

```json
{
  "models": {
    "router": {
      "checkIntervalMs": 30000, // 检测间隔（毫秒）
      "maxBackoffMs": 600000, // 最大退避时间
      "quotaThreshold": 90 // 限额阈值（%）
    }
  }
}
```

### 模型参数

```json
{
  "agents": {
    "defaults": {
      "timeoutSeconds": 300, // 请求超时
      "thinkingDefault": "medium", // 思考级别
      "humanDelay": {
        "mode": "off" // 人工延迟
      }
    }
  }
}
```

## 🔒 安全建议

1. **保护 API 密钥**: 不要提交 `.env` 文件到 Git
2. **定期轮换**: 定期更新 API 密钥
3. **监控使用**: 关注模型使用量，避免突发费用

## 🐛 故障排除

### 模型切换不工作

1. 检查配置是否正确加载
2. 确认 API 密钥有效
3. 查看网关日志中的切换信息

### API 调用失败

1. 检查网络连接
2. 验证 API 密钥权限
3. 查看具体的错误信息

### 性能问题

1. 调整检测间隔时间
2. 优化模型参数
3. 监控资源使用情况

## 📚 相关链接

- [MiniMax 官方文档](https://platform.minimax.io/docs)
- [Deepseek 官方文档](https://platform.deepseek.com/docs)
- [OpenClaw 官方文档](https://openclaw.io/docs)

---

**注意**: 本项目已移除飞书集成，专注于 MINIMAX 和 Deepseek 的模型自动切换功能。
