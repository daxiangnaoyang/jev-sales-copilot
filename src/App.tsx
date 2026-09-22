import { useMemo, useState } from "react";
import type {
  CustomerMessage,
  CustomerStrategy,
  JevDecision,
  ProductFactStatus,
  ProductOutput,
  ProductOutputType,
  ProductWorkspace,
  ReviewRecord,
} from "./types";
import {
  buildStrategy,
  createCustomerMessage,
  demoCustomer,
  demoMessages,
  judgeCustomerMessage,
} from "./strategy";
import { demoJevProvider, demoStrategyProvider } from "./providers";
import { buildProductOutputs, defaultProductWorkspace } from "./product";

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
    video: <><rect width="16" height="14" x="3" y="5" rx="2" /><path d="m19 9 3-2v10l-3-2M8 5V3M12 5V3" /></>,
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

function productFactStatusLabel(value: ProductFactStatus) {
  return {
    provided: "已提供",
    visible: "图中可见",
    pending: "待确认",
    missing: "未获取",
  }[value];
}

function productOutputTypeLabel(value: ProductOutputType) {
  return {
    recommendation: "推荐语",
    "social-post": "朋友圈",
    diagram: "图解草稿",
    "video-script": "15 秒视频",
  }[value];
}

function outputCopyText(output: ProductOutput) {
  if (output.text) return output.text;
  if (output.scenes) {
    return output.scenes.map((scene) => `${scene.time}｜${scene.task}\n画面：${scene.visual}\n口播：${scene.voiceover}\n字幕：${scene.caption}`).join("\n\n");
  }
  return (output.cards ?? []).map((card, index) => `${index + 1}. ${card.title}\n${card.body}`).join("\n\n");
}

function reviewInsight(decision: JevDecision, strategy: CustomerStrategy) {
  if (decision.intent === "complaint") return "先承接情绪，再补齐订单和问题事实；没有核验前不做退款、补偿或时限承诺。";
  if (decision.intent === "price") return "报价前先确认数量与配置，把价格问题还原成可核验的购买条件。";
  if (decision.intent === "compare_product") return "客户需要的是自己的比较标准，不是一次堆满所有参数。";
  if (decision.intent === "request_material") return "素材要围绕客户要转发给谁、最关心哪个卖点来组织，默认一图一卖点。";
  return strategy.objective;
}

function reviewRule(decision: JevDecision) {
  if (decision.intent === "complaint") return "高风险沟通先取事实，再谈处理；把承诺拆成可验证的下一步。";
  if (decision.intent === "price") return "不在购买条件未确认前报价；先问数量、配置和决策时间。";
  if (decision.intent === "compare_product") return "先确认决策维度，再发送对应卖点素材。";
  if (decision.intent === "request_material") return "资料不是越多越好；先确认用途，再按一个核心卖点生成可转发素材。";
  return "每轮只推进一个动作，并保留事实缺口。";
}

