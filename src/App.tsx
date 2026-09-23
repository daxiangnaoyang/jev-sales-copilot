import { useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  CustomerMessage,
  CustomerConversation,
  CustomerProfile,
  CustomerStrategy,
  SalesDecision,
  BochaSearchResult,
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
import { demoStrategyProvider } from "./providers";
import { buildProductOutputs, defaultProductWorkspace } from "./product";
import { loadWorkspace, prepareImageForLocalStorage, saveWorkspace } from "./persistence";

type AppMode = "sales" | "materials" | "review";
type AgentMode = "demo" | "openai" | "openrouter-free" | "ollama" | "custom";

const modeLabels: Record<AppMode, { label: string; sub: string }> = {
  sales: { label: "销售副驾", sub: "判断与推进" },
  materials: { label: "产品素材", sub: "图文与视频" },
  review: { label: "沟通复盘", sub: "沉淀可复用策略" },
};

const WECHAT_IMPORT_AUDIT_KEY = "jev-sales-copilot:wechat-import-status:v1";

function saveWeChatImportAudit(summary: Record<string, string | number | boolean>) {
  try {
    window.localStorage.setItem(WECHAT_IMPORT_AUDIT_KEY, JSON.stringify({ ...summary, checkedAt: new Date().toISOString() }));
  } catch {
    // The import itself must not fail just because the non-sensitive audit summary cannot persist.
  }
}

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

function reviewInsight(decision: SalesDecision, strategy: CustomerStrategy) {
  if (decision.intent === "complaint") return "先承接情绪，再补齐订单和问题事实；没有核验前不做退款、补偿或时限承诺。";
  if (decision.intent === "price") return "报价前先确认数量与配置，把价格问题还原成可核验的购买条件。";
  if (decision.intent === "compare_product") return "客户需要的是自己的比较标准，不是一次堆满所有参数。";
  if (decision.intent === "request_material") return "素材要围绕客户要转发给谁、最关心哪个卖点来组织，默认一图一卖点。";
  return strategy.objective;
}

function reviewRule(decision: SalesDecision) {
  if (decision.intent === "complaint") return "高风险沟通先取事实，再谈处理；把承诺拆成可验证的下一步。";
  if (decision.intent === "price") return "不在购买条件未确认前报价；先问数量、配置和决策时间。";
  if (decision.intent === "compare_product") return "先确认决策维度，再发送对应卖点素材。";
  if (decision.intent === "request_material") return "资料不是越多越好；先确认用途，再按一个核心卖点生成可转发素材。";
  return "每轮只推进一个动作，并保留事实缺口。";
}

function makeReviewRecord(customer: CustomerProfile, messages: CustomerMessage[], decision: SalesDecision, strategy: CustomerStrategy, status: ReviewRecord["status"] = "待复盘"): ReviewRecord {
  return {
    id: `review-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    customer,
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

function createCustomerConversation(
  profile: CustomerProfile,
  messages: CustomerMessage[] = [],
  decision?: SalesDecision,
  strategy?: CustomerStrategy,
  sourceConversationTitle?: string,
): CustomerConversation {
  const seedText = [...messages].reverse().find((message) => message.sender === "customer")?.text ?? "";
  const resolvedDecision = decision ?? judgeCustomerMessage(seedText);
  return {
    profile,
    messages,
    decision: resolvedDecision,
    strategy: strategy ?? buildStrategy(resolvedDecision, seedText),
    ...(sourceConversationTitle ? { sourceConversationTitle } : {}),
  };
}

function restoreCustomers(saved: ReturnType<typeof loadWorkspace>): CustomerConversation[] {
  if (Array.isArray(saved?.customers)) {
    const valid = saved.customers.filter((item) => item?.profile?.id && item.profile.name && Array.isArray(item.messages) && item.decision && item.strategy);
    if (valid.length > 0) return valid;
  }
  if (Array.isArray(saved?.messages) && saved.messages.length > 0) {
    return [createCustomerConversation(demoCustomer, saved.messages, saved.decision, saved.strategy)];
  }
  const decision = judgeCustomerMessage(demoMessages[0].text);
  return [createCustomerConversation(demoCustomer, demoMessages, decision, buildStrategy(decision, demoMessages[0].text))];
}

function CustomerDialog({ onClose, onSave }: { onClose: () => void; onSave: (values: { name: string; company: string; role: string; note: string }) => void }) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [note, setNote] = useState("");

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="customer-dialog" role="dialog" aria-modal="true" aria-labelledby="customer-dialog-title">
      <div className="panel-heading"><div><span className="overline">NEW CUSTOMER</span><h2 id="customer-dialog-title">手动添加客户</h2></div><button className="dialog-close" type="button" aria-label="关闭" onClick={onClose}>×</button></div>
      <form onSubmit={(event) => { event.preventDefault(); onSave({ name, company, role, note }); }}>
        <label><span>客户姓名 / 会话名称 *</span><input autoFocus required maxLength={64} value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="输入客户姓名" /></label>
        <label><span>公司</span><input maxLength={100} value={company} onChange={(event) => setCompany(event.currentTarget.value)} placeholder="可留空" /></label>
        <label><span>角色</span><input maxLength={100} value={role} onChange={(event) => setRole(event.currentTarget.value)} placeholder="可留空" /></label>
        <label><span>备注</span><textarea maxLength={500} value={note} onChange={(event) => setNote(event.currentTarget.value)} placeholder="记录客户关注点、需求或跟进背景" rows={3} /></label>
        <div className="dialog-actions"><button className="text-button" type="button" onClick={onClose}>取消</button><button className="primary-button small-button" type="submit"><Icon name="plus" size={14} />创建并进入对话</button></div>
      </form>
    </section>
  </div>;
}

function MessageBubble({ message, customerName = "客户" }: { message: CustomerMessage; customerName?: string }) {
  const customer = message.sender === "customer";
  const transcript = message.sender === "transcript";
  return (
    <article className={`bubble-row ${transcript ? "is-transcript" : customer ? "is-customer" : "is-seller"}`}>
      <div className={`avatar ${transcript ? "seller-avatar" : customer ? "customer-avatar" : "seller-avatar"}`}>{transcript ? "OCR" : customer ? customerName.slice(0, 1) : "象"}</div>
      <div className="bubble-content">
        <div className="bubble-meta"><strong>{transcript ? "微信识别 · 尚未区分说话方" : customer ? `${customerName} · 客户` : "我 · 销售"}</strong><time>{formatTime(message.createdAt)}</time></div>
        <div className="bubble">{message.text}</div>
      </div>
    </article>
  );
}

function DecisionCard({ decision }: { decision: SalesDecision }) {
  return (
    <section className="panel decision-panel">
      <div className="panel-heading"><div><span className="overline">LOCAL SALES JUDGMENT</span><h2>本机客户判断</h2></div><span className="confidence"><i />{Math.round(decision.confidence * 100)}% 置信</span></div>
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

function RepliesCard({ strategy, onCopy, onFill }: { strategy: CustomerStrategy; onCopy: (text: string, id: string) => void; onFill: (text: string) => void }) {
  return (
    <section className="panel replies-panel">
      <div className="panel-heading"><div><span className="overline">REPLY OPTIONS</span><h2>候选回复</h2></div><span className="panel-note">Demo 排序 · 回填不发送</span></div>
      <div className="reply-list">
        {strategy.replies.map((reply, index) => (
          <article className={`reply-card ${index === 0 ? "is-recommended" : ""}`} key={reply.id}>
            <div className="reply-card-head"><span className="reply-index">0{index + 1}</span><strong>{reply.label}</strong>{index === 0 && <span className="recommended">推荐</span>}<span className={`risk risk-${reply.risk}`}>风险{reply.risk}</span></div>
            <p>{reply.text}</p>
            <div className="reply-card-foot"><span>{reply.purpose}</span><div><button onClick={() => onCopy(reply.text, reply.id)}><Icon name="copy" size={13} />复制</button><button onClick={() => onFill(reply.text)}><Icon name="arrow" size={13} />回填微信</button></div></div>
          </article>
        ))}
      </div>
      <div className="manual-send-note"><Icon name="shield" size={14} />回填后由你检查并手动发送；也可复制粘贴，App 不会代发</div>
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
        <div className="asset-upload"><div className="asset-upload-head"><div><span className="overline">SOURCE IMAGE</span><strong>产品图片</strong></div><span>{localImage ? "已导入 1 张" : "未导入"}</span></div><input id="product-image-upload" type="file" accept="image/*" onChange={(event) => onImageUpload(event.currentTarget.files?.[0])} /><label htmlFor="product-image-upload" className={`upload-box ${localImage ? "has-image" : ""}`}>{localImage ? <><img src={localImage.previewUrl} alt={localImage.name} /><div><strong>{localImage.name}</strong><small>已压缩并保存在本机，不上传服务器</small></div></> : <><Icon name="image" size={19} /><div><strong>导入产品图</strong><small>支持 JPG / PNG；用于图解草稿参考</small></div></>}</label></div>
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

  return <div className="review-workspace"><section className="review-hero"><div><span className="overline">COMMUNICATION REVIEW</span><h2>把一次沟通，变成<span>下一次能力</span></h2><p>回看客户判断、销售动作和事实缺口，只沉淀可复用的规则，不把一次偶然回复当成经验。</p></div><div className="review-stats"><div><strong>{pendingCount}</strong><span>待复盘</span></div><div><strong>{reviewedCount}</strong><span>已沉淀</span></div><div><strong>{highRiskCount}</strong><span>高风险</span></div></div></section><div className="review-grid"><section className="panel review-list-panel"><div className="panel-heading"><div><span className="overline">SESSIONS</span><h2>沟通记录</h2></div><span className="panel-note">本机自动保存</span></div><div className="review-list">{records.length === 0 ? <div className="review-empty">生成一次销售策略后，这里会出现可复盘记录。</div> : records.map((record) => <button key={record.id} className={`review-list-item ${selected?.id === record.id ? "is-active" : ""}`} onClick={() => onSelect(record.id)}><div className="review-list-top"><strong>{record.customer.name} · {record.customer.company || "微信会话"}</strong><span className={record.status === "已复盘" ? "reviewed-label" : "pending-label"}>{record.status}</span></div><p>{record.messages.filter((message) => (message.sender === "customer" || message.sender === "transcript")).at(-1)?.text}</p><div><span>{decisionLabel(record.decision.intent)}</span><span>风险 {record.decision.commercialRisk}/9</span><time>{formatTime(record.createdAt)}</time></div></button>)}</div></section><section className="panel review-detail-panel">{selected ? <><div className="panel-heading"><div className="contact-heading"><div className="customer-avatar large-avatar">{selected.customer.name.slice(0, 1)}</div><div><span className="overline">REVIEW DETAIL</span><h2>{selected.customer.name}</h2><p>{[selected.customer.company, selected.customer.role].filter(Boolean).join(" · ") || "资料待补充"}</p></div></div><span className={`review-badge ${selected.status === "已复盘" ? "ready" : "needs-review"}`}>{selected.status}</span></div><div className="review-timeline"><span className="overline">CONVERSATION SNAPSHOT</span>{selected.messages.slice(-4).map((message) => <MessageBubble key={message.id} message={message} customerName={selected.customer.name} />)}</div><div className="review-judgment"><div><span>本机销售判断</span><strong>{decisionLabel(selected.decision.intent)}</strong><small>{decisionLabel(selected.decision.stage)} · {Math.round(selected.decision.confidence * 100)}% 置信</small></div><div><span>Agent 下一步</span><strong>{selected.strategy.singleNextMove}</strong><small>{selected.strategy.humanConfirmationRequired ? "需要人工确认" : "可先准备"}</small></div></div><div className="review-insight"><span className="overline">INSIGHT</span><h3>{selected.insight}</h3><p><strong>可复用规则：</strong>{selected.reusableRule}</p><div className="review-avoid"><span>本轮不要做</span><strong>{selected.strategy.stopCondition}</strong></div></div><div className="review-detail-actions"><button className="text-button" onClick={() => onCopy(selected.strategy.replies[0]?.text ?? "", `review-${selected.id}`)}><Icon name="copy" size={13} />{copied === `review-${selected.id}` ? "已复制推荐回复" : "复制推荐回复"}</button><button className="primary-button small-button" onClick={() => onMarkReviewed(selected.id)} disabled={selected.status === "已复盘"}><Icon name="check" size={14} />{selected.status === "已复盘" ? "已沉淀规则" : "标记为已复盘"}</button></div></> : <div className="review-empty">暂无可复盘记录。</div>}</section></div></div>;
}

function App() {
  const [initialWorkspace] = useState(() => {
    const saved = loadWorkspace();
    const customers = restoreCustomers(saved);
    const selectedCustomerId = customers.some((item) => item.profile.id === saved?.selectedCustomerId)
      ? saved!.selectedCustomerId!
      : customers[0]?.profile.id ?? "";
    return { saved, customers, selectedCustomerId };
  });
  const savedWorkspace = initialWorkspace.saved;
  const [mode, setMode] = useState<AppMode>("sales");
  const [customers, setCustomers] = useState<CustomerConversation[]>(initialWorkspace.customers);
  const [selectedCustomerId, setSelectedCustomerId] = useState(initialWorkspace.selectedCustomerId);
  const [draft, setDraft] = useState("");
  const selectedConversation = useMemo(() => customers.find((item) => item.profile.id === selectedCustomerId), [customers, selectedCustomerId]);
  const messages = selectedConversation?.messages ?? [];
  const decision = selectedConversation?.decision ?? judgeCustomerMessage("");
  const strategy = selectedConversation?.strategy ?? buildStrategy(decision, "");
  const [productWorkspace, setProductWorkspace] = useState<ProductWorkspace>(() => savedWorkspace?.productWorkspace ?? defaultProductWorkspace);
  const [reviewRecords, setReviewRecords] = useState<ReviewRecord[]>(() => {
    if (savedWorkspace?.reviewRecords) return savedWorkspace.reviewRecords;
    const initialDecision = judgeCustomerMessage(demoMessages[0].text);
    const initialStrategy = buildStrategy(initialDecision, demoMessages[0].text);
    return [makeReviewRecord(demoCustomer, demoMessages, initialDecision, initialStrategy)];
  });
  const [selectedReviewId, setSelectedReviewId] = useState<string | undefined>(savedWorkspace?.selectedReviewId);
  const [assetQueued, setAssetQueued] = useState(false);
  const [notice, setNotice] = useState(isTauri() ? "微信会话列表不会在启动时自动导入；请确认窗口后手动操作" : "本机判断与本地策略已就绪");
  const [copied, setCopied] = useState<string>();
  const [wechatBusy, setWechatBusy] = useState(false);
  const [wechatWindowTitle, setWechatWindowTitle] = useState("");
  const [wechatConversationTitle, setWechatConversationTitle] = useState("");
  const [wechatStatus, setWechatStatus] = useState(isTauri() ? "等待手动读取微信会话列表" : "微信自动识别仅在 macOS 桌面 App 中可用");
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [agentMode, setAgentMode] = useState<AgentMode>("demo");
  const [shareWithProviders, setShareWithProviders] = useState(false);
  const [agentEndpoint, setAgentEndpoint] = useState("https://api.openai.com/v1");
  const [agentApiKey, setAgentApiKey] = useState("");
  const [agentModel, setAgentModel] = useState("");
  const [providerCheck, setProviderCheck] = useState("");
  const [agentAvailableModels, setAgentAvailableModels] = useState<string[]>([]);
  const [bochaApiKey, setBochaApiKey] = useState("");
  const [bochaQuery, setBochaQuery] = useState("");
  const [bochaConsent, setBochaConsent] = useState(false);
  const [bochaBusy, setBochaBusy] = useState(false);
  const [bochaResults, setBochaResults] = useState<BochaSearchResult[]>([]);
  const [bochaStatus, setBochaStatus] = useState("");

  const liveProviders = agentMode !== "demo";
  const cloudProviderSelected = ["openai", "openrouter-free", "custom"].includes(agentMode);

  const conversationCount = useMemo(() => messages.filter((item) => item.sender === "customer" || item.sender === "transcript").length, [messages]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = saveWorkspace({ customers, selectedCustomerId, productWorkspace, reviewRecords, selectedReviewId });
      if (!saved) setNotice("本机存储空间不足，最近修改未能保存；可移除较大的产品图片后重试");
    }, 250);
    return () => window.clearTimeout(timer);
  }, [customers, selectedCustomerId, productWorkspace, reviewRecords, selectedReviewId]);

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

  async function analyzeText(input: string, source: "manual" | "wechat" = "manual", targetConversation?: CustomerConversation): Promise<boolean> {
    const text = input.trim();
    if (!text || analysisBusy) return false;
    const conversation = targetConversation ?? selectedConversation;
    if (!conversation) {
      setNotice("请先新增或选择客户，再分析这段聊天。");
      return false;
    }
    setAnalysisBusy(true);
    try {
    const nextMessages = [...conversation.messages, createCustomerMessage(text, source === "wechat" ? "transcript" : "customer")];
    let nextDecision: SalesDecision;
    let nextStrategy: CustomerStrategy;
    const useLocalStrategy = agentMode === "demo" || (cloudProviderSelected && !shareWithProviders);
    nextDecision = judgeCustomerMessage(text);
    if (!useLocalStrategy) {
      if (!isTauri()) {
        setNotice("真实服务仅在桌面 App 中可用；本轮未发送数据。");
        return false;
      }
      if (!agentModel.trim() || (agentMode !== "ollama" && !agentApiKey.trim())) {
        setNotice("请填写 Agent 模型名和所需 API Key；本地 Ollama 不需要 Key。");
        return false;
      }
      try {
        nextStrategy = await invoke<CustomerStrategy>("agent_strategy", {
          text,
          decision: nextDecision,
          endpoint: agentEndpoint,
          apiKey: agentApiKey,
          model: agentModel,
        });
      } catch (error) {
        setNotice(`Provider 未完成，本轮未生成回复：${String(error)}。`);
        return false;
      }
    } else {
      nextStrategy = await demoStrategyProvider.generate({ decision: nextDecision, latestMessage: text });
    }
    const touchedProfile = { ...conversation.profile, lastTouched: `今天 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date())}` };
    setCustomers((current) => current.map((item) => item.profile.id === conversation.profile.id
      ? { ...item, profile: touchedProfile, messages: nextMessages, decision: nextDecision, strategy: nextStrategy }
      : item));
    setSelectedCustomerId(conversation.profile.id);
    const reviewRecord = makeReviewRecord(touchedProfile, nextMessages, nextDecision, nextStrategy);
    setReviewRecords((current) => [reviewRecord, ...current].slice(0, 12));
    setSelectedReviewId(reviewRecord.id);
    setDraft("");
    setAssetQueued(false);
    setNotice(useLocalStrategy && cloudProviderSelected
      ? "本轮未同意向云端 Agent 发送内容；已用本机策略完成分析。请审阅候选回复后再回填"
      : `客户判断已在本机完成；Agent：${agentMode === "demo" ? "本机策略" : agentMode === "ollama" ? "本机 Ollama" : "云端模型"}。请审阅候选回复后再回填`);
    return true;
    } finally {
      setAnalysisBusy(false);
    }
  }

  async function generateStrategy() {
    await analyzeText(draft);
  }

  function selectCustomer(id: string) {
    setSelectedCustomerId(id);
    setDraft("");
    setAssetQueued(false);
  }

  function addCustomer(values: { name: string; company: string; role: string; note: string }) {
    const name = values.name.trim();
    if (!name) return;
    const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date());
    const profile: CustomerProfile = {
      id: `customer-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name,
      company: values.company.trim(),
      role: values.role.trim(),
      stage: "new_lead",
      lastTouched: `今天 ${time}`,
      note: values.note.trim(),
    };
    const conversation = createCustomerConversation(profile);
    setCustomers((current) => [...current, conversation]);
    setSelectedCustomerId(profile.id);
    setDraft("");
    setMode("sales");
    setCustomerDialogOpen(false);
    setNotice(`已新增客户「${name}」，可粘贴聊天或读取微信会话。`);
  }

  function findOrCreateWeChatCustomer(title: string): CustomerConversation {
    const normalized = title.trim().toLocaleLowerCase().replace(/\s+/g, "");
    const existing = customers.find((item) =>
      (item.sourceConversationTitle ?? item.profile.name).trim().toLocaleLowerCase().replace(/\s+/g, "") === normalized,
    );
    if (existing) return existing;

    const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date());
    const profile: CustomerProfile = {
      id: `wechat-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: title.trim(),
      company: "",
      role: "",
      stage: "new_lead",
      lastTouched: `今天 ${time}`,
      note: "由微信会话标题本机 OCR 识别创建；公司、角色等资料待补充。",
    };
    const conversation = createCustomerConversation(profile, [], undefined, undefined, title.trim());
    setCustomers((current) => current.some((item) => item.profile.id === profile.id) ? current : [...current, conversation]);
    return conversation;
  }

  async function importRecentWeChatCustomers() {
    if (!isTauri()) {
      setWechatStatus("微信会话列表导入仅在 macOS 桌面 App 中可用");
      setNotice("请在 macOS App 中打开微信会话列表后导入最近 20 个单聊客户。");
      return;
    }
    setWechatBusy(true);
    setWechatStatus("正在本机识别微信会话列表…");
    setNotice("正在本机读取微信会话列表客户名称；不会读取聊天正文…");
    try {
      const captureAllowed = await invoke<boolean>("request_screen_capture_access");
      if (!captureAllowed) {
        saveWeChatImportAudit({ success: false, error: "screen_capture_authorization_required" });
        setWechatWindowTitle("");
        setWechatStatus("等待屏幕录制授权");
        setNotice("macOS 仍未允许当前 App 进程读屏。请退出 App，在系统设置 → 隐私与安全性 → 屏幕录制中关闭后重新开启 Jev 销售副驾，再重启并导入；此时未读取微信内容。");
        return;
      }
      const result = await invoke<{
        window_title: string;
        customers: Array<{ name: string }>;
        visible_rows: number;
        skipped_group_rows: number;
        skipped_uncertain_rows: number;
        status: string;
      }>("import_recent_wechat_customers");
      const seen = new Set(customers.map((item) =>
        (item.sourceConversationTitle ?? item.profile.name).trim().toLocaleLowerCase().replace(/\s+/g, ""),
      ));
      const imported: CustomerConversation[] = [];
      for (const candidate of result.customers.slice(0, 20)) {
        const name = candidate.name.trim();
        const normalized = name.toLocaleLowerCase().replace(/\s+/g, "");
        if (!name || seen.has(normalized)) continue;
        seen.add(normalized);
        const now = new Date();
        const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(now);
        imported.push(createCustomerConversation({
          id: `wechat-${crypto.randomUUID()}`,
          name,
          company: "",
          role: "",
          stage: "new_lead",
          lastTouched: `今天 ${time}`,
          note: "来自微信会话列表本机 OCR；未读取聊天正文。",
        }, [], undefined, undefined, name));
      }
      if (imported.length) {
        setCustomers((current) => [...current, ...imported]);
        setSelectedCustomerId(imported[0].profile.id);
        setDraft("");
      }
      saveWeChatImportAudit({
        success: true,
        visibleRows: result.visible_rows,
        candidates: result.customers.length,
        newlyImported: imported.length,
        skippedGroupRows: result.skipped_group_rows,
        skippedUncertainRows: result.skipped_uncertain_rows,
      });
      setWechatWindowTitle(result.window_title);
      setWechatConversationTitle("");
      const total = imported.length;
      setWechatStatus(`会话列表识别完成：新增 ${total} 位，可见候选 ${result.customers.length} 位`);
      const groupNote = result.skipped_group_rows ? `已跳过 ${result.skipped_group_rows} 个名称含群聊标记的条目；` : "未检测到显式群聊标记（类型判断基于名称 OCR）；";
      const uncertainNote = result.skipped_uncertain_rows ? `另跳过 ${result.skipped_uncertain_rows} 个低置信/非联系人条目。` : "";
      const limitNote = result.customers.length < 20 ? " 可见条目不足 20；滚动微信会话列表后可再次导入。" : "";
      setNotice(`${result.status} 本次新增 ${total} 位（已存在的客户自动去重）；${groupNote}${uncertainNote}${limitNote}`);
    } catch (error) {
      const message = String(error);
      saveWeChatImportAudit({ success: false, error: message.slice(0, 180) });
      setWechatWindowTitle("");
      setWechatConversationTitle("");
      setWechatStatus("未能识别微信会话列表");
      setNotice(`${message} 请确认微信主窗口已打开并授权屏幕录制；聊天内容不会上传。`);
    } finally {
      setWechatBusy(false);
    }
  }

  async function readWeChatAndAnalyze() {
    if (!isTauri()) {
      setWechatStatus("微信自动识别仅在 macOS 桌面 App 中可用");
      setNotice("微信自动读取仅在 macOS 桌面应用中可用；可在下方手动粘贴聊天内容");
      return;
    }
    setWechatBusy(true);
    setWechatStatus("正在检测微信窗口并进行本机 OCR…");
    setNotice("正在定位微信窗口并读取当前会话…");
    try {
      const scan = await invoke<{ window_title: string; conversation_title?: string; text: string; status: string }>("scan_wechat");
      setWechatWindowTitle(scan.window_title);
      const title = scan.conversation_title?.trim();
      if (!title) {
        setWechatConversationTitle("");
        setDraft(scan.text);
        setWechatStatus("已检测到微信；联系人名未能确认");
        setNotice("已在本机读取微信，但 OCR 未能确认会话名称。文本留在输入框；请先选择或新增客户，再点“生成策略”。");
        return;
      }
      const target = findOrCreateWeChatCustomer(title);
      setWechatConversationTitle(title);
      setSelectedCustomerId(target.profile.id);
      setWechatStatus(`已识别微信会话：${title}`);
      if (target.messages.some((message) => message.sender === "transcript" && message.text === scan.text)) {
        setDraft("");
        setNotice(`已识别并切换到「${title}」；当前画面内容已处理过，未重复追加。`);
        return;
      }
      setDraft(scan.text);
      setNotice(`已识别「${title}」，正在由本机销售判断与 Agent 处理…`);
      const completed = await analyzeText(scan.text, "wechat", target);
      if (completed) setNotice(`已完成「${title}」会话的判断与策略生成；回复可回填，但不会自动发送`);
    } catch (error) {
      const message = String(error);
      setWechatWindowTitle("");
      setWechatConversationTitle("");
      setWechatStatus("未能识别微信窗口");
      setNotice(`${message} 可手动粘贴聊天，或稍后重试微信识别。`);
    } finally {
      setWechatBusy(false);
    }
  }

  async function fillWeChat(text: string) {
    if (!isTauri()) {
      await copyText(text, "reply-fallback");
      setNotice("浏览器演示模式：回复已复制，请切到微信手动粘贴并发送");
      return;
    }
    try {
      const result = await invoke<string>("fill_wechat_input", { text });
      setNotice(result);
    } catch (error) {
      await copyText(text, "reply-fallback");
      setNotice(`${String(error)} 已复制回复作为手动粘贴兜底；不会自动发送。`);
    }
  }

  async function checkAgent() {
    if (!isTauri()) { setProviderCheck("连通性检查只可在桌面 App 运行；不会发送客户对话。"); return; }
    setProviderCheck("正在检查 Agent /models（不会发送客户对话或调用生成模型）…");
    try {
      const result = await invoke<{ message: string; models: string[] }>("check_agent_provider", { endpoint: agentEndpoint, apiKey: agentApiKey });
      setAgentAvailableModels(result.models);
      setProviderCheck(`${result.message}${result.models.length ? ` · 已读取 ${result.models.length} 个模型，可在模型建议中选择` : " · 可手动填写模型 ID"}`);
    } catch (error) { setProviderCheck(String(error)); }
  }

  async function searchBocha() {
    const query = bochaQuery.trim();
    const apiKey = bochaApiKey.trim();
    if (!query || !apiKey || !bochaConsent || bochaBusy) return;
    if (query.length > 200) { setBochaStatus("搜索词最多 200 个字符。"); return; }
    if (!isTauri()) { setBochaStatus("博查搜索仅可在 macOS 桌面 App 中调用。"); return; }
    setBochaConsent(false);
    setBochaBusy(true);
    setBochaStatus("正在向博查提交本次公开搜索词…");
    setBochaResults([]);
    try {
      const response = await invoke<{ results: BochaSearchResult[] }>("bocha_search", { query, apiKey });
      setBochaResults(response.results);
      setBochaStatus(response.results.length ? `搜索完成：${response.results.length} 条公开网页结果。` : "搜索完成：没有返回结果。");
    } catch (error) {
      setBochaStatus(`搜索失败：${String(error)}`);
    } finally {
      setBochaBusy(false);
    }
  }

  function selectAgentMode(value: AgentMode) {
    setAgentMode(value);
    if (value === "openai") { setAgentEndpoint("https://api.openai.com/v1"); setAgentModel("gpt-4.1-mini"); }
    if (value === "openrouter-free") { setAgentEndpoint("https://openrouter.ai/api/v1"); setAgentModel("openrouter/free"); }
    if (value === "ollama") { setAgentEndpoint("http://localhost:11434/v1"); setAgentModel(""); setAgentApiKey(""); }
  }

  function resetDemo() {
    setDraft("");
    setAssetQueued(false);
    if (selectedConversation?.profile.id === demoCustomer.id) {
      const nextDecision = judgeCustomerMessage(demoMessages[0].text);
      setCustomers((current) => current.map((item) => item.profile.id === demoCustomer.id
        ? createCustomerConversation(demoCustomer, demoMessages, nextDecision, buildStrategy(nextDecision, demoMessages[0].text))
        : item));
      setNotice("已回到演示案例");
      return;
    }
    setNotice("已清空输入草稿，当前客户的历史会话已保留。");
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

  async function uploadProductImage(file?: File) {
    if (!file) return;
    try {
      const previewUrl = await prepareImageForLocalStorage(file);
      setProductWorkspace((current) => ({
        ...current,
        images: [{ id: `image-${Date.now()}`, name: file.name, previewUrl, source: "local-upload", note: "已压缩后保存在本机，不上传服务器" }, ...current.images.filter((image) => image.source !== "local-upload")],
        status: "COLLECTING",
      }));
      setNotice("产品图已压缩并保存在本机，未上传服务器");
    } catch (error) {
      setNotice(error instanceof Error ? `图片导入失败：${error.message}` : "图片导入失败，请换一张图片重试");
    }
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
        <div className="customer-section"><div className="section-heading"><span>客户 · {customers.length}</span><button type="button" aria-label="手动新增客户" title="手动新增客户" onClick={() => setCustomerDialogOpen(true)}><Icon name="plus" size={14} /><span>新增</span></button></div>{customers.map((item) => <button type="button" key={item.profile.id} aria-pressed={item.profile.id === selectedCustomerId} aria-label={`切换到客户 ${item.profile.name}`} className={`customer-item ${item.profile.id === selectedCustomerId ? "is-active" : ""}`} onClick={() => selectCustomer(item.profile.id)}><div className={`customer-avatar ${item.profile.id === selectedCustomerId ? "" : "muted-avatar"}`}>{item.profile.name.slice(0, 1)}</div><div><strong>{item.profile.name}</strong><small>{item.profile.company || item.profile.role || "微信会话 · 资料待补充"}</small></div><i /></button>)}</div>
        <div className="sidebar-bottom"><div className="privacy-card"><Icon name="shield" size={16} /><div><strong>本机自动保存</strong><span>仅启用云端时按确认发送文字</span></div></div><div className="provider-row"><span className="provider-dot" />判断：本机规则 · Agent：{agentMode === "demo" ? "本地 Demo" : agentMode === "ollama" ? "本地模型" : "云端模型"}</div><button className="provider-settings-trigger" type="button" onClick={() => setProviderDialogOpen(true)} aria-haspopup="dialog" aria-expanded={providerDialogOpen}><span className="provider-settings-icon">⚙</span><span>模型与服务配置</span><span className="provider-settings-arrow">›</span></button></div>
      </aside>
      <main className="main-area">
        <header className="topbar"><div><span className="crumb">JEV SALES COPILOT / {modeLabels[mode].label.toUpperCase()}</span><h1>{mode === "sales" ? "客户沟通副驾" : modeLabels[mode].label}</h1></div><div className="top-actions"><span className="demo-pill">{liveProviders ? "已配置 Provider" : "本地演示"}</span><span className="safe-pill"><i />不自动发送</span><div className="user-avatar">象</div></div></header>
        <div className="content-scroll">
          {mode === "materials" ? <ProductMaterialsView workspace={productWorkspace} selectedOutput={selectedProductOutput} copied={copied} onUpdateField={updateProductField} onUpdateFact={updateProductFact} onAddFact={addProductFact} onImageUpload={uploadProductImage} onGenerate={generateProductPackage} onSelectOutput={(id) => setProductWorkspace((current) => ({ ...current, selectedOutputId: id }))} onCopy={copyText} /> : mode === "review" ? <ReviewView records={reviewRecords} selectedId={selectedReviewId ?? reviewRecords[0]?.id} copied={copied} onSelect={setSelectedReviewId} onMarkReviewed={markReviewReviewed} onCopy={copyText} /> : <>
            <section className="hero-row"><div><span className="overline">TODAY'S CUSTOMER MOMENT</span><h2>让每一次客户回复，<em>都有下一步</em></h2><p>本机先判断客户状态，Agent 再生成策略。你负责最后的判断和发送。</p></div><div className="hero-stats"><div><strong>{conversationCount}</strong><span>本次客户消息</span></div><div><strong>{Math.round(decision.confidence * 100)}%</strong><span>当前判断置信度</span></div><div><strong>{decision.commercialRisk}</strong><span>商业风险 / 9</span></div></div></section>
            <div className="workspace-grid">
              <section className="panel conversation-panel">
                <div className="panel-heading conversation-heading">
                  <div className="contact-heading"><div className="customer-avatar large-avatar">{selectedConversation?.profile.name.slice(0, 1) ?? "客"}</div><div><span className="overline">CURRENT CUSTOMER</span><h2>{selectedConversation?.profile.name ?? "请先新增客户"}</h2><p>{selectedConversation?.profile.company || selectedConversation?.profile.role || "客户资料可随时补充"}</p></div></div>
                  <div className="conversation-head-actions"><span className="stage-pill">{decisionLabel(decision.stage)}</span><select aria-label="切换当前客户" value={selectedCustomerId} onChange={(event) => selectCustomer(event.currentTarget.value)}>{customers.map((item) => <option key={item.profile.id} value={item.profile.id}>{item.profile.name}</option>)}</select><button className="text-button" type="button" onClick={() => setCustomerDialogOpen(true)}><Icon name="plus" size={13} />新增</button></div>
                </div>
                <div className={`wechat-status ${wechatBusy ? "is-busy" : wechatWindowTitle ? "is-ready" : "is-idle"}`} role="status"><span className="wechat-status-dot" /><div><strong>{wechatStatus}</strong><small>{wechatConversationTitle ? `窗口：${wechatWindowTitle} · 当前会话：${wechatConversationTitle}` : wechatWindowTitle ? `窗口：${wechatWindowTitle} · 名单 OCR 仅处理左侧会话列表，不读取右侧聊天正文` : "自动不导入；请确认窗口和候选后手动操作"}</small></div><button className="text-button" type="button" onClick={() => void importRecentWeChatCustomers()} disabled={wechatBusy}><Icon name="refresh" size={13} />{wechatBusy ? "导入中…" : "尝试导入可见会话候选"}</button><button className="text-button" type="button" onClick={() => void readWeChatAndAnalyze()} disabled={wechatBusy || analysisBusy}>读取当前会话</button></div>
                <div className="conversation-list">{messages.length ? messages.map((message) => <MessageBubble key={message.id} message={message} customerName={selectedConversation?.profile.name} />) : <div className="conversation-empty"><strong>「{selectedConversation?.profile.name}」还没有会话记录</strong><span>可粘贴聊天内容，或打开微信中的对应会话后重新识别。</span></div>}</div>
                <div className="message-input"><div className="input-label"><span>输入或自动读取微信聊天</span><small>{agentMode === "ollama" ? "本轮聊天和策略均由本机 Ollama 处理" : cloudProviderSelected && shareWithProviders ? "本轮文字将发送给已同意的 Agent 云服务" : "本机判断与策略运行；聊天文本不上传"}</small></div><textarea value={draft} onChange={(event) => setDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); generateStrategy(); } }} placeholder="手动粘贴聊天内容；微信 OCR 识别后也会出现在这里……" rows={3} /><div className="input-actions"><button className="text-button" onClick={resetDemo}><Icon name="refresh" size={13} />{selectedConversation?.profile.id === demoCustomer.id ? "重置案例" : "清空草稿"}</button><span>Enter 生成 · Shift + Enter 换行</span><button className="primary-button small-button" onClick={generateStrategy} disabled={!draft.trim() || wechatBusy || analysisBusy}><Icon name="spark" size={14} />{analysisBusy ? "处理中…" : "生成策略"}</button></div></div>
              </section>
              <DecisionCard decision={decision} />
            </div>
            <div className="lower-grid"><StrategyCard strategy={strategy} /><div className="right-stack"><RepliesCard strategy={strategy} onCopy={copyText} onFill={fillWeChat} /><section className="panel asset-panel"><div className="panel-heading"><div><span className="overline">NEXT ASSET</span><h2>推荐素材</h2></div><span className={assetQueued ? "queued-badge" : "panel-note"}>{assetQueued ? "任务已准备" : "按需调用"}</span></div>{strategy.asset ? <div className="asset-content"><div className="asset-icon"><Icon name="image" size={19} /></div><div><strong>{strategy.asset.title}</strong><p>{strategy.asset.reason}</p><span>product-showcase · {strategy.asset.type === "comparison_card" ? "差异对比图解" : "产品卖点素材"}</span></div></div> : <div className="asset-empty"><span>当前先完成需求了解</span><small>客户出现明确的资料、对比或分享需求后再生成</small></div>}<button className="asset-button" onClick={queueAsset} disabled={!strategy.asset || assetQueued}><Icon name="spark" size={14} />{assetQueued ? "素材任务已准备" : "生成素材任务草稿"}</button></section></div></div>
            <div className="status-line"><span className="status-light" />{notice}<span className="status-tail">微信读取需手动触发；不会自动发送消息</span></div>
          </>}
        </div>
      </main>
      {customerDialogOpen && <CustomerDialog onClose={() => setCustomerDialogOpen(false)} onSave={addCustomer} />}
      {providerDialogOpen && <div className="modal-backdrop provider-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProviderDialogOpen(false); }}><section className="provider-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-dialog-title"><header className="provider-dialog-header"><div><span className="overline">PROVIDER SETTINGS</span><h2 id="provider-dialog-title">模型与服务配置</h2></div><button className="dialog-close" type="button" aria-label="关闭模型与服务配置" onClick={() => setProviderDialogOpen(false)}>×</button></header><div className="provider-dialog-content"><div className="provider-sections">
        <section><div className="provider-section-heading"><div><strong>① 本机判断 · 客户状态识别</strong><small>规则与销售状态判断留在设备本机，不上传聊天文本</small></div><span className="panel-note">默认启用 · 免费</span></div><p className="provider-disclosure">当前判断由本地规则完成；博查只提供用户主动发起的公开网页搜索，不替代销售判断模型。</p></section>
        <section><div className="provider-section-heading"><div><strong>② 博查 · 按需搜索公开资料</strong><small>查询产品参数、公开政策或行业信息；不是对话模型</small></div><span className="panel-note">每次手动搜索</span></div><div className="provider-fields"><label><span>博查 API Key（仅本次运行内存）</span><input type="password" autoComplete="off" value={bochaApiKey} onChange={(event) => setBochaApiKey(event.currentTarget.value)} placeholder="在 open.bochaai.com 获取 API Key" /></label><label><span>公开搜索词（不含客户信息）</span><input maxLength={200} value={bochaQuery} onChange={(event) => setBochaQuery(event.currentTarget.value)} placeholder="例如：某产品官方续航参数" /></label><label className="provider-toggle consent-toggle"><input type="checkbox" checked={bochaConsent} onChange={(event) => setBochaConsent(event.currentTarget.checked)} /><span>我确认本次仅提交上方公开搜索词，不含客户聊天、姓名、电话、订单或报价；我了解搜索可能按次计费。</span></label><div className="provider-action"><button className="primary-button small-button" type="button" onClick={() => void searchBocha()} disabled={!bochaApiKey.trim() || !bochaQuery.trim() || !bochaConsent || bochaBusy}><Icon name="spark" size={13} />{bochaBusy ? "搜索中…" : "搜索公开资料"}</button><span>点击后本次确认会自动重置；结果只展示，不自动发给 Agent。</span></div>{bochaStatus && <div className="provider-result" role="status">{bochaStatus}</div>}{bochaResults.length > 0 && <div className="bocha-results">{bochaResults.map((result, index) => <article className="bocha-result" key={`${result.url}-${index}`}><strong>{result.title}</strong><small>{result.siteName}{result.publishedDate ? ` · ${result.publishedDate}` : ""}</small><p>{result.summary || result.snippet}</p><span>{result.url}</span></article>)}</div>}</div></section>
        <section><div className="provider-section-heading"><div><strong>③ Agent · 策略与回复生成</strong><small>基于本机销售判断起草策略与候选回复</small></div><label className="provider-mode"><span>服务</span><select value={agentMode} onChange={(event) => selectAgentMode(event.currentTarget.value as AgentMode)}><option value="demo">本地 Demo · 免费</option><option value="ollama">本地 Ollama · 免费运行</option><option value="openrouter-free">OpenRouter 免费模型</option><option value="openai">OpenAI API · 按量计费</option><option value="custom">自定义 OpenAI-compatible</option></select></label></div>
          {agentMode !== "demo" && <div className="provider-fields">{agentMode !== "ollama" && <label><span>服务商 API Key（仅本次运行内存）</span><input type="password" autoComplete="off" value={agentApiKey} onChange={(event) => setAgentApiKey(event.currentTarget.value)} placeholder={agentMode === "openrouter-free" ? "OpenRouter Key（需注册；免费模型有限额）" : "粘贴 API Key"} />{agentMode === "openrouter-free" && <small>免费路由按请求选择当前可用模型；额度和供应商可能变化。</small>}</label>}<label><span>模型 ID</span><input list="agent-model-catalog" value={agentModel} onChange={(event) => setAgentModel(event.currentTarget.value)} placeholder={agentMode === "ollama" ? "先在本机安装并拉取模型，如 qwen3:8b" : "填写或从测试连接获取的模型目录中选择"} /><datalist id="agent-model-catalog">{agentAvailableModels.map((model) => <option key={model} value={model} />)}</datalist></label>{agentMode === "custom" && <label><span>OpenAI-compatible Base URL</span><input value={agentEndpoint} onChange={(event) => setAgentEndpoint(event.currentTarget.value)} placeholder="https://provider.example/v1" /></label>}{agentMode === "ollama" && <label><span>本机 OpenAI-compatible Base URL</span><input value={agentEndpoint} onChange={(event) => setAgentEndpoint(event.currentTarget.value)} placeholder="http://localhost:11434/v1" /></label>}<div className="provider-action"><button className="text-button" onClick={checkAgent}>测试 Agent 连接</button><span>只读取 /models，不会发送聊天内容或产生生成调用。</span></div></div>}
        </section>
        {providerCheck && <div className="provider-result" role="status">{providerCheck}</div>}
        {cloudProviderSelected && <label className="provider-toggle consent-toggle"><input type="checkbox" checked={shareWithProviders} onChange={(event) => setShareWithProviders(event.currentTarget.checked)} /><span>我同意在分析时将本轮微信/手动聊天文本发送到我启用的云端服务商；截图不上传。可随时关闭云端服务或撤销同意。</span></label>}
        <p className="provider-disclosure">本机判断、产品素材、客户资料和复盘不因博查搜索自动外发。博查仅在你填写独立公开搜索词、确认当次提交并点击搜索后收到该词；每次可能按量计费。搜索结果不自动进入 Agent。Agent 云端仅在单独同意后收到当前分析文本和本机结构化判断。API Key 不持久化；会话与复盘数据仍保存在本机。Agent 云端地址仅允许 HTTPS。</p>
      </div></div></section></div>}
    </div>
  );
}

export default App;
