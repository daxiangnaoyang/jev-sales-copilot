# 微信读取、Jev 与 Agent 接入方案

状态：`ARCHITECTURE_READY`。当前仓库仍只运行 Demo Provider；本文是下一阶段真实接入的边界，不代表已经取得微信读取权限或已经接通外部模型。

## 1. 借鉴什么，不复制什么

参考项目 [jev-chat-windows](https://github.com/jev-chat/jev-chat-windows) 的有效思路是边界设计：

```text
只读自己的微信窗口
  → 截图留在内存
  → 本地 OCR / 解析
  → 按会话去重，只处理新出现的对方消息
  → Jev 做结构化判断
  → Agent 起草候选
  → 用户检查后复制/填入
  → 用户自己点击发送
```

可借鉴的工程点：

- 采集、OCR 和界面分进程/线程，避免 OCR 卡住 UI。
- 对窗口画面先等待稳定，再交给 OCR，避免把滚动动画当成新消息。
- 用会话标题和消息相似度去重，避免重复调用模型。
- 调试视图只在内存显示识别框，不默认保存截图。
- “填入输入框”和“发送”是两个不同权限；默认只做前者。
- Jev 判断、Agent 起草、Jev 排序拆成可替换 Provider，模型失败时有降级路径。

不直接复制的部分：

- Windows Graphics Capture、Win32 窗口句柄、RapidOCR 和 Windows 键盘事件不能直接用于 macOS。
- 不读取微信数据库、不注入进程、不解密、不调用微信私有接口。
- 不把参考项目的个人聊天提示词、关系模型或平台假设混进销售副驾。

## 2. 独立 App 的推荐分层

```text
┌──────────────────────────────────────────────┐
│ React UI / Tauri 窗口                         │
│ 对话、Jev 判断、Agent 策略、素材与人工确认     │
└───────────────────┬──────────────────────────┘
                    │ Tauri commands / events
┌───────────────────▼──────────────────────────┐
│ Rust orchestration layer                      │
│ 权限、Provider 调度、状态机、脱敏、日志边界     │
└───────────┬──────────────┬───────────────────┘
            │              │
┌───────────▼──────┐ ┌─────▼──────────────────┐
│ Capture Adapter    │ │ Intelligence Providers │
│ macOS / Windows    │ │ Jev / Agent / Skill    │
└───────────┬──────┘ └─────┬──────────────────┘
            │              │
┌───────────▼──────┐ ┌─────▼──────────────────┐
│ OCR + normalizer  │ │ product-showcase       │
│ session + dedupe   │ │ 图文 / 配图 / 15 秒视频 │
└───────────────────┘ └────────────────────────┘
```

App 的核心状态不要直接绑定微信：

```ts
type ConversationSnapshot = {
  source: "manual" | "clipboard" | "wechat-screen";
  sessionKey: string;
  title?: string;
  messages: Array<{
    from: "customer" | "seller";
    name?: string;
    text: string;
    capturedAt: string;
  }>;
  latestFrom: "customer" | "seller";
  capturedAt: string;
  evidence: "user-pasted" | "ocr";
};
```

这样可以先用手动粘贴验证全部业务流程，再替换 `ConversationAdapter`，不会因为微信采集尚未完成而阻塞 App 开发。

## 3. macOS 微信读取方式

### 推荐路径：ScreenCaptureKit + Vision

Mac 端第一版建议这样实现：

1. 通过 `CGWindowListCopyWindowInfo` 找到当前用户可见的微信窗口。
2. 由 Swift 原生小模块使用 ScreenCaptureKit 捕获指定窗口，而不是全屏录制。
3. 每帧只在内存中保留；比较消息区像素，画面稳定后才送 OCR。
4. 使用 Vision 的 `VNRecognizeTextRequest` 做中文 OCR。
5. 先识别会话标题，再识别消息区；用气泡区域、左右位置和颜色区分客户/销售。
6. 归一化为 `ConversationSnapshot`，按 `sessionKey + 文本相似度 + 位置` 去重。

Screen Recording 权限是明确的系统权限。第一次启用时要展示用途、权限状态和“暂停采集”开关；拒绝权限时仍可使用手动粘贴模式。

### 为什么不把 OCR 放在 React 里

OCR 和窗口捕获属于平台能力，放在前端会带来权限、性能和打包问题。Tauri 前端只接收脱敏后的文本事件；截图、OCR 原图和识别框不进入日志，也不默认落盘。

### 输入框填入

第二阶段再做：

```text
用户点“填入微信”
  → 原生层写入剪贴板
  → 用户确认目标窗口
  → 可选地请求 Accessibility 权限并聚焦输入框
  → 粘贴文字
  → 停止
```

禁止把回车、发送按钮点击或自动轮询发送加入默认流程。最小可行版本只提供“复制”，这样不需要 Accessibility 权限也能工作。

## 4. Jev 怎么接入

Jev 负责判断，不负责写长文。官方 TypeSafe HTTP 入口是 `POST https://api.typesafe.ai/v1/systemone`，请求包含 `state`、`model` 和 typed `questions`；销售副驾应把最近对话、客户卡片和已确认产品事实放进结构化 `state`。

建议一轮并行问这些窄问题：

| 判断 | 类型 | 作用 |
|---|---|---|
| 客户意图 | `Choice` | 了解、比较、索要资料、询价、异议、售后 |
| 销售阶段 | `Choice` | 需求了解、评估、谈判、决策、售后 |
| 当前需要 | `Choice` | 信息、适配、证明、价格、风险、下一步 |
| 兴趣温度 | `Score` | 0—9，描述每一级具体行为 |
| 商业风险 | `Score` | 0—9，涉及价格、承诺、投诉、退款等 |
| 是否现在回复 | `Noul` | 判断是否需要实质性承接 |
| 是否需要素材 | `Noul` | 判断是否调用 `product-showcase` |
| 是否必须人工确认 | `Noul` | 价格、交期、退款、效果承诺等分支拦截 |

Jev 只接收文本/JSON 状态，不直接接产品图片；图片先由本地产品事实卡或视觉模块提取“图中可见事实”，再把必要文字摘要送入判断。Jev 的结果保留原始概率和问题版本，前端只展示经过业务阈值处理后的结论。

真实 Provider 的边界应类似：

```ts
interface JevDecisionProvider {
  id: string;
  judge(snapshot: ConversationSnapshot): Promise<JevDecision>;
}
```

当前 `demoJevProvider` 继续保留，作为无密钥回归用例，不与真实判断混淆。

## 5. Agent 怎么接入

Agent 接收 Jev 的结构化判断，不重新猜客户意图：

```text
ConversationSnapshot
  + JevDecision
  + CustomerProfile
  + ProductFactCard（可选）
  → AgentStrategyProvider
  → CustomerStrategy
```

Agent 的输出必须是受约束的结构，而不是一段不可审计的自由文本：

- 本轮唯一目标。
- 唯一下一步动作。
- 一个关键追问。
- 2—3 条候选回复。
- 跟进条件和停止条件。
- `unsupportedClaims`：价格、折扣、交期、认证、功效、评价等未核实字段。
- `humanConfirmationRequired`：需要人看后才能复制的分支。
- 可选的 `AssetRequest`：仅当客户确实需要资料、对比或转发内容时调用。

Agent 可以接 OpenAI 兼容接口、用户自有 Agent 网关或本地模型，但都要实现同一个 `AgentStrategyProvider`。不要让 Agent 直接拥有“读取屏幕、点击发送、调用任意工具”的权限；工具调用只允许通过 App 的白名单命令，并且发送命令不存在。

## 6. 密钥和隐私边界

推荐分两档：

### 本地直连（开发版）

- Tauri 原生层从 macOS Keychain 读取 `TYPESAFE_API_KEY` 和 Agent Provider key。
- 前端不接触 key，不写入 `localStorage`、配置文件或日志。
- 网络请求只发送最近 N 条必要文本和已确认事实。
- 截图、OCR 原图和客户完整历史不随请求上传。

### 用户自有网关（正式版更推荐）

- App 只连用户配置的本地/自有网关。
- 网关再调用 Jev 和 Agent，便于统一审计、限流、脱敏和换模型。
- App 仍保持无服务端依赖的基本手动模式。

无论哪种方式，Jev/Agent 都不能获得自动发送权限。商业风险高、事实缺失或置信度不足时，只能返回“需要人工确认”。

## 7. 独立 App 的实现顺序

### Phase 1：无权限可用

- 当前 React + Tauri UI。
- 手动粘贴聊天记录。
- Demo Jev / Demo Agent。
- 复制候选回复和素材任务。

### Phase 2：真实智能层

- 在 Rust 原生层接 TypeSafe Jev HTTP/SDK。
- 接一个 Agent Provider，严格校验 JSON 输出。
- 增加超时、重试、脱敏和离线降级。
- 用脱敏对话回归 `intent / stage / risk / next_action`。

### Phase 3：Mac 微信适配器

- Swift ScreenCaptureKit + Vision sidecar。
- 会话跟随、稳定帧、OCR 去重、暂停开关。
- 先只读，不做填入。

### Phase 4：人工辅助闭环

- 复制按钮长期保留。
- 可选 Accessibility 填入输入框。
- 人工确认后发送；不实现自动发送。

### Phase 5：素材执行器

- 接入产品事实卡。
- 调用 `product-showcase` 生成推荐语、朋友圈短文、图解任务和精确 15 秒脚本。
- 有真实图像/视频文件才标记为已生成，否则标记为任务草稿或 Prompt。

## 8. 验收标准

- 没有 Screen Recording 权限时，手动模式仍可完整运行。
- 采集暂停后不再读屏、不再触发 Jev/Agent；已有候选仍可复制。
- 同一条 OCR 消息重复出现不会重复调用模型。
- Jev 失败时有本地/手动降级，不阻塞用户复制。
- Agent 输出缺字段、越权字段或未经核实承诺时被拦截。
- 任何路径都没有“自动发送”命令。
- 日志不含聊天全文、截图和 API key。
- `npm run build`、`cargo check` 和脱敏回归用例通过后，才能进入真实窗口测试。

