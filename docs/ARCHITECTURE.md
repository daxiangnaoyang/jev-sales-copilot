# 当前架构

## 技术组成

- 前端：React + TypeScript，Vite 构建。
- 桌面容器：Tauri 2，Rust 命令处理原生能力和模型服务请求。
- macOS 微信读取：ScreenCaptureKit 获取目标窗口单帧，Vision 在本机识别文字。
- 应用数据：浏览器本机存储保存客户、对话、产品资料、复盘记录和非敏感服务偏好。

## 调用流程

```text
手动文本 / 微信 OCR
        ↓
本机对话与客户记录
        ↓ 用户授权并点击生成
Bocha Jev 结构化判断
        ↓
Agent 策略与候选回复
        ↓
人工检查 → 复制或回填 → 人工发送
```

产品素材与沟通复盘是独立工作区。产品素材读取本机产品事实和图片，生成推荐语、朋友圈文案、电商图解结构及 15 秒视频脚本。沟通复盘保留生成时的对话、判断和策略。

## 模型服务

### Bocha Jev

- Rust 命令：`bocha_jev_decide`；服务连通检查：`check_bocha_jev_provider`。
- 固定接口 `POST https://jev.bocha.cn/v1/systemone`，模型 `bocha-jev-v1`。
- 输入由前端限制为最近最多 6 条对话，合计最多 300 字符；Rust 层再次校验长度。
- API Key 接受设置页输入，也可从 `BOCHA_JEV_API_KEY` 或兼容变量 `BOCHA_SEARCH_API_KEY` 读取。密钥不写入本机存储。
- 只有用户启用 Bocha Jev 授权并点击“生成策略”时才提交对话。连接检查只请求 `/v1/models`。

### Agent

- Rust 命令：`agent_strategy`；服务连通检查：`check_agent_provider`。
- 服务选项：本机 Demo、本机 Ollama、OpenRouter 免费路由、OpenAI API、自定义 OpenAI-compatible。
- 云端服务须填写 API Key 并单独授权；本机服务可在本机处理。策略请求最多 12,000 字符。
- 服务选择、Base URL 和模型 ID 保存在本机；API Key 不持久化。连接检查读取 `/models`，最多读取 50 个模型 ID。
- 生成响应按应用要求解析为结构化策略和 2–3 条候选回复，并校验风险字段。

## 微信命令

`src-tauri/src/macos_wechat.rs` 提供以下命令：

- `scan_wechat`：识别微信窗口并读取当前会话。
- `import_recent_wechat_customers`：读取当前可见的会话列表名称。
- `request_screen_capture_access`：请求屏幕录制权限。
- `fill_wechat_input`：检查目标窗口和输入框后回填文本，不执行发送。

截图和 OCR 结果不默认写入磁盘。会话列表识别由用户手动触发；当前可见行需在导入结果中核对。回填需要 macOS 辅助功能权限；权限不足或窗口不可用时可复制粘贴。

## 源码入口

- `src/App.tsx`：界面、状态和工作流编排。
- `src/persistence.ts`：本机持久化和 Agent 服务偏好。
- `src/types.ts`：客户、判断、策略、产品素材和复盘的数据类型。
- `src/strategy.ts`：本地 Demo 策略与客户会话构造。
- `src/product.ts`：产品事实与内容草稿生成。
- `src-tauri/src/lib.rs`：原生命令注册。
- `src-tauri/src/macos_wechat.rs`：macOS 窗口采集、OCR、回填和 HTTP 服务调用。

开发命令、构建命令和使用步骤见 [README](../README.md)。
