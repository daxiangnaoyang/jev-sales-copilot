# 微信与模型服务使用 / 开发说明

## 使用微信功能

1. 在 macOS 打开微信并登录，再启动 Jev 销售副驾。
2. 如系统询问，允许应用进行屏幕录制；若系统设置未出现提示，可在“系统设置 → 隐私与安全性 → 屏幕录制”中开启。
3. 在客户工作区手动触发会话列表识别，检查识别出的名称后导入客户；也可手动新增客户。
4. 打开目标客户会话后，手动触发“读取当前会话”。识别文本会显示在应用中，生成前可检查和编辑；也可直接粘贴聊天记录。
5. 生成候选回复后，可复制或回填到微信输入框。回填需要在“系统设置 → 隐私与安全性 → 辅助功能”中允许 Jev 销售副驾访问微信。发送仍由用户在微信中完成。

窗口截图与 OCR 在本机进行。会话列表按当前可见内容识别，用户应核对名称和聊天内容。应用不会后台持续读取微信，也不会自动发送消息。权限或识别不可用时，可以手动粘贴和复制。

## 配置 Bocha Jev

从左侧栏底部打开“模型与服务配置”。客户判断使用固定服务：

- 模型：`bocha-jev-v1`
- 决策接口：`https://jev.bocha.cn/v1/systemone`
- 模型目录检查：`https://jev.bocha.cn/v1/models`

在设置中输入 Bocha Jev Client API Key，或在启动应用的环境中设置 `BOCHA_JEV_API_KEY`。兼容读取 `BOCHA_SEARCH_API_KEY`。密钥仅保留在应用本次运行内存。

选择“测试 Bocha Jev 连接”会读取模型目录，不提交客户内容。勾选授权后，点击“生成策略”才会将最近最多 6 条、总长不超过 300 字符的对话发送到 Bocha Jev。账号可用额度和收费以 Bocha 当前账户页面为准。

## 配置 Agent

Agent 负责根据客户判断生成下一步策略和候选回复。服务选择如下：

- **本机 Demo**：演示策略，不请求外部模型。
- **本机 Ollama**：填写本机服务地址与已安装的模型 ID；API Key 可留空。
- **OpenRouter 免费路由**：填写 OpenRouter API Key，模型使用 `openrouter/free` 路由。
- **OpenAI API**：填写 API Key 和模型 ID。
- **自定义 OpenAI-compatible**：填写 HTTPS Base URL、API Key 和模型 ID；本机回环地址允许 HTTP。

输入模型 ID 后可以测试连接读取模型目录，并从可用 ID 中选择。Agent 服务类型、Base URL 和模型 ID 保存在本机；API Key 不保存，关闭应用后需要重新输入。云端 Agent 需要单独勾选数据授权；该授权只对本次应用运行有效。

Agent 连接检查只读取 `/models`，不提交聊天内容、不生成内容。运行策略时，Agent 最多接收 12,000 字符的对话文本及结构化判断；云端服务的费用按服务商账户和模型用量计算。

## 开发入口

前端调用和界面位于 `src/App.tsx`；Agent 服务偏好存储位于 `src/persistence.ts`。Tauri 命令注册在 `src-tauri/src/lib.rs`，macOS 微信采集和模型请求实现在 `src-tauri/src/macos_wechat.rs`。

主要命令：

- `scan_wechat`：枚举并读取目标微信窗口。
- `import_recent_wechat_customers`：读取会话列表可见区域。
- `bocha_jev_decide` / `check_bocha_jev_provider`：Bocha Jev 判断与连通检查。
- `agent_strategy` / `check_agent_provider`：Agent 生成与模型目录检查。
- `fill_wechat_input`：回填候选文本，不点击发送。

本地开发与构建命令见 [README](../README.md#开发)。