function makeReviewRecord(messages: CustomerMessage[], decision: JevDecision, strategy: CustomerStrategy, status: ReviewRecord["status"] = "待复盘"): ReviewRecord {
  return {
    id: `review-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    customer: demoCustomer,
    messages,
    decision,
    strategy,
    createdAt: new Date().toISOString(),
    status,
    insight: reviewInsight(decision, strategy),
    reusableRule: reviewRule(decision),
  };
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

function StrategyCard({ strategy }: { strategy: CustomerStrategy }) {
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

type ProductField = "productName" | "category" | "audience" | "scene" | "platform" | "tone" | "ratio" | "videoDirection";

function ProductOutputPreview({ output, image, onCopy, copied }: { output?: ProductOutput; image?: string; onCopy: (text: string, id: string) => void; copied?: string }) {
  if (!output) {
    return <div className="output-empty"><div className="empty-icon"><Icon name="spark" size={24} /></div><strong>先完成事实卡</strong><span>产品事实确认后，这里会出现可审阅的推荐语、图解草稿、朋友圈短文和 15 秒脚本。</span></div>;
  }

  return <div className="output-preview">
    <div className="output-preview-head"><div><span className="overline">{productOutputTypeLabel(output.type).toUpperCase()}</span><h3>{output.title}</h3></div><div className="output-actions"><span className={`output-status ${output.status === "DRAFT" ? "draft" : "ready"}`}>{output.status}</span><button className="text-button" onClick={() => onCopy(outputCopyText(output), `output-${output.id}`)}><Icon name="copy" size={13} />{copied === `output-${output.id}` ? "已复制" : "复制"}</button></div></div>
    {output.text && <div className="copyable-output"><p>{output.text}</p><small>只使用事实卡中已提供或图中可见的信息；发布前仍需人工核对。</small></div>}
    {output.cards && <div className="diagram-preview"><div className="diagram-note"><Icon name="shield" size={13} />当前是电商图解结构草稿，不代表已经生成最终图片</div><div className="diagram-grid">{output.cards.map((card, index) => <article className="diagram-card" key={card.id}><div className="diagram-image">{image ? <img src={image} alt="已导入产品图" /> : <div className="diagram-placeholder"><Icon name="image" size={21} /><span>待导入产品图</span></div>}<b>0{index + 1}</b></div><div className="diagram-copy"><strong>{card.title}</strong><p>{card.body}</p><small>允许上图文字：{card.allowedText}</small></div></article>)}</div></div>}
    {output.scenes && <div className="storyboard"><div className="storyboard-note"><Icon name="video" size={13} />总时长 15 秒 · 竖版 9:16 · 当前输出脚本，不是成片</div>{output.scenes.map((scene) => <article className="scene-row" key={scene.id}><time>{scene.time}</time><div><strong>{scene.task}</strong><p>{scene.visual}</p><span>口播：{scene.voiceover}</span><small>字幕：{scene.caption}</small></div></article>)}</div>}
  </div>;
}

function ProductMaterialsView({
  workspace,
  selectedOutput,
  copied,
  onUpdateField,
  onUpdateFact,
  onAddFact,
  onImageUpload,
  onGenerate,
  onSelectOutput,
  onCopy,
}: {
  workspace: ProductWorkspace;
  selectedOutput?: ProductOutput;
  copied?: string;
  onUpdateField: (field: ProductField, value: string) => void;
  onUpdateFact: (id: string, field: "label" | "value" | "status", value: string) => void;
  onAddFact: () => void;
  onImageUpload: (file?: File) => void;
  onGenerate: () => void;
  onSelectOutput: (id: string) => void;
  onCopy: (text: string, id: string) => void;
}) {
  const localImage = workspace.images.find((image) => image.source === "local-upload");
  const confirmedCount = workspace.facts.filter((fact) => fact.status === "provided" || fact.status === "visible").length;

  return <div className="materials-workspace">
    <section className="materials-hero"><div><span className="overline">PRODUCT SHOWCASE</span><h2>把产品资料变成<span>可发送素材</span></h2><p>先收集事实，再生成推荐语、图解草稿、朋友圈短文和精确 15 秒视频脚本。</p></div><div className="materials-stats"><div><strong>{workspace.facts.length}</strong><span>事实字段</span></div><div><strong>{confirmedCount}</strong><span>可公开事实</span></div><div><strong>{workspace.outputs.length || "—"}</strong><span>输出草稿</span></div></div></section>
    <div className="materials-grid">
      <section className="panel fact-panel"><div className="panel-heading"><div><span className="overline">FACT CARD</span><h2>产品事实卡</h2></div><span className={`review-badge ${workspace.status === "READY_FOR_REVIEW" ? "ready" : "needs-review"}`}>{workspace.status === "READY_FOR_REVIEW" ? "待审阅" : "收集中"}</span></div>
        <div className="fact-form"><label><span>产品名称</span><input value={workspace.productName} onChange={(event) => onUpdateField("productName", event.currentTarget.value)} placeholder="例如：某款旗舰手机" /></label><label><span>品类</span><input value={workspace.category} onChange={(event) => onUpdateField("category", event.currentTarget.value)} placeholder="例如：智能硬件" /></label><label><span>目标人群</span><input value={workspace.audience} onChange={(event) => onUpdateField("audience", event.currentTarget.value)} placeholder="谁会使用它" /></label><label><span>使用场景</span><input value={workspace.scene} onChange={(event) => onUpdateField("scene", event.currentTarget.value)} placeholder="产品解决什么处境" /></label><div className="form-selects"><label><span>发布平台</span><select value={workspace.platform} onChange={(event) => onUpdateField("platform", event.currentTarget.value)}><option>朋友圈</option><option>小红书</option><option>视频号</option></select></label><label><span>文案口吻</span><select value={workspace.tone} onChange={(event) => onUpdateField("tone", event.currentTarget.value)}><option>专业种草</option><option>亲切日常</option><option>活泼有趣</option></select></label></div><div className="form-selects"><label><span>图片比例</span><select value={workspace.ratio} onChange={(event) => onUpdateField("ratio", event.currentTarget.value)}><option>3:4</option><option>4:5</option><option>9:16</option></select></label><label><span>视频方向</span><select value={workspace.videoDirection} onChange={(event) => onUpdateField("videoDirection", event.currentTarget.value)}><option>竖版 9:16 · 15 秒</option><option>横版 16:9 · 5—10 秒</option></select></label></div></div>
        <div className="asset-upload"><div className="asset-upload-head"><div><span className="overline">SOURCE IMAGE</span><strong>产品图片</strong></div><span>{localImage ? "已导入 1 张" : "未导入"}</span></div><input id="product-image-upload" type="file" accept="image/*" onChange={(event) => onImageUpload(event.currentTarget.files?.[0])} /><label htmlFor="product-image-upload" className={`upload-box ${localImage ? "has-image" : ""}`}>{localImage ? <><img src={localImage.previewUrl} alt={localImage.name} /><div><strong>{localImage.name}</strong><small>仅在当前浏览器会话预览，不上传服务器</small></div></> : <><Icon name="image" size={19} /><div><strong>导入产品图</strong><small>支持 JPG / PNG；用于图解草稿参考</small></div></>}</label></div>
        <div className="facts-editor"><div className="facts-editor-head"><div><span className="overline">EVIDENCE STATUS</span><strong>卖点与事实</strong></div><button className="text-button" onClick={onAddFact}><Icon name="plus" size={13} />添加事实</button></div>{workspace.facts.map((fact) => <div className="fact-row" key={fact.id}><input className="fact-label" value={fact.label} onChange={(event) => onUpdateFact(fact.id, "label", event.currentTarget.value)} placeholder="维度" /><input className="fact-value" value={fact.value} onChange={(event) => onUpdateFact(fact.id, "value", event.currentTarget.value)} placeholder="事实内容" /><select value={fact.status} onChange={(event) => onUpdateFact(fact.id, "status", event.currentTarget.value)}><option value="provided">已提供</option><option value="visible">图中可见</option><option value="pending">待确认</option><option value="missing">未获取</option></select><span className={`fact-status-dot fact-${fact.status}`} title={productFactStatusLabel(fact.status)} /></div>)}<div className="fact-boundary"><Icon name="shield" size={13} /><span>只有“已提供 / 图中可见”会进入公开文案；待确认和未获取信息会留在缺口中。</span></div></div>
        <button className="primary-button generate-material-button" onClick={onGenerate}><Icon name="spark" size={14} />生成素材包草稿</button>
      </section>
      <section className="panel outputs-panel"><div className="panel-heading"><div><span className="overline">OUTPUTS</span><h2>素材输出</h2></div><span className="panel-note">人工审阅后再发布</span></div><div className="output-tabs">{workspace.outputs.map((output) => <button key={output.id} className={selectedOutput?.id === output.id ? "is-active" : ""} onClick={() => onSelectOutput(output.id)}><span>{productOutputTypeLabel(output.type)}</span><small>{output.status === "DRAFT" ? "草稿" : "待审阅"}</small></button>)}</div><ProductOutputPreview output={selectedOutput} image={localImage?.previewUrl} onCopy={onCopy} copied={copied} /></section>
    </div>
  </div>;
}

function ReviewView({ records, selectedId, copied, onSelect, onMarkReviewed, onCopy }: { records: ReviewRecord[]; selectedId?: string; copied?: string; onSelect: (id: string) => void; onMarkReviewed: (id: string) => void; onCopy: (text: string, id: string) => void }) {
  const selected = records.find((record) => record.id === selectedId) ?? records[0];
  const pendingCount = records.filter((record) => record.status === "待复盘").length;
  const reviewedCount = records.filter((record) => record.status === "已复盘").length;
  const highRiskCount = records.filter((record) => record.decision.commercialRisk >= 6).length;

  return <div className="review-workspace"><section className="review-hero"><div><span className="overline">COMMUNICATION REVIEW</span><h2>把一次沟通，变成<span>下一次能力</span></h2><p>回看客户判断、销售动作和事实缺口，只沉淀可复用的规则，不把一次偶然回复当成经验。</p></div><div className="review-stats"><div><strong>{pendingCount}</strong><span>待复盘</span></div><div><strong>{reviewedCount}</strong><span>已沉淀</span></div><div><strong>{highRiskCount}</strong><span>高风险</span></div></div></section><div className="review-grid"><section className="panel review-list-panel"><div className="panel-heading"><div><span className="overline">SESSIONS</span><h2>沟通记录</h2></div><span className="panel-note">本地演示会话</span></div><div className="review-list">{records.length === 0 ? <div className="review-empty">生成一次销售策略后，这里会出现可复盘记录。</div> : records.map((record) => <button key={record.id} className={`review-list-item ${selected?.id === record.id ? "is-active" : ""}`} onClick={() => onSelect(record.id)}><div className="review-list-top"><strong>{record.customer.name} · {record.customer.company}</strong><span className={record.status === "已复盘" ? "reviewed-label" : "pending-label"}>{record.status}</span></div><p>{record.messages.filter((message) => message.sender === "customer").at(-1)?.text}</p><div><span>{decisionLabel(record.decision.intent)}</span><span>风险 {record.decision.commercialRisk}/9</span><time>{formatTime(record.createdAt)}</time></div></button>)}</div></section><section className="panel review-detail-panel">{selected ? <><div className="panel-heading"><div className="contact-heading"><div className="customer-avatar large-avatar">{selected.customer.name.slice(0, 1)}</div><div><span className="overline">REVIEW DETAIL</span><h2>{selected.customer.name}</h2><p>{selected.customer.company} · {selected.customer.role}</p></div></div><span className={`review-badge ${selected.status === "已复盘" ? "ready" : "needs-review"}`}>{selected.status}</span></div><div className="review-timeline"><span className="overline">CONVERSATION SNAPSHOT</span>{selected.messages.slice(-4).map((message) => <MessageBubble key={message.id} message={message} />)}</div><div className="review-judgment"><div><span>Jev 判断</span><strong>{decisionLabel(selected.decision.intent)}</strong><small>{decisionLabel(selected.decision.stage)} · {Math.round(selected.decision.confidence * 100)}% 置信</small></div><div><span>Agent 下一步</span><strong>{selected.strategy.singleNextMove}</strong><small>{selected.strategy.humanConfirmationRequired ? "需要人工确认" : "可先准备"}</small></div></div><div className="review-insight"><span className="overline">INSIGHT</span><h3>{selected.insight}</h3><p><strong>可复用规则：</strong>{selected.reusableRule}</p><div className="review-avoid"><span>本轮不要做</span><strong>{selected.strategy.stopCondition}</strong></div></div><div className="review-detail-actions"><button className="text-button" onClick={() => onCopy(selected.strategy.replies[0]?.text ?? "", `review-${selected.id}`)}><Icon name="copy" size={13} />{copied === `review-${selected.id}` ? "已复制推荐回复" : "复制推荐回复"}</button><button className="primary-button small-button" onClick={() => onMarkReviewed(selected.id)} disabled={selected.status === "已复盘"}><Icon name="check" size={14} />{selected.status === "已复盘" ? "已沉淀规则" : "标记为已复盘"}</button></div></> : <div className="review-empty">暂无可复盘记录。</div>}</section></div></div>;
}

function App() {
  const [mode, setMode] = useState<AppMode>("sales");
  const [messages, setMessages] = useState<CustomerMessage[]>(demoMessages);
  const [draft, setDraft] = useState("");
  const [decision, setDecision] = useState<JevDecision>(() => judgeCustomerMessage(demoMessages[0].text));
  const [strategy, setStrategy] = useState<CustomerStrategy>(() => buildStrategy(decision, demoMessages[0].text));
  const [productWorkspace, setProductWorkspace] = useState<ProductWorkspace>(() => defaultProductWorkspace);
  const [reviewRecords, setReviewRecords] = useState<ReviewRecord[]>(() => {
    const initialDecision = judgeCustomerMessage(demoMessages[0].text);
    const initialStrategy = buildStrategy(initialDecision, demoMessages[0].text);
    return [makeReviewRecord(demoMessages, initialDecision, initialStrategy)];
  });
  const [selectedReviewId, setSelectedReviewId] = useState<string>();
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
    const reviewRecord = makeReviewRecord(nextMessages, nextDecision, nextStrategy);
    setReviewRecords((current) => [reviewRecord, ...current].slice(0, 12));
    setSelectedReviewId(reviewRecord.id);
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

  function updateProductField(field: ProductField, value: string) {
    setProductWorkspace((current) => ({ ...current, [field]: value } as ProductWorkspace));
  }

  function updateProductFact(id: string, field: "label" | "value" | "status", value: string) {
    setProductWorkspace((current) => ({
      ...current,
      facts: current.facts.map((fact) => fact.id === id ? { ...fact, [field]: value } : fact),
      status: "COLLECTING",
    }));
  }

  function addProductFact() {
    setProductWorkspace((current) => ({
      ...current,
      facts: [...current.facts, { id: `fact-${Date.now()}`, label: "新卖点", value: "", status: "pending", source: "待用户补充" }],
      status: "COLLECTING",
    }));
  }

  function uploadProductImage(file?: File) {
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setProductWorkspace((current) => ({
      ...current,
      images: [{ id: `image-${Date.now()}`, name: file.name, previewUrl, source: "local-upload", note: "当前浏览器会话本地预览" }, ...current.images.filter((image) => image.source !== "local-upload")],
      status: "COLLECTING",
    }));
    setNotice("产品图已导入本地预览，尚未上传或调用图像服务");
  }

  function generateProductPackage() {
    const outputs = buildProductOutputs(productWorkspace);
    setProductWorkspace((current) => ({ ...current, outputs, selectedOutputId: outputs[0]?.id, status: "READY_FOR_REVIEW" }));
    setNotice("已生成产品素材包草稿，等待人工审阅");
  }

  function markReviewReviewed(id: string) {
    setReviewRecords((current) => current.map((record) => record.id === id ? { ...record, status: "已复盘" } : record));
    setNotice("已把本次沟通标记为已复盘，规则可以继续迭代");
  }

  const selectedProductOutput = productWorkspace.outputs.find((output) => output.id === productWorkspace.selectedOutputId) ?? productWorkspace.outputs[0];

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
        <header className="topbar"><div><span className="crumb">JEV SALES COPILOT / {modeLabels[mode].label.toUpperCase()}</span><h1>{mode === "sales" ? "客户沟通副驾" : modeLabels[mode].label}</h1></div><div className="top-actions"><span className="demo-pill">本地演示</span><span className="safe-pill"><i />不自动发送</span><div className="user-avatar">象</div></div></header>
        <div className="content-scroll">
          {mode === "materials" ? <ProductMaterialsView workspace={productWorkspace} selectedOutput={selectedProductOutput} copied={copied} onUpdateField={updateProductField} onUpdateFact={updateProductFact} onAddFact={addProductFact} onImageUpload={uploadProductImage} onGenerate={generateProductPackage} onSelectOutput={(id) => setProductWorkspace((current) => ({ ...current, selectedOutputId: id }))} onCopy={copyText} /> : mode === "review" ? <ReviewView records={reviewRecords} selectedId={selectedReviewId ?? reviewRecords[0]?.id} copied={copied} onSelect={setSelectedReviewId} onMarkReviewed={markReviewReviewed} onCopy={copyText} /> : <>
            <section className="hero-row"><div><span className="overline">TODAY'S CUSTOMER MOMENT</span><h2>让每一次客户回复，<em>都有下一步</em></h2><p>Jev 先判断客户状态，Agent 再生成策略。你负责最后的判断和发送。</p></div><div className="hero-stats"><div><strong>{conversationCount}</strong><span>本次客户消息</span></div><div><strong>{Math.round(decision.confidence * 100)}%</strong><span>当前判断置信度</span></div><div><strong>{decision.commercialRisk}</strong><span>商业风险 / 9</span></div></div></section>
            <div className="workspace-grid"><section className="panel conversation-panel"><div className="panel-heading"><div className="contact-heading"><div className="customer-avatar large-avatar">林</div><div><span className="overline">CURRENT CUSTOMER</span><h2>{demoCustomer.name}</h2><p>{demoCustomer.company} · {demoCustomer.role}</p></div></div><span className="stage-pill">{decisionLabel(decision.stage)}</span></div><div className="conversation-list">{messages.map((message) => <MessageBubble key={message.id} message={message} />)}</div><div className="message-input"><div className="input-label"><span>输入客户最新消息</span><small>Demo Provider · 不上传聊天内容</small></div><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); generateStrategy(); } }} placeholder="例如：把资料发我，我转给老板看看……" rows={3} /><div className="input-actions"><button className="text-button" onClick={resetDemo}><Icon name="refresh" size={13} />重置案例</button><span>Enter 生成 · Shift + Enter 换行</span><button className="primary-button small-button" onClick={generateStrategy} disabled={!draft.trim()}><Icon name="spark" size={14} />生成策略</button></div></div></section><DecisionCard decision={decision} /></div>
            <div className="lower-grid"><StrategyCard strategy={strategy} /><div className="right-stack"><RepliesCard strategy={strategy} onCopy={copyText} /><section className="panel asset-panel"><div className="panel-heading"><div><span className="overline">NEXT ASSET</span><h2>推荐素材</h2></div><span className={assetQueued ? "queued-badge" : "panel-note"}>{assetQueued ? "任务已准备" : "按需调用"}</span></div>{strategy.asset ? <div className="asset-content"><div className="asset-icon"><Icon name="image" size={19} /></div><div><strong>{strategy.asset.title}</strong><p>{strategy.asset.reason}</p><span>product-showcase · {strategy.asset.type === "comparison_card" ? "差异对比图解" : "产品卖点素材"}</span></div></div> : <div className="asset-empty"><span>当前先完成需求了解</span><small>客户出现明确的资料、对比或分享需求后再生成</small></div>}<button className="asset-button" onClick={queueAsset} disabled={!strategy.asset || assetQueued}><Icon name="spark" size={14} />{assetQueued ? "素材任务已准备" : "生成素材任务草稿"}</button></section></div></div>
            <div className="status-line"><span className="status-light" />{notice}<span className="status-tail">策略结果仅保存在当前演示会话</span></div>
          </>}
        </div>
      </main>
    </div>
  );
}

export default App;
