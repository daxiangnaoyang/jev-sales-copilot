import { useMemo, useState } from "react";
import type {
  CustomerMessage,
  CustomerStrategy,
  JevDecision,
} from "./types";
import {
  buildStrategy,
  createCustomerMessage,
  demoCustomer,
  demoMessages,
  judgeCustomerMessage,
} from "./strategy";
import { demoJevProvider, demoStrategyProvider } from "./providers";

type AppMode = "sales" | "materials" | "review";

const modeLabels: Record<AppMode, { label: string; sub: string }> = {
  sales: { label: "销售副驾", sub: "判断与推进" },
  materials: { label: "产品素材", sub: "图文与视频" },
  review: { label: "沟通复盘", sub: "沉淀可复用策略" },
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    spark: <><path d="m12 3-1.5 4.5L6 9l4.5 1.5L12 15l1.5-4.5L18 9l-4.5-1.5Z" /><path d="m5 16-.7 2.3L2 19l2.3.7L5 22l.7-2.3Z" /></>,
    message: <><path d="M5 5h14v10H8l-4 4V5h1Z" /><path d="M8 9h8M8 12h5" /></>,
    copy: <><rect width="13" height="13" x="8" y="8" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    image: <><rect width="18" height="16" x="3" y="4" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m4 17 5-5 3 3 2-2 6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    refresh: <><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function decisionLabel(value: string) {
  const labels: Record<string, string> = {
    compare_product: "比较产品",
    request_material: "索要资料",
    price: "询价 / 预算",
    complaint: "投诉 / 售后",
    product_info: "了解产品",
    discover: "需求了解",
    follow_up: "跟进进度",
    evaluation: "产品评估",
    negotiation: "价格谈判",
    discovery: "需求探索",
    after_sales: "售后处理",
    proof: "需要证明",
    fit: "判断适配",
    priceNeed: "价格信息",
    risk: "风险消除",
    answer_and_ask: "回答并追问",
    send_asset_and_ask: "发素材并追问",
    clarify_before_quote: "报价前澄清",
    escalate_human: "升级人工",
  };
  return labels[value] ?? value;
}

function Metric({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "warm" | "danger" }) {
  return <div className={`metric metric-${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function MessageBubble({ message }: { message: CustomerMessage }) {
  const customer = message.sender === "customer";
  return (
    <article className={`bubble-row ${customer ? "is-customer" : "is-seller"}`}>
      <div className={`avatar ${customer ? "customer-avatar" : "seller-avatar"}`}>{customer ? "林" : "象"}</div>
      <div className="bubble-content">
        <div className="bubble-meta"><strong>{customer ? "林然 · 客户" : "我 · 销售"}</strong><time>{formatTime(message.createdAt)}</time></div>
        <div className="bubble">{message.text}</div>
      </div>
    </article>
  );
}

function DecisionCard({ decision }: { decision: JevDecision }) {
  return (
    <section className="panel decision-panel">
      <div className="panel-heading"><div><span className="overline">JEV DECISION</span><h2>客户判断卡</h2></div><span className="confidence"><i />{Math.round(decision.confidence * 100)}% 置信</span></div>
      <div className="decision-summary"><strong>{decisionLabel(decision.intent)}</strong><span>建议：{decisionLabel(decision.nextAction)}</span></div>
      <div className="metric-grid">
        <Metric label="销售阶段" value={decisionLabel(decision.stage)} />
        <Metric label="客户需要" value={decisionLabel(decision.customerNeed)} />
        <Metric label="兴趣温度" value={`${decision.temperature}/9`} tone="warm" />
        <Metric label="商业风险" value={`${decision.commercialRisk}/9`} tone={decision.commercialRisk >= 6 ? "danger" : "normal"} />
      </div>
      <div className="decision-row"><span>是否立即回复</span><strong className={decision.shouldReplyNow ? "yes" : "no"}>{decision.shouldReplyNow ? "是，建议现在承接" : "否，先补事实"}</strong></div>
      <div className="missing-facts"><span>还缺什么</span><div>{decision.missingFacts.map((fact) => <em key={fact}>{fact}</em>)}</div></div>
    </section>
  );
}

function StrategyCard({ strategy, onQueueAsset }: { strategy: CustomerStrategy; onQueueAsset: () => void }) {
  return (
    <section className="panel strategy-panel">
      <div className="panel-heading"><div><span className="overline">AGENT STRATEGY</span><h2>下一步策略</h2></div><span className={`review-badge ${strategy.humanConfirmationRequired ? "needs-review" : "ready"}`}>{strategy.humanConfirmationRequired ? "需要人工确认" : "可先准备"}</span></div>
      <div className="strategy-objective"><span>本轮目标</span><strong>{strategy.objective}</strong></div>
      <div className="next-move"><div className="step-number">01</div><div><span>只推进一个动作</span><strong>{strategy.singleNextMove}</strong></div><Icon name="arrow" size={16} /></div>
      <div className="question-block"><span>建议只问这一句</span><p>{strategy.question}</p><small>{strategy.questionPurpose}</small></div>
      <div className="strategy-footer"><div><span>下一次跟进</span><strong>{strategy.followUp}</strong></div><div><span>停止条件</span><strong>{strategy.stopCondition}</strong></div></div>
      {strategy.unsupportedClaims.length > 0 && <div className="warning-strip"><span>需人工核验</span>{strategy.unsupportedClaims.join("、")}</div>}
    </section>
  );
}

function RepliesCard({ strategy, onCopy }: { strategy: CustomerStrategy; onCopy: (text: string, id: string) => void }) {
  return (
    <section className="panel replies-panel">
      <div className="panel-heading"><div><span className="overline">REPLY OPTIONS</span><h2>候选回复</h2></div><span className="panel-note">Jev 排序 · 仅复制</span></div>
      <div className="reply-list">
        {strategy.replies.map((reply, index) => (
          <article className={`reply-card ${index === 0 ? "is-recommended" : ""}`} key={reply.id}>
            <div className="reply-card-head"><span className="reply-index">0{index + 1}</span><strong>{reply.label}</strong>{index === 0 && <span className="recommended">推荐</span>}<span className={`risk risk-${reply.risk}`}>风险{reply.risk}</span></div>
            <p>{reply.text}</p>
            <div className="reply-card-foot"><span>{reply.purpose}</span><button onClick={() => onCopy(reply.text, reply.id)}><Icon name="copy" size={13} />复制</button></div>
          </article>
        ))}
      </div>
      <div className="manual-send-note"><Icon name="shield" size={14} />复制后由你检查并发送，Jev 不代替你按发送</div>
    </section>
  );
}

function App() {
  const [mode, setMode] = useState<AppMode>("sales");
  const [messages, setMessages] = useState<CustomerMessage[]>(demoMessages);
  const [draft, setDraft] = useState("");
  const [decision, setDecision] = useState<JevDecision>(() => judgeCustomerMessage(demoMessages[0].text));
  const [strategy, setStrategy] = useState<CustomerStrategy>(() => buildStrategy(decision, demoMessages[0].text));
  const [assetQueued, setAssetQueued] = useState(false);
  const [notice, setNotice] = useState("本地演示提供器已就绪");
  const [copied, setCopied] = useState<string>();

  const conversationCount = useMemo(() => messages.filter((item) => item.sender === "customer").length, [messages]);

  async function copyText(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setNotice("已复制到剪贴板，发送前请再检查一次");
      window.setTimeout(() => setCopied((current) => current === id ? undefined : current), 1600);
    } catch {
      setNotice("复制失败，请手动选择文字复制");
    }
  }

  async function generateStrategy() {
    const text = draft.trim();
    if (!text) return;
    const nextMessages = [...messages, createCustomerMessage(text)];
    const nextDecision = await demoJevProvider.judge(nextMessages);
    const nextStrategy = await demoStrategyProvider.generate({
      decision: nextDecision,
      latestMessage: text,
    });
    setMessages(nextMessages);
    setDecision(nextDecision);
    setStrategy(nextStrategy);
    setDraft("");
    setAssetQueued(false);
    setNotice("Jev 已完成判断，Agent 已生成下一步策略");
  }

  function resetDemo() {
    const nextDecision = judgeCustomerMessage(demoMessages[0].text);
    setMessages(demoMessages);
    setDecision(nextDecision);
    setStrategy(buildStrategy(nextDecision, demoMessages[0].text));
    setDraft("");
    setAssetQueued(false);
    setNotice("已回到演示案例");
  }

  function queueAsset() {
    setAssetQueued(true);
    setNotice("已生成 product-showcase 素材任务草稿，尚未调用图像或视频服务");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">J</div><div><strong>Jev 销售副驾</strong><span>SALES COPILOT</span></div></div>
        <div className="local-badge"><i />本地优先 · 人工发送</div>
        <nav className="mode-nav" aria-label="工作模式">
          <span className="nav-title">WORKSPACE</span>
          {(Object.keys(modeLabels) as AppMode[]).map((item) => <button key={item} className={mode === item ? "is-active" : ""} onClick={() => setMode(item)}><span className="nav-icon"><Icon name={item === "sales" ? "message" : item === "materials" ? "image" : "refresh"} size={16} /></span><span><strong>{modeLabels[item].label}</strong><small>{modeLabels[item].sub}</small></span>{item === "sales" && <i className="nav-dot" />}</button>)}
        </nav>
        <div className="customer-section"><div className="section-heading"><span>客户</span><button aria-label="新增客户"><Icon name="plus" size={14} /></button></div><button className="customer-item is-active"><div className="customer-avatar">林</div><div><strong>林然</strong><small>远山设计 · 评估中</small></div><i /></button><button className="customer-item"><div className="customer-avatar muted-avatar">周</div><div><strong>周宁</strong><small>未开始 · 暂无新消息</small></div></button></div>
        <div className="sidebar-bottom"><div className="privacy-card"><Icon name="shield" size={16} /><div><strong>发送边界</strong><span>只准备，不代发</span></div></div><div className="provider-row"><span className="provider-dot" />Jev 判断 · Demo Provider</div></div>
      </aside>
      <main className="main-area">
        <header className="topbar"><div><span className="crumb">JEV SALES COPILOT / {modeLabels[mode].label.toUpperCase()}</span><h1>客户沟通副驾</h1></div><div className="top-actions"><span className="demo-pill">本地演示</span><span className="safe-pill"><i />不自动发送</span><div className="user-avatar">象</div></div></header>
        <div className="content-scroll">
          {mode !== "sales" ? <section className="empty-mode"><div className="empty-icon"><Icon name={mode === "materials" ? "image" : "refresh"} size={28} /></div><span className="overline">{modeLabels[mode].label.toUpperCase()}</span><h2>{mode === "materials" ? "从客户需求直接生成可发送素材" : "让每一次沟通都能沉淀成下一次能力"}</h2><p>{mode === "materials" ? "这一页会承接 product-showcase：产品事实卡、卖点图解、朋友圈短文和 15 秒视频任务。" : "复盘客户意图、销售动作与结果，提取可以复用的提问和异议处理策略。"}</p><button className="primary-button" onClick={() => setMode("sales")}><Icon name="arrow" size={15} />回到销售副驾</button></section> : <>
            <section className="hero-row"><div><span className="overline">TODAY'S CUSTOMER MOMENT</span><h2>让每一次客户回复，<em>都有下一步</em></h2><p>Jev 先判断客户状态，Agent 再生成策略。你负责最后的判断和发送。</p></div><div className="hero-stats"><div><strong>{conversationCount}</strong><span>本次客户消息</span></div><div><strong>{Math.round(decision.confidence * 100)}%</strong><span>当前判断置信度</span></div><div><strong>{decision.commercialRisk}</strong><span>商业风险 / 9</span></div></div></section>
            <div className="workspace-grid"><section className="panel conversation-panel"><div className="panel-heading"><div className="contact-heading"><div className="customer-avatar large-avatar">林</div><div><span className="overline">CURRENT CUSTOMER</span><h2>{demoCustomer.name}</h2><p>{demoCustomer.company} · {demoCustomer.role}</p></div></div><span className="stage-pill">{decisionLabel(decision.stage)}</span></div><div className="conversation-list">{messages.map((message) => <MessageBubble key={message.id} message={message} />)}</div><div className="message-input"><div className="input-label"><span>输入客户最新消息</span><small>Demo Provider · 不上传聊天内容</small></div><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); generateStrategy(); } }} placeholder="例如：把资料发我，我转给老板看看……" rows={3} /><div className="input-actions"><button className="text-button" onClick={resetDemo}><Icon name="refresh" size={13} />重置案例</button><span>Enter 生成 · Shift + Enter 换行</span><button className="primary-button small-button" onClick={generateStrategy} disabled={!draft.trim()}><Icon name="spark" size={14} />生成策略</button></div></div></section><DecisionCard decision={decision} /></div>
            <div className="lower-grid"><StrategyCard strategy={strategy} onQueueAsset={queueAsset} /><div className="right-stack"><RepliesCard strategy={strategy} onCopy={copyText} /><section className="panel asset-panel"><div className="panel-heading"><div><span className="overline">NEXT ASSET</span><h2>推荐素材</h2></div><span className={assetQueued ? "queued-badge" : "panel-note"}>{assetQueued ? "任务已准备" : "按需调用"}</span></div>{strategy.asset ? <div className="asset-content"><div className="asset-icon"><Icon name="image" size={19} /></div><div><strong>{strategy.asset.title}</strong><p>{strategy.asset.reason}</p><span>product-showcase · {strategy.asset.type === "comparison_card" ? "差异对比图解" : "产品卖点素材"}</span></div></div> : <div className="asset-empty"><span>当前先完成需求了解</span><small>客户出现明确的资料、对比或分享需求后再生成</small></div>}<button className="asset-button" onClick={queueAsset} disabled={!strategy.asset || assetQueued}><Icon name="spark" size={14} />{assetQueued ? "素材任务已准备" : "生成素材任务草稿"}</button></section></div></div>
            <div className="status-line"><span className="status-light" />{notice}<span className="status-tail">策略结果仅保存在当前演示会话</span></div>
          </>}
        </div>
      </main>
    </div>
  );
}

export default App;
