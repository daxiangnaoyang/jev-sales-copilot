# Jev 销售副驾

独立于 AgentHub Desktop 的客户沟通桌面 App。`Jev 销售副驾` 保留为应用名称；客户对话结构化决策由 Bocha Jev 提供，Agent 负责生成策略与候选回复。

```text
用户授权 → 客户对话 → Bocha Jev 结构化判断 → 可选 Agent 策略 → product-showcase 素材任务 → 人工复制/发送
```

## 当前状态

GitHub 上的 `v0.0.1` 是源码演示 MVP；当前本地工作树继续开发：

- 提供销售副驾、产品素材、沟通复盘三个工作区。
- 销售副驾包含客户对话、Bocha Jev 决策、Agent 策略和候选回复。
- 产品素材包含产品事实卡、本机保存的产品图、推荐语、朋友圈短文、电商图解结构草稿和精确 15 秒视频脚本。
- 沟通复盘保存 Bocha Jev 判断、Agent 策略、风险、可复用规则和“已复盘”状态。
- 客户可手动新增；微信会话列表不再启动时自动导入。用户显式触发后，本机 OCR 目前只识别可见候选；无群聊标记不等于已证明单聊，且自动滚动尚未实现，严格“最近 20 个单聊”未验收。
- 客户决策由 Bocha Jev `bocha-jev-v1` 通过 Choice/Score/Noul 输出结构化结果；Agent 支持本地 Demo、Ollama、自定义 OpenAI-compatible、OpenAI 与 OpenRouter 路由。Bocha Jev 与云端 Agent 分别授权。
- Bocha Jev 只在用户勾选授权并点击“生成策略”后接收最近最多 6 条对话（最多 300 字符）；API Key 只保留在本次运行内存，不写入本机存储或日志。
- 定义了 `SalesDecision` / `CustomerStrategy` 结构化数据契约。
- 能生成 `product-showcase` 本地素材包草稿，但不会把结构草稿冒充成最终图片或成片。
- macOS 桌面端不会在启动时导入微信名单；用户手动触发后，当前仅尝试识别可见候选。名称中的显式群聊标记会被跳过，但纯名称 OCR 不能可靠证明无标记群聊是单聊，列表滚动与严格类型识别仍待完成。“读取当前会话”也是独立的手动操作。
- 浏览器演示和采集失败时保留手动粘贴/复制兜底；不自动报价，不自动承诺折扣、交期或退款。

客户、聊天、产品事实、产品图片和复盘记录保存在本机应用存储；图片缩放后保存。授权后，Bocha Jev 会处理发送的对话片段；免费额度与费用以 Bocha 账号当前政策为准。API Key 关闭/重启 App 后需重新填写（也支持从应用启动环境读取密钥）。Agent 云 API 费用按所选模型及用量另计；OpenRouter 免费路由仍是第三方云服务。微信截图/OCR 在本机处理，不后台轮询。macOS 采集方案见 [微信、Agent 与 Bocha Jev 接入方案](./docs/WECHAT-AGENT-JEV.md)。

Bocha Jev 接口契约与安装说明：[官方 Skill/API 文档](https://jev.bocha.cn/install/skill.md)。

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

### 构建 macOS App

不需要安装完整 Xcode；安装 Apple Command Line Tools 即可。缺少时运行 `xcode-select --install`，然后：

```bash
npm install
npm run tauri -- build --bundles app
```

生成位置：`src-tauri/target/release/bundle/macos/Jev 销售副驾.app`。这是本机测试包，使用 ad-hoc 签名，未做 Developer ID 签名和公证；公开分发仍需单独完成签名、公证与安装验收。

微信读取需要“屏幕录制”权限；输入框回填需要额外授予“辅助功能”权限。用户已确认授权；但本轮 Mac 锁屏，未能启动新包做真实微信/OCR 验证，不能宣称权限链路已实测通过。权限拒绝、微信未运行或定位不到输入框时，可手动粘贴。App 不会自动点击发送。

## 设计边界

- Skill 是策略和内容能力，App 是交互与权限边界。
- Bocha Jev 负责结构化客户判断；Agent 负责生成下一步策略和回复。
- Agent 负责生成一个最高优先级下一步、一个关键问题和候选回复。
- 产品素材只在客户明确需要资料、对比或转发内容时按需调用。
- 对客户聊天的读取、上传、填入和发送都必须有清晰的用户授权；发送始终由用户确认。

## 后续路线

1. 将 OCR 文本归一化为按说话方区分的会话消息，并用脱敏对话回归意图、阶段、风险和动作准确度。
2. 用用户自己的 Bocha Jev API Key 做授权后的连通验收；云端 Agent 仍由用户独立授权。
3. 用真实微信版本验证窗口筛选、权限引导、输入框定位/回读及失败兜底。
4. 将 `product-showcase` 草稿接到真实图像/视频能力，并增加素材包导出。
5. 完成 macOS 桌面包、签名与分发验证；当前仓库尚未提供已签名安装包。

## 当前推荐的独立 App 路线

App 独立运行于 AgentHub Desktop 之外。微信名单导入保持显式手动触发；当前 OCR 只能过滤带明显群聊标记的名称，不能保证排除所有群聊，也未实现自动翻页，因此严格单聊导入仍未验收。读取当前会话、Agent 策略处理及候选回复回填保持为单独操作；发送消息仍由用户手动完成。

## License

MIT
