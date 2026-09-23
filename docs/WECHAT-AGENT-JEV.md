# 微信读取、Bocha Jev 与 Agent 接入方案

状态：`BOCHA_JEV_DECISION_PROTOTYPE`。已把 Bocha Jev 设为结构化客户判断模型；Agent 为可选策略层。仅在用户授权并点击生成后调用 Bocha Jev；macOS 原生层有会话列表名称 OCR、当前会话 OCR 与输入框回填原型；微信权限和真实 OCR 仍待实测，单聊/群聊精确分类与自动翻页未完成验收。

## 1. 借鉴什么，不复制什么

参考项目以 [jev-chat-jarvis-mac](https://github.com/jev-chat/jev-chat-jarvis-mac) 为主：它的 macOS 端通过识别微信窗口、窗口级截图和 Apple Vision 做本地 OCR，再把读取、判断、生成和人工发送分层。我们借鉴这一数据流和只读边界；Windows 版本仅作为跨平台对照，不作为 macOS 实现依据。

```text
只读自己的微信窗口
  → 截图留在内存
  → 本地 OCR / 解析
  → 按会话去重，只处理新出现的对方消息
  → Bocha Jev 做结构化销售判断（需独立授权）
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
- Bocha Jev 判断、Agent 起草彼此分离：Agent 失败不影响已经取得的结构化判断；Bocha Jev 只在获授权后接收最近对话片段。

不直接复制的部分：

- Windows Graphics Capture、Win32 窗口句柄、RapidOCR 和 Windows 键盘事件不能直接用于 macOS。
- 参考 Mac 版现有实现使用 Quartz 窗口截图；新 App 改用 Apple 推荐的 ScreenCaptureKit 窗口过滤/单帧截图，避免调用已弃用的 `CGWindowListCreateImage`。
- 不读取微信数据库、不注入进程、不解密、不调用微信私有接口。
- 不把参考项目的个人聊天提示词、关系模型或平台假设混进销售副驾。

## 2. 独立 App 的推荐分层

```text
┌──────────────────────────────────────────────┐
│ React UI / Tauri 窗口                         │
│ 对话、Bocha Jev 判断、Agent 策略、素材与人工确认 │
└───────────────────┬──────────────────────────┘
                    │ Tauri commands / events
┌───────────────────▼──────────────────────────┐
│ Rust orchestration layer                      │
│ 权限、Bocha Jev/Agent 调用、状态机、数据边界     │
└───────────┬──────────────┬───────────────────┘
            │              │
┌───────────▼──────┐ ┌─────▼──────────────────┐
│ macOS Capture       │ │ Intelligence Providers │
│ ScreenCaptureKit    │ │ Local / Agent / Bocha  │
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

1. 用 macOS ScreenCaptureKit 枚举可共享窗口，按微信 bundle id/精确应用名称和主窗口尺寸自动定位，不要求用户手动选窗口。
2. 用 `SCContentFilter(desktopIndependentWindow:)` 和 `SCScreenshotManager` 只捕获选中的窗口，不做全屏录制。
3. 名单导入仅在用户点击后对微信主窗口做一帧 OCR，只处理左侧可见会话列表名称，不触碰右侧聊天正文；不会在 App 启动时自动扫描或导入。截图只在内存中保留，不做后台轮询。
4. 使用 Vision 的 `VNRecognizeTextRequest` 做中文 OCR，并按 OCR 置信度、名称长度与显式群聊关键词过滤候选。
5. 只有用户点击“读取当前会话”后，才对右侧当前会话文本做 OCR；Bocha Jev 与云端 Agent 均需用户分别授权。
6. 名称 OCR 不是聊天类型元数据：没有群关键词的群聊仍可能被当成客户；仅扫描当前可见列表，不会自动滚动。因此严格单聊排除与最近 20 条完整导入尚未完成验收。

Screen Recording 权限是明确的系统权限。此前运行曾收到 ScreenCaptureKit `-3801`；权限刷新后必须从当前打包 App 重新验证实际截图结果。权限拒绝时仍可手动粘贴；手动读取只做单帧，不持续扫描。不得把名称 OCR 的推断包装成可靠单聊分类。

### 为什么不把 OCR 放在 React 里

OCR 和窗口捕获属于平台能力，放在前端会带来权限、性能和打包问题。Tauri 前端只接收脱敏后的文本事件；截图、OCR 原图和识别框不进入日志，也不默认落盘。

### 输入框填入

```text
用户点“填入微信”
  → 重新确认微信窗口归属
  → 检查 Accessibility 权限
  → 只定位目标窗口内最大的聊天文本区
  → 输入框为空时写入候选回复并报告未发送
  → 停止
```

若输入框已有用户草稿，拒绝覆盖；无法定位/权限不足时退回复制粘贴。禁止回车、发送按钮点击或后台自动发送。

## 4. Bocha Jev 决策与权限边界

真实销售判断由 `bocha_jev_decide` 调用 `POST https://jev.bocha.cn/v1/systemone`，模型固定为 `bocha-jev-v1`。它不是 Chat Completions 或搜索 API；它对同一段 `state` 并行回答 Choice、Score 和 Noul 问题，再映射为应用的 `SalesDecision`。

当前问题覆盖客户意图、销售阶段、主要需要、兴趣温度（0–9）、商业风险（0–9）、决策角色、是否应立即回复、下一步动作和最关键的信息缺口。Choice 仅接受应用预设候选 ID；Score 只接受 0–9；Noul 是 0–1 数值概率并按 0.6 阈值转为“立即回复”；综合置信度取 Choice/Score 返回置信度中的最低值。未知候选、缺字段、错误类型或无效概率会导致本轮失败，不回退成关键词规则。

只在用户单独勾选 Bocha Jev 授权且点击“生成策略”后，App 才发送最近最多 6 条对话；本地将其限制为 300 字符，超长时要求用户先整理，不会静默截断。请求使用 Bearer API Key；Key 只在本次运行内存和调用参数中存在，也可从 `BOCHA_JEV_API_KEY` 读取，兼容已有 `BOCHA_SEARCH_API_KEY` 环境变量。请求与响应正文、聊天文本和 Key 不写入日志；非成功响应只展示状态，不回显服务端原文。

设置页的“测试 Bocha Jev 连接”只在用户点击时请求 `GET /v1/models` 验证接口可达；不会上传客户对话或调用决策模型。

Bocha Jev 服务额度与费用可能随账号和时间变化，以账号当前政策为准。云端 Agent 另需用户授权本轮聊天文本与结构化判断外发；本机 Ollama 与本地 Demo 不发送给 Agent 云端。Agent 模型目录检查只请求 `/models`，不会调用生成 API。浏览器版只展示样例数据；真实判断需在 Tauri 桌面版运行。


## 5. Agent 怎么接入

Agent 接收本机生成的结构化判断，不重新猜客户意图：

```text
ConversationSnapshot
  + SalesDecision
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

- API Key 通过设置面板输入，仅在 React 运行内存中暂存；不写入 `localStorage`、配置文件或日志，退出后需重新输入。
- Bocha Jev 仅在用户独立授权且点击“生成策略”后接收最近对话片段；Agent 云端仍需单独同意。
- 微信截图与 OCR 原图不随请求上传。
- 截图、OCR 原图和客户完整历史不随请求上传。

### 用户自有网关（正式版更推荐）

- App 只连用户配置的本地/自有网关。
- 网关只承载用户选定的 Agent 策略服务，便于统一审计、限流、脱敏和换模型；客户结构化判断由 Bocha Jev 独立完成。
- App 仍保持无服务端依赖的基本手动模式。

无论哪种方式，模型都不能获得自动发送权限。商业风险高、事实缺失或置信度不足时，只能返回“需要人工确认”。

## 7. 独立 App 的实现顺序

### Phase 1：无权限可用

- 当前 React + Tauri UI。
- 手动粘贴聊天记录。
- Bocha Jev 销售判断 / Demo Agent。
- 复制候选回复和素材任务。

### Phase 2：真实智能层（Bocha Jev API 适配原型已接入，待用户账号验收）

- 使用用户账号密钥验证 Bocha Jev typed decision 接口；聊天只在本轮授权后发送。
- 接 OpenAI-compatible Agent Provider，校验 JSON 输出和风险等级。
- 完善限次重试与错误提示；服务失败时保留历史判断并允许用户手动重试，不离线伪造新的客户判断。
- 用脱敏对话回归 `intent / stage / risk / next_action`。

### Phase 3：macOS 微信适配器（部分接入，真实验收阻断）

- Tauri 原生 macOS 层按应用归属自动定位微信窗口、单帧捕获，再以 Vision 做本机 OCR；名单路径仅处理左侧名称区域。
- 历史构建曾在系统开关显示授权时收到 ScreenCaptureKit `-3801`；权限刷新后的本轮实际结果待核验。
- OCR 关键词过滤不等同于识别单聊/群聊类型；须先验证 WeChat 暴露的结构化元数据或改为人工确认，才能满足“绝不导入群聊”。最近 20 项的自动翻页也未实现。
- 先只读、不轮询、不做填入；通过真实 Mac 微信版本验证后，再评估稳定帧与会话跟随。

### Phase 4：人工辅助闭环（AX 回填原型已接入，待真实验收）

- 复制按钮长期保留。
- 通过 Accessibility 回填已审核候选回复到微信输入框；草稿非空时拒绝覆盖。
- 人工确认后发送；不实现自动发送。

### Phase 5：素材执行器

- 接入产品事实卡。
- 调用 `product-showcase` 生成推荐语、朋友圈短文、图解任务和精确 15 秒脚本。
- 有真实图像/视频文件才标记为已生成，否则标记为任务草稿或 Prompt。

## 8. 验收标准

- 没有 Screen Recording 权限时，手动模式仍可完整运行。
- 采集暂停后不再读屏、不再触发 Jev/Agent；已有候选仍可复制。
- 同一条 OCR 消息重复出现不会重复调用模型。
- Bocha Jev 失败时不得伪造本机判断或静默降级；已保存的历史判断和候选回复仍可复制。
- Agent 输出缺字段、越权字段或未经核实承诺时被拦截。
- 任何路径都没有“自动发送”命令。
- 日志不含聊天全文、截图和 API key。
- `npm run build`、`cargo check` 和脱敏回归用例通过后，才能进入真实窗口测试。
