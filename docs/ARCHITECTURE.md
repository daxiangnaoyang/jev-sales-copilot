# Jev 销售副驾架构

## 一句话

这是一个独立的桌面 App：Jev 负责把客户对话压缩成结构化判断，Agent 负责生成一条可执行的下一步策略，Skill 负责生成产品素材，用户负责最终发送。

```text
Conversation Adapter
        ↓
JevDecisionProvider
        ↓
AgentStrategyProvider
        ↓
Skill Adapter: product-showcase
        ↓
Human Review → Copy / Fill → Human Send
```

## 运行边界

### App

- 展示客户对话、客户卡片、判断卡、策略卡和候选回复。
- 保存当前会话的临时状态，后续再增加本地 SQLite。
- 提供复制和未来的输入框填入，不提供自动发送。

### Jev

- 判断客户意图、销售阶段、需求、温度、商业风险、缺失事实和下一步动作。
- 输出 `JevDecision`，只允许有限枚举、分数和置信度。
- 低置信度时要求人工复核，不让自由文本覆盖结构化判断。

### Agent

- 接收 `JevDecision`、最近对话、客户资料和产品事实卡。
- 只生成一个最高优先级动作、一个关键问题、候选回复和跟进条件。
- 不创造价格、折扣、交期、案例、评价或产品功效。

### product-showcase

- 产品素材工作区负责收集产品事实卡、导入产品图、生成推荐语、朋友圈文案、电商卖点图解结构和 15 秒视频脚本。
- 只在客户需要资料、产品对比或转发内容时按需调用。
- 当前本地产出为 `READY_FOR_REVIEW` 或 `DRAFT`；无真实图像/视频能力时输出结构、Prompt 和素材缺口，不伪称成片。

### 沟通复盘

- 每次生成策略都会生成一条本地 `ReviewRecord`，保留当时的对话、Jev 判断、Agent 策略和风险。
- 复盘页允许标记“已复盘”，并显示可复用规则和本轮停止条件。
- 当前状态只在演示会话内保存，后续接本地 SQLite 时再增加检索、标签和结果回填。

## 状态机

```text
新线索 → 需求了解 → 产品评估 → 方案验证 → 价格谈判 → 决策
   ↑                                           ↓
   └──────────── 暂缓 / 跟进 ←───────────────┘
```

每轮沟通只推进一个状态变化。若没有足够证据，保留“未知”，不把“客户喜欢”当成购买承诺。

## Provider 接口

`src/providers.ts` 是真实服务的替换边界：

- `JevDecisionProvider.judge(messages)`：未来接 TypeSafe Jev、兼容网关或本地模型。
- `AgentStrategyProvider.generate(input)`：未来接 CLI Agent、OpenAI 兼容 API 或本地 Agent。
- Demo Provider 作为离线回归和无密钥演示，不应被误认为真实模型结果。

## 微信与真实模型接入

微信读取、macOS 权限、Jev/Agent 的请求形状和分阶段实现顺序，见 [WECHAT-AGENT-JEV.md](./WECHAT-AGENT-JEV.md)。

当前采用的实现决策是：先手动粘贴验证业务闭环，再接 macOS ScreenCaptureKit + Vision；不读取微信数据库、不注入微信、不把自动发送作为能力。

## 下一阶段

1. 增加脱敏聊天导入和本地客户卡片。
2. 用 30—50 条脱敏对话建立意图、阶段、风险和动作标注集。
3. 接真实 Jev Provider，并保留 Demo Provider 做离线回归。
4. 将产品事实卡和 `product-showcase` 输出接到真实图像/视频任务执行器。
5. 最后增加 macOS 屏幕采集和输入框填入适配器，自动发送永远不在默认范围内。
