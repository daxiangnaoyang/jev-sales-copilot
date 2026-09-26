# 当前架构

## 技术组成

- 前端：React + TypeScript，Vite 构建。
- 桌面容器：Tauri 2，Rust 命令处理原生能力和模型服务请求。
- macOS 微信读取：ScreenCaptureKit 获取目标窗口单帧，Vision 在本机识别文字。
- 浏览器聊天读取：用户每次通过 `getDisplayMedia` 选择共享窗口，Tesseract.js 在浏览器本机识别所框选的一帧区域。
- 应用数据：浏览器本机存储保存客户、对话、产品资料、复盘记录和非敏感服务偏好。

## 调用流程

```text
手动文本 / 桌面微信 OCR / 浏览器选屏 OCR
        ↓
本机对话与客户记录
        ↓ 用户授权并点击生成
Bocha Jev 结构化判断
        ↓
Agent 策略与候选回复
        ↓
人工检查 → 复制或回填 → 人工发送
```

浏览器不能直接访问原生聊天 App，但可通过 `getDisplayMedia` 让用户逐次选择共享源，截取单帧后由 Tesseract.js 在本机 OCR。聊天模式框选会话标题和消息区域：只有标题唯一精确匹配客户时才自动选择；未匹配时不会沿用上次客户，用户可核对后新建客户或手动选择。逐条校对文本、日期和说话方后，聊天文本载入客户草稿；名单最多添加 10 个需复核的候选。该路径不上传截图、不自动切换或滚动外部 App；首次 OCR 从 Tesseract.js 分发源下载并缓存运行时和中文模型。该适配方式可用于企业微信等任何可共享的聊天窗口，但不是专用集成或官方会话存档 API。客户策略网页样例仍使用本地 Demo；若用户主动提交产品资料或视频任务，浏览器可直接请求配置的服务，需服务端允许 CORS。macOS 桌面端保留独立原生采集路径。

产品素材与沟通复盘是独立工作区。产品素材通过一次 Agent 对话提交产品文字和多张图片：桌面端使用 Rust `agent_product_intake`，网页端使用 `browser-agent.ts`；结果回填为可编辑事实卡。用户点击一次确认后，只把有文字或图片证据的条目确认，证据不足仍待核实。随后生成推荐语、朋友圈文案、电商图解结构及 15 秒视频脚本。视频服务可选火山方舟 Seedance 2.5：`video-storyboard.ts` 将分镜和已上传产品图转换成请求，网页模式由 `video-provider.ts` 直接请求、桌面模式通过 Tauri/Rust 请求；任务由用户明确提交，后台只轮询状态，不会因轮询重提生成。视频链接供应商端仅有效 24 小时，须及时打开或保存。沟通复盘保留生成时的对话、判断和策略。

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
- 产品素材另走 `agent_product_intake`；每轮最多 8 张 JPEG、文字最多 12,000 字，提交时明确告知用户将发往当前 Agent 服务。服务返回的事实按文字、图片可见、待确认分类，默认保持待核对；用户可检查后一键按来源确认。不支持视觉输入的模型会返回错误，原素材保留在输入框供重试。
- 网页端 Agent 请求通过浏览器发送至用户配置的 HTTPS/localhost 服务，API Key 仅保存在本次页面内存；跨域策略可能阻止请求。应用不会代理或保存服务凭据。

### 视频生成

- 视频服务偏好（provider、model）保存在本机；视频 API Key 不持久化。
- Seedance 连通检查只读取 `/models`；创建任务调用 `/contents/generations/tasks`，查询调用 `/contents/generations/tasks/{id}`。
- 固定生成时长为 15 秒，比例由分镜选项决定，最多 12 张本机产品图作为参考；提示词及参考图会发送给服务商，调用可能计费。
- 不在开发验收中创建真实视频任务。需要可回读的成片时由用户从产品分镜页主动发起；成功链接有效 24 小时，预览/保存后必须人工检查。

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
- `src/browser-conversation.ts`：浏览器手动转录的元信息过滤、说话方解析与客户对话导入。
- `src/BrowserScreenReader.tsx`、`src/browser-screen-capture.ts`：浏览器用户授权的单帧采集、区域 OCR 与逐行确认。
- `src/browser-agent.ts`：网页模式 Agent 模型目录检查和多模态产品整理。
- `src/video-provider.ts`、`src/video-storyboard.ts`：视频任务请求与分镜提示词。
- `src/browser-screen-reader-utils.ts`：OCR 行分类、日期过滤与草稿格式化。
- `src/product.ts`：产品事实与内容草稿生成。
- `src/product-intake.ts`：Agent 素材整理结果与事实卡合并规则。
- `src-tauri/src/lib.rs`：原生命令注册。
- `src-tauri/src/macos_wechat.rs`：macOS 窗口采集、OCR、回填和 Agent/视频 HTTP 服务调用。

开发命令、构建命令和使用步骤见 [README](../README.md)。
