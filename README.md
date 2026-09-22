# Jev 销售副驾

独立于 AgentHub Desktop 的客户沟通桌面 App MVP。

它把 Jev 的“结构化判断 + 候选排序”思路引入销售沟通：

```text
客户消息 → Jev 判断 → Agent 生成下一步策略 → product-showcase 素材任务 → 人工复制/发送
```

## 当前状态

当前 `v0.0.1` 是源码演示 MVP：

- 提供销售副驾、产品素材、沟通复盘三个工作区。
- 销售副驾包含客户对话、Jev 判断卡、Agent 策略卡和候选回复。
- 产品素材包含产品事实卡、图片本地预览、推荐语、朋友圈短文、电商图解结构草稿和精确 15 秒视频脚本。
- 沟通复盘包含会话回看、Jev/Agent 结果、风险、可复用规则和“已复盘”状态。
- 内置本地 Demo Provider，用关键词演示结构化输出，不调用外部模型。
- 定义了可替换的 `JevDecision` / `CustomerStrategy` 数据契约。
- 能生成 `product-showcase` 本地素材包草稿，但不会把结构草稿冒充成最终图片或成片。
- 只提供复制，不自动发送，不自动报价，不自动承诺折扣、交期或退款。

真实 Jev API、屏幕采集、微信适配器和本地持久化会在下一阶段接入。接入边界和 Mac 优先方案见 [微信、Jev 与 Agent 接入方案](./docs/WECHAT-AGENT-JEV.md)。

本版本发布源码，不附带已签名的 macOS/Windows 安装包。

## 运行

```bash
npm install
npm run dev
```

浏览器打开 `http://127.0.0.1:1420`。构建检查：

```bash
npm run build
```

桌面壳已预留 Tauri 2 配置，构建桌面包前需要本机完成 Tauri 环境准备：

```bash
npm run tauri dev
```

## 设计边界

- Skill 是策略和内容能力，App 是交互与权限边界。
- Jev 只负责判断和排序，不负责长篇销售策略。
- Agent 负责生成一个最高优先级下一步、一个关键问题和候选回复。
- 产品素材只在客户明确需要资料、对比或转发内容时按需调用。
- 对客户聊天的读取、上传、填入和发送都必须有清晰的用户授权；发送始终由用户确认。

## 后续路线

1. 接入真实 Jev Decision Provider，保留 Demo Provider 作为离线回归。
2. 增加脱敏聊天导入和本地客户卡片，不默认上传全部历史。
3. 接入真实 Jev / Agent Provider，并保留 Demo Provider 做离线回归。
4. 增加 macOS 屏幕采集和输入框填入适配器，仍不自动发送。
5. 将 `product-showcase` 草稿接到真实图像/视频能力，并增加本地持久化和导出。
6. 用脱敏标注对话测试意图、阶段、风险和下一步动作准确度。

## 当前推荐的独立 App 路线

先用手动粘贴跑通“对话 → Jev → Agent → 素材任务 → 人工复制”，再接 macOS 的 ScreenCaptureKit + Vision。这样微信权限、OCR 误识别和模型服务故障不会把核心销售流程绑死，也不会引入 AgentHub Desktop 依赖。

## License

MIT
