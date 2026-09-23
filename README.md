# Jev 销售副驾

macOS 桌面应用，用于整理客户沟通、生成销售跟进策略、制作产品介绍素材，并记录沟通复盘。

## 功能

- 客户管理：手动新增、选择客户，保存客户资料与沟通记录。
- 销售副驾：读取粘贴或导入的对话，生成结构化判断、下一步策略和候选回复。
- 产品素材：整理产品事实与图片，生成推荐语、朋友圈短文、电商图解结构草稿和 15 秒视频脚本。
- 沟通复盘：回看每轮对话、判断、策略和风险，并标记复盘状态。
- 微信辅助：手动触发会话列表识别和当前会话 OCR；可将候选回复回填到微信输入框。

## 开发

技术栈：React、TypeScript、Vite、Tauri 2、Rust。macOS 微信窗口识别使用 ScreenCaptureKit，文字识别使用 Vision。

需要 Node.js、npm、Rust 工具链及 macOS Command Line Tools。开发和浏览器演示：

```bash
npm install
npm run dev
```

浏览器打开 `http://127.0.0.1:1420`。浏览器模式用于界面演示；微信窗口读取及真实模型调用需要 macOS 桌面 App。

检查前端并运行 Rust 测试：

```bash
npm run build
cd src-tauri
cargo fmt --check
cargo test
```

构建 macOS App：

```bash
npm run tauri -- build --bundles app
```

生成文件位于 `src-tauri/target/release/bundle/macos/Jev 销售副驾.app`。

## 使用

### 模型与服务

从左侧栏底部打开“模型与服务配置”。

- **客户判断：Bocha Jev**。固定使用 `bocha-jev-v1`，接口为 `https://jev.bocha.cn/v1/systemone`。输入 Bocha Jev Client API Key，或在启动环境提供 `BOCHA_JEV_API_KEY`（兼容 `BOCHA_SEARCH_API_KEY`）。
- **Agent 策略模型**：可选本机 Demo、本机 Ollama、OpenRouter 免费路由、OpenAI API 或自定义 OpenAI-compatible 服务。按所选服务填写模型 ID；先测试连接可读取模型目录。
- Agent 服务、接口地址和模型 ID 会保存在本机；API Key 只在当前运行期间保留，不保存。Bocha Jev 和云端 Agent 的对话授权分别设置，重启后需重新授权。
- 测试连接只检查服务的模型目录，不发送客户对话，也不生成内容。云服务额度与费用按对应服务商账户和当前政策为准。

### 客户沟通

1. 新增或选择客户，粘贴聊天内容，或在微信打开目标窗口后手动触发会话识别/当前会话读取。
2. 检查识别文本，选择 Agent 服务，并分别授权需要接收本轮对话的服务。
3. 点击“生成策略”，查看客户判断、下一步动作和候选回复。
4. 复制回复，或使用回填功能放入微信输入框；检查无误后由用户手动发送。

微信截图和 OCR 在本机处理。读取微信窗口需要 macOS“屏幕录制”权限；回填输入框需要“辅助功能”权限。应用不会自动发送微信消息。会话列表识别处理当前可见内容，使用前请核对导入结果。

Bocha Jev 收到的对话最多 6 条且总长不超过 300 字符；Agent 请求最多接收 12,000 字符。启用云端服务前请检查设置页授权说明。

### 产品素材与沟通复盘

在“产品素材”中录入产品事实、添加图片并生成可审阅的文案与内容结构。在“沟通复盘”中查看已生成的判断和策略并标记复盘。当前产品图解为结构草稿，视频内容为解说脚本；它们不是已渲染的图片或视频成片。

客户资料、聊天记录、产品素材图片、产品信息和复盘记录保存在本机应用数据中。

## 项目结构

- `src/App.tsx`：应用页面与交互流程。
- `src/persistence.ts`：本地资料和服务偏好存储。
- `src/product.ts`、`src/strategy.ts`：产品内容与本地策略构造。
- `src-tauri/src/lib.rs`：Tauri 命令注册。
- `src-tauri/src/macos_wechat.rs`：macOS 微信窗口、OCR、回填及模型服务请求。
- `docs/ARCHITECTURE.md`：当前代码结构和调用流程。
- `docs/WECHAT-AGENT-JEV.md`：微信与模型服务使用及开发说明。

## Bocha Jev 接口

[Bocha Jev Skill/API 文档](https://jev.bocha.cn/install/skill.md)

## License

MIT
