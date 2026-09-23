# Jev 销售副驾架构

## 一句话

这是一个独立桌面 App：Bocha Jev 把获准的客户对话转成结构化销售判断，Agent 可生成下一步策略；Skill 负责产品素材，用户负责最终发送。

```text
Conversation Adapter
        ↓
BochaJevDecision
        ↓
Optional AgentStrategyProvider
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

### Bocha Jev 决策模型

- 仅在用户单独授权并点击“生成策略”后，向 `https://jev.bocha.cn/v1/systemone` 发送最近最多 6 条对话（最多 300 字符）。
- 使用 `bocha-jev-v1`，通过 Choice/Score/Noul 取得客户意图、阶段、需求、温度、商业风险、角色、是否立即回复、下一步和最关键的信息缺口。
- 本地严格校验候选 ID、分数范围、Noul 概率与置信度；无效响应直接报错，不回退到本地关键词规则。
- API Key 仅驻留 UI 运行内存及当前 Tauri 调用；也可从 `BOCHA_JEV_API_KEY` 读取，兼容 `BOCHA_SEARCH_API_KEY`，不写入持久化存储或日志。
- 当前判断是云端服务调用；免费额度、时效和费用以 Bocha 账号当前政策为准。
- 用户可显式请求 `GET /v1/models` 连通性检查；此检查不发送聊天内容，也不执行决策。

### Agent

- 接收 `SalesDecision`、当前对话和产品事实卡。
- 只生成一个最高优先级动作、一个关键问题、候选回复和跟进条件。
- 不创造价格、折扣、交期、案例、评价或产品功效。

### product-showcase

- 产品素材工作区负责收集产品事实卡、导入产品图、生成推荐语、朋友圈文案、电商卖点图解结构和 15 秒视频脚本。
- 只在客户需要资料、产品对比或转发内容时按需调用。
- 当前本地产出为 `READY_FOR_REVIEW` 或 `DRAFT`；无真实图像/视频能力时输出结构、Prompt 和素材缺口，不伪称成片。
- 产品事实、产品图、当前会话与复盘记录保存在本机 WebView 存储；不自动上传。产品图缩放后作为本地预览数据保存。

### 沟通复盘

- 每次生成策略都会生成一条本地 `ReviewRecord`，保留当时的对话、Bocha Jev 判断、Agent 策略和风险。
- 复盘页允许标记“已复盘”，并显示可复用规则和本轮停止条件。
- 本地复盘记录随应用状态保存；后续再增加 SQLite 检索、标签、结果回填和用户可控的数据清理/导出。

## 状态机

```text
新线索 → 需求了解 → 产品评估 → 方案验证 → 价格谈判 → 决策
   ↑                                           ↓
   └──────────── 暂缓 / 跟进 ←───────────────┘
```

每轮沟通只推进一个状态变化。若没有足够证据，保留“未知”，不把“客户喜欢”当成购买承诺。

## Provider 接口

`src/providers.ts` 负责本机 Demo 策略；真实销售判断由 Rust 命令 `bocha_jev_decide` 调用 Bocha Jev：

- `judgeCustomerMessage(text)`：只为默认案例与空白态提供标注为 Demo 的样例数据，不用于真实会话分析，也不是 Jev 的降级替代。
- `AgentStrategyProvider.generate(input)`：本机 Demo 策略；Tauri `agent_strategy` 支持用户配置的本机或 OpenAI-compatible Agent。
- Bocha Jev 与云端 Agent 分别授权；Agent 的 API Key 不自动保存。无 Agent 云端授权时，可用本地 Demo 策略。

## 微信与真实模型接入

微信读取、macOS 权限、Bocha Jev 与 Agent 请求边界，见 [WECHAT-AGENT-JEV.md](./WECHAT-AGENT-JEV.md)。

当前微信适配按 macOS 路径实现。名单导入不在启动时运行，只在用户显式点击后才截取一帧并 OCR 左侧可见候选，不 OCR 右侧聊天正文。名称含明显群聊标记会跳过，但名称 OCR 无法证明无标记候选一定是单聊；当前也只扫描可见行、不自动翻页，因此“最近 20 个单聊且绝不含群聊”仍未验收，不能视为已满足。窗口所有者需匹配微信 bundle id/精确名称，最小窗口尺寸过滤排除常见子窗口；回填还校验输入框位于目标微信窗口且只选择最大聊天文本区，已有草稿则拒绝覆盖。用户另行点击“读取当前会话”后，才 OCR 聊天窗口并进入分析流程；Bocha Jev 只在用户单独授权并点击“生成策略”后收到最多 300 字符的最近对话片段，云端 Agent 另需独立同意。截图和 OCR 不写入日志或默认落盘；屏幕采集需“屏幕录制”，回填需“辅助功能”。不读取微信数据库、不注入微信、不自动发送。此前记录显示 ScreenCaptureKit 曾返回 `-3801`；当前权限与真实 OCR 结果须在此次安装包运行中重新核实。OCR 聊天文本仍作为“未区分说话方”的记录，不冒充说话人分段。

## 下一阶段

1. 用用户自己的 Bocha Jev API Key 完成受控连通验收，并用脱敏对话评估 Choice/Score/Noul 判断质量。
2. 按 Bocha 当前账户政策核实 Jev 服务额度、免费试用与计费方式。
3. 先证明单聊分类与列表滚动安全，再扩大微信名单导入。
4. 将产品事实卡和 `product-showcase` 输出接到真实图像/视频任务执行器。
5. 保持输入框回填与人工发送分离；不实现自动发送。
