import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  CustomerMessage,
  CustomerConversation,
  CustomerProfile,
  CustomerStrategy,
  SalesDecision,
  ProductFactStatus,
  ProductOutput,
  ProductOutputType,
  ProductImage,
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
import { buildProductOutputs, defaultProductWorkspace, normalizeProductWorkspace } from "./product";
import { checkBrowserAgent, requestBrowserProductIntake } from "./browser-agent";
import { applyProductFactsBulkEdit, formatProductFactsForBulkEdit } from "./product-bulk-edit";
import { applyAgentProductIntake, confirmAgentProductFacts, hasConfirmableProductFacts, localProductIntake, needsExplicitProductName, shouldUseLocalProductIntake, type AgentProductIntakeResult } from "./product-intake";
import { appendBrowserTranscript, parseBrowserTranscript, parseLabeledWeChatTranscript } from "./browser-conversation";
import { BrowserScreenReader } from "./BrowserScreenReader";
import { loadProviderPreferences, loadWorkspace, prepareImageForLocalStorage, saveProviderPreferences, saveWorkspace } from "./persistence";
import { buildVideoGenerationPrompt } from "./video-storyboard";
import { checkSeedanceProvider, createSeedanceTask, DEFAULT_VIDEO_MODEL, getSeedanceTask } from "./video-provider";
import { canSkipUnchangedAutomaticWeChatScan, collectNewWeChatCustomerNames, normalizeWeChatCustomerName, resolveWeChatCustomer } from "./wechat-customer-resolution";

type AppMode = "sales" | "materials" | "review";
type AgentMode = "demo" | "openai" | "openrouter-free" | "ollama" | "custom";
type WeChatSpeaker = "customer" | "seller" | "unknown";
type WeChatScanMessage = { speaker: WeChatSpeaker; sender?: string | null; text: string; confidence: number };
type WeChatScanResult = {
  window_id: number;
  window_title: string;
  window_bounds: [number, number, number, number];
  conversation_title?: string;
  title_confidence?: number;
  messages: WeChatScanMessage[];
  visual_input_rect?: [number, number, number, number] | null;
  visual_chat_signature?: string | null;
  text: string;
  status: string;
};
type PendingWeChatScan = {
  windowId: number;
  title?: string;
  titleConfidence?: number;
  windowBounds: [number, number, number, number];
  visualInputRect?: [number, number, number, number] | null;
  visualChatSignature?: string | null;
  messages: WeChatScanMessage[];
  text: string;
  signature: string;
  customerId?: string;
};

const modeLabels: Record<AppMode, { label: string; sub: string }> = {
  sales: { label: "销售副驾", sub: "判断与推进" },
  materials: { label: "产品素材", sub: "图文与视频" },
  review: { label: "沟通复盘", sub: "沉淀可复用策略" },
};

const WECHAT_IMPORT_AUDIT_KEY = "jev-sales-copilot:wechat-import-status:v1";
const WECHAT_IMPORT_LIMIT = 10;
const PRODUCT_INTAKE_DRAFT_KEY = "jev-sales-copilot:product-intake-draft:v1";
const BROWSER_TEST_CUSTOMER_ID = "browser-validation-customer";

function saveWeChatImportAudit(summary: Record<string, string | number | boolean>) {
  try {
    window.localStorage.setItem(WECHAT_IMPORT_AUDIT_KEY, JSON.stringify({ ...summary, checkedAt: new Date().toISOString() }));
  } catch {
    // The import itself must not fail just because the non-sensitive audit summary cannot persist.
  }
}

function wechatScanSignature(scan: Pick<WeChatScanResult, "window_id" | "window_bounds" | "conversation_title" | "messages" | "visual_input_rect" | "visual_chat_signature">) {
  return JSON.stringify([
    scan.window_id,
    scan.window_bounds,
    scan.conversation_title?.trim() ?? "",
    scan.messages.map(({ speaker, sender, text }) => [speaker, sender?.trim() ?? "", text.trim()]),
    scan.visual_input_rect ?? null,
    scan.visual_chat_signature ?? null,
  ]);
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    spark: <><path d="m12 3-1.5 4.5L6 9l4.5 1.5L12 15l1.5-4.5L18 9l-4.5-1.5Z" /><path d="m5 16-.7 2.3L2 19l2.3.7L5 22l.7-2.3Z" /></>,
    message: <><path d="M5 5h14v10H8l-4 4V5h1Z" /><path d="M8 9h8M8 12h5" /></>,
    copy: <><rect width="13" height="13" x="8" y="8" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    edit: <><path d="m4 17 10-10 3 3L7 20H4v-3Z" /><path d="m13 8 3-3a2 2 0 0 1 3 3l-3 3" /></>,
    image: <><rect width="18" height="16" x="3" y="4" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m4 17 5-5 3 3 2-2 6 6" /></>,
    video: <><rect width="16" height="14" x="3" y="5" rx="2" /><path d="m19 9 3-2v10l-3-2M8 5V3M12 5V3" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6" /></>,
    list: <><path d="M9 6h12M9 12h12M9 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
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
  const resolvedDecision = decision ?? demoDecision(seedText);
  return {
    profile,
    messages,
    decision: resolvedDecision,
    strategy: strategy ?? buildStrategy(resolvedDecision, seedText),
    ...(sourceConversationTitle ? { sourceConversationTitle } : {}),
  };
}

function demoDecision(text: string): SalesDecision {
  return { ...judgeCustomerMessage(text), source: "demo" };
}

function restoreCustomers(saved: ReturnType<typeof loadWorkspace>): CustomerConversation[] {
  if (Array.isArray(saved?.customers)) {
    const valid = saved.customers.filter((item) => item?.profile?.id && item.profile.name && Array.isArray(item.messages) && item.decision && item.strategy);
    if (valid.length > 0) return valid;
    if (saved.customers.length === 0) return [];
  }
  if (Array.isArray(saved?.messages) && saved.messages.length > 0) {
    return [createCustomerConversation(demoCustomer, saved.messages, saved.decision, saved.strategy)];
  }
  const decision = demoDecision(demoMessages[0].text);
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

function CustomerManagementDialog({
  customers,
  selectedCustomerId,
  onClose,
  onSelect,
  onAdd,
  onRemove,
}: {
  customers: CustomerConversation[];
  selectedCustomerId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (customer: CustomerConversation) => void;
}) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="customer-dialog customer-management-dialog" role="dialog" aria-modal="true" aria-labelledby="customer-management-title">
      <div className="panel-heading"><div><span className="overline">CUSTOMER MANAGEMENT</span><h2 id="customer-management-title">客户管理 · {customers.length}</h2></div><button className="dialog-close" type="button" aria-label="关闭客户管理" onClick={onClose}>×</button></div>
      <div className="management-toolbar"><span>选择客户查看沟通记录，也可以单独移除客户。</span><button className="primary-button small-button" type="button" onClick={onAdd}><Icon name="plus" size={13} />手动新增</button></div>
      {customers.length ? <div className="management-customer-list">{customers.map((customer) => <div className={`management-customer-row ${customer.profile.id === selectedCustomerId ? "is-active" : ""}`} key={customer.profile.id}>
          <button className="management-customer-select" type="button" aria-pressed={customer.profile.id === selectedCustomerId} onClick={() => onSelect(customer.profile.id)}>
          <span className="customer-avatar">{customer.profile.name.slice(0, 1)}</span><span className="management-customer-copy"><strong>{customer.profile.name}</strong><small>{customer.profile.company || customer.profile.role || "聊天会话 · 资料待补充"}</small></span>{customer.profile.id === selectedCustomerId && <span className="management-selected-label">当前客户</span>}
        </button>
        <button className="management-remove-button" type="button" aria-label={`移除客户 ${customer.profile.name}`} onClick={() => onRemove(customer)}><Icon name="trash" size={13} /><span>移除</span></button>
      </div>)}</div> : <div className="management-empty"><strong>客户列表还是空的</strong><span>手动新增客户，或在微信前台触发会话名单导入。</span></div>}
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
  const sourceLabel = decision.source === "bocha-jev" ? "BOCHA JEV DECISION" : decision.source === "demo" ? "DEMO SAMPLE · NOT A LIVE DECISION" : "SAVED CUSTOMER DECISION";
  const title = decision.source === "bocha-jev" ? "Bocha Jev 客户判断" : decision.source === "demo" ? "演示样例判断" : "历史客户判断";
  return (
    <section className="panel decision-panel">
      <div className="panel-heading"><div><span className="overline">{sourceLabel}</span><h2>{title}</h2></div><span className="confidence"><i />{Math.round(decision.confidence * 100)}% 置信</span></div>
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

function RepliesCard({ strategy, onCopy, onFill, canFill, fillBusy }: { strategy: CustomerStrategy; onCopy: (text: string, id: string) => void; onFill: (text: string) => void; canFill: boolean; fillBusy: boolean }) {
  return (
    <section className="panel replies-panel">
      <div className="panel-heading"><div><span className="overline">REPLY OPTIONS</span><h2>候选回复</h2></div><span className="panel-note">Demo 排序 · 回填不发送</span></div>
      <div className="reply-list">
        {strategy.replies.map((reply, index) => (
          <article className={`reply-card ${index === 0 ? "is-recommended" : ""}`} key={reply.id}>
            <div className="reply-card-head"><span className="reply-index">0{index + 1}</span><strong>{reply.label}</strong>{index === 0 && <span className="recommended">推荐</span>}<span className={`risk risk-${reply.risk}`}>风险{reply.risk}</span></div>
            <p>{reply.text}</p>
            <div className="reply-card-foot"><span>{reply.purpose}</span><div><button onClick={() => onCopy(reply.text, reply.id)}><Icon name="copy" size={13} />复制</button><button type="button" title={canFill ? "只回填到已确认且输入框为空的微信会话，不会发送" : isTauri() ? "请先读取并确认微信会话对象" : "浏览器模式不写回聊天 App；请复制后手动粘贴"} disabled={!canFill || fillBusy} onClick={() => onFill(reply.text)}><Icon name="arrow" size={13} />{fillBusy ? "正在回填…" : isTauri() ? "回填微信" : "网页不写回"}</button></div></div>
          </article>
        ))}
      </div>
      <div className="manual-send-note"><Icon name="shield" size={14} />{canFill ? "当前微信会话已确认；回填只写入输入框，不会发送。" : !isTauri() ? "浏览器模式只读并导入草稿，不写回任何聊天 App。" : "回填暂不可用：请先在上方读取微信，并点击“确认对象并载入”。"}回填后由你检查并手动发送；也可复制粘贴。</div>
    </section>
  );
}

type ProductField = "productName" | "category" | "audience" | "scene" | "platform" | "tone" | "ratio" | "videoDirection";

function ProductOutputPreview({
  output,
  images,
  onCopy,
  copied,
  videoProviderReady,
  videoBusy,
  videoNotice,
  onGenerateVideo,
  onOpenVideoSettings,
}: {
  output?: ProductOutput;
  images: ProductImage[];
  onCopy: (text: string, id: string) => void;
  copied?: string;
  videoProviderReady: boolean;
  videoBusy: boolean;
  videoNotice: string;
  onGenerateVideo: (output: ProductOutput) => void;
  onOpenVideoSettings: () => void;
}) {
  if (!output) {
    return <div className="output-empty"><div className="empty-icon"><Icon name="spark" size={24} /></div><strong>先完成事实卡</strong><span>产品事实确认后，这里会出现可审阅的推荐语、图解草稿、朋友圈短文和 15 秒脚本。</span></div>;
  }
  const hasProductImage = images.some((image) => image.previewUrl);

  return <div className="output-preview">
    <div className="output-preview-head"><div><span className="overline">{productOutputTypeLabel(output.type).toUpperCase()}</span><h3>{output.title}</h3></div><div className="output-actions"><span className={`output-status ${output.stale || output.status === "DRAFT" ? "draft" : "ready"}`}>{output.stale ? "过期" : output.status}</span><button className="text-button" disabled={output.stale} onClick={() => onCopy(outputCopyText(output), `output-${output.id}`)}><Icon name="copy" size={13} />{copied === `output-${output.id}` ? "已复制" : "复制"}</button></div></div>
    {output.stale && <div className="video-generation-status" role="status">这是旧版固定模板生成的过期分镜，已暂停复制和视频生成。重新生成素材包会按当前产品事实创建新脚本。</div>}
    {!output.stale && output.text && <div className="copyable-output"><p>{output.text}</p><small>只使用事实卡中已提供或图中可见的信息；发布前仍需人工核对。</small></div>}
    {!output.stale && output.cards && <div className="diagram-preview"><div className="diagram-note"><Icon name="shield" size={13} />当前是电商图解结构草稿，不代表已经生成最终图片</div><div className="diagram-grid">{output.cards.map((card, index) => { const image = images.find((item) => item.id === card.sourceImageId)?.previewUrl; return <article className="diagram-card" key={card.id}><div className="diagram-image">{image ? <img src={image} alt="已导入产品图" /> : <div className="diagram-placeholder"><Icon name="image" size={21} /><span>待导入产品图</span></div>}<b>0{index + 1}</b></div><div className="diagram-copy"><strong>{card.title}</strong><p>{card.body}</p><small>允许上图文字：{card.allowedText}</small></div></article>; })}</div></div>}
    {!output.stale && output.scenes && <div className="storyboard"><div className="storyboard-note"><Icon name="video" size={13} />总时长 15 秒 · {output.scenes[0]?.time.includes("0—2") ? "按时间顺序生成" : "按分镜脚本生成"} · 人工复核成片</div>{output.scenes.map((scene) => <article className="scene-row" key={scene.id}><time>{scene.time}</time><div><strong>{scene.task}</strong><p>{scene.visual}</p><span>口播：{scene.voiceover}</span><small>字幕：{scene.caption}</small></div></article>)}
      {output.videoGeneration && <div className="video-task-result" role="status"><div><strong>{output.videoGeneration.status === "succeeded" ? "视频已生成" : output.videoGeneration.status === "failed" ? "视频生成失败" : output.videoGeneration.status === "expired" ? "视频任务已过期" : `生成任务：${output.videoGeneration.status === "queued" ? "排队中" : output.videoGeneration.status === "running" ? "生成中" : "状态待确认"}`}</strong><small>任务 ID：{output.videoGeneration.taskId}</small>{output.videoGeneration.error && <p>{output.videoGeneration.error}</p>}</div>{output.videoGeneration.videoUrl && <a href={output.videoGeneration.videoUrl} target="_blank" rel="noreferrer">打开 / 保存（链接 24 小时有效）</a>}{output.videoGeneration.videoUrl && <video className="generated-product-video" controls preload="metadata" src={output.videoGeneration.videoUrl}>浏览器不支持视频预览</video>}</div>}
      {videoNotice && <p className="video-generation-status" role="status">{videoNotice}</p>}
      {!output.stale && <div className="video-generation-actions">{videoProviderReady ? <button type="button" className="primary-button small-button" onClick={() => onGenerateVideo(output)} disabled={videoBusy || !hasProductImage || Boolean(output.videoGeneration && ["queued", "running"].includes(output.videoGeneration.status))}><Icon name="video" size={14} />{videoBusy ? "正在提交…" : output.videoGeneration?.status === "succeeded" ? "重新生成视频" : "按分镜生成 15 秒视频"}</button> : <button type="button" className="text-button" onClick={onOpenVideoSettings}>配置视频模型 API</button>}<small>{videoProviderReady ? hasProductImage ? "使用分镜与真实产品图创建任务，可能产生费用；请检查模型返回的成片。" : "请先上传至少一张真实产品图，再生成产品视频。" : "视频模型尚未接入。连接服务后，由你点击按钮发起生成。"}</small></div>}
    </div>}
  </div>;
}

function ProductMaterialsView({
  workspace,
  selectedOutput,
  copied,
  onUpdateField,
  onUpdateFact,
  onAddFact,
  onConfirmFacts,
  onSubmitIntake,
  onRemoveImage,
  intakeBusy,
  intakeNotice,
  agentServiceLabel,
  localMode,
  onApplyBulkEdit,
  onStartNewProduct,
  onUndoProductSwitch,
  canUndoProductSwitch,
  onGenerate,
  onSelectOutput,
  onCopy,
  videoProviderReady,
  videoBusy,
  videoNotice,
  onGenerateVideo,
  onOpenVideoSettings,
}: {
  workspace: ProductWorkspace;
  selectedOutput?: ProductOutput;
  copied?: string;
  onUpdateField: (field: ProductField, value: string) => void;
  onUpdateFact: (id: string, field: "label" | "value" | "status", value: string) => void;
  onAddFact: () => void;
  onConfirmFacts: () => void;
  onSubmitIntake: (text: string, files: File[]) => Promise<boolean>;
  onRemoveImage: (id: string) => void;
  intakeBusy: boolean;
  intakeNotice: string;
  agentServiceLabel: string;
  localMode: boolean;
  onApplyBulkEdit: (text: string) => string | null;
  onStartNewProduct: () => void;
  onUndoProductSwitch: () => void;
  canUndoProductSwitch: boolean;
  onGenerate: () => void;
  onSelectOutput: (id: string) => void;
  onCopy: (text: string, id: string) => void;
  videoProviderReady: boolean;
  videoBusy: boolean;
  videoNotice: string;
  onGenerateVideo: (outputId: string) => void;
  onOpenVideoSettings: () => void;
}) {
  const [intakeText, setIntakeText] = useState(() => {
    try { return window.localStorage.getItem(PRODUCT_INTAKE_DRAFT_KEY) ?? ""; } catch { return ""; }
  });
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileWarning, setFileWarning] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState("");
  const [pendingProductAction, setPendingProductAction] = useState<"bulk" | "start" | "undo" | null>(null);
  const bulkEditorRef = useRef<HTMLTextAreaElement>(null);
  const productImages = workspace.images.filter((image) => image.source === "local-upload");
  const intakeMessages = workspace.intakeMessages ?? [];
  const confirmedCount = workspace.facts.filter((fact) => fact.status === "provided" || fact.status === "visible").length;

  useEffect(() => {
    try {
      if (intakeText) window.localStorage.setItem(PRODUCT_INTAKE_DRAFT_KEY, intakeText);
      else window.localStorage.removeItem(PRODUCT_INTAKE_DRAFT_KEY);
    } catch {
      // Draft remains available until this tab closes even when browser storage is full.
    }
  }, [intakeText]);

  useEffect(() => {
    if (bulkOpen) bulkEditorRef.current?.focus();
  }, [bulkOpen]);

  function openBulkEditor() {
    setBulkText(formatProductFactsForBulkEdit(workspace));
    setBulkError("");
    setBulkOpen(true);
  }

  function commitBulkEditor() {
    const error = onApplyBulkEdit(bulkText);
    if (error) { setBulkError(error); return; }
    setBulkOpen(false);
    setBulkError("");
  }

  function applyBulkEditor() {
    try {
      const preview = applyProductFactsBulkEdit(workspace, bulkText);
      const replacingProduct = Boolean(workspace.productName.trim()
        && preview.productName.trim().toLocaleLowerCase() !== workspace.productName.trim().toLocaleLowerCase());
      if (replacingProduct) { setPendingProductAction("bulk"); return; }
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : String(error));
      return;
    }
    commitBulkEditor();
  }

  function confirmProductAction() {
    if (pendingProductAction === "bulk") commitBulkEditor();
    else if (pendingProductAction === "start") { onStartNewProduct(); setBulkOpen(false); }
    else if (pendingProductAction === "undo") onUndoProductSwitch();
    setPendingProductAction(null);
  }

  function addFiles(files: FileList | File[]) {
    const selected = Array.from(files).filter((file) => file.type.startsWith("image/"));
    const additions = selected.filter((file) => !selectedFiles.some((existing) => existing.name === file.name && existing.size === file.size));
    const nextFiles = [...selectedFiles, ...additions].slice(0, 8);
    setSelectedFiles(nextFiles);
    setFileWarning(selected.length > 0 && selectedFiles.length + additions.length > 8 ? "单次最多添加 8 张图片。" : "");
  }

  async function submitIntake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!intakeText.trim() && selectedFiles.length === 0) return;
    const form = event.currentTarget;
    if (await onSubmitIntake(intakeText, selectedFiles)) {
      setIntakeText("");
      setSelectedFiles([]);
      setFileWarning("");
      const input = form.querySelector<HTMLInputElement>("input[type=file]");
      if (input) input.value = "";
    }
  }

  return <div className="materials-workspace">
    <section className="materials-hero"><div><span className="overline">PRODUCT SHOWCASE</span><h2>把产品资料变成<span>可发送素材</span></h2><p>先收集事实，再生成推荐语、图解草稿、朋友圈短文和精确 15 秒视频脚本。</p></div><div className="materials-stats"><div><strong>{workspace.facts.length}</strong><span>事实字段</span></div><div><strong>{confirmedCount}</strong><span>可公开事实</span></div><div><strong>{workspace.outputs.length || "—"}</strong><span>输出草稿</span></div></div></section>
    <section className="panel product-intake-panel">
      <div className="panel-heading"><div><span className="overline">{localMode ? "LOCAL INTAKE" : "AGENT INTAKE"}</span><h2>{localMode ? "本机仅收集素材，不做语义识别" : "一次发来，Agent 帮你整理"}</h2></div><span className="panel-note">当前服务：{agentServiceLabel}</span></div>
      <div className="product-chat-history" aria-live="polite">
        {intakeMessages.length === 0 ? <div className="product-chat-empty"><strong>把产品资料像聊天一样发过来</strong><span>可以一次粘贴产品说明，并同时选择多张手机拍摄的产品图。</span></div> : intakeMessages.map((message, index) => <article className={`product-chat-message ${message.role}`} key={message.id}>
          <span className="product-chat-role">{message.role === "user" ? "你提供的素材" : localMode ? "本机预整理" : "Agent 整理"}</span>
          {message.text && <p>{message.text}</p>}
          {message.attachmentIds?.length ? <div className="product-chat-attachments">{message.attachmentIds.map((id) => { const image = productImages.find((item) => item.id === id); return image?.previewUrl ? <img key={id} src={image.previewUrl} alt={image.name} title={image.name} /> : null; })}</div> : null}
          {message.role === "assistant" && index === intakeMessages.length - 1 && <div className="product-result-actions"><button type="button" className="primary-button small-button" onClick={onConfirmFacts} disabled={!hasConfirmableProductFacts(workspace)}><Icon name="check" size={13} />一键确认整理结果</button><button type="button" className="text-button product-result-edit" onClick={openBulkEditor}><Icon name="edit" size={13} />整块修改事实卡</button></div>}
        </article>)}
      </div>
      <form className="product-intake-form" onSubmit={(event) => void submitIntake(event)}>
        <textarea value={intakeText} onChange={(event) => setIntakeText(event.currentTarget.value)} placeholder="粘贴产品介绍、参数、价格、目标客户、销售场景……不必预先拆成字段" rows={4} />
        {selectedFiles.length > 0 && <div className="product-pending-files">{selectedFiles.map((file, index) => <span className="product-file-chip" key={`${file.name}-${file.size}-${index}`}><Icon name="image" size={13} />{file.name}<button type="button" aria-label={`移除图片 ${file.name}`} onClick={() => setSelectedFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></span>)}</div>}
        {fileWarning && <small className="product-intake-warning">{fileWarning}</small>}
        <div className="product-intake-toolbar"><input id="product-intake-images" className="visually-hidden" type="file" accept="image/*" multiple onChange={(event) => { if (event.currentTarget.files) addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} /><label className="text-button product-attach-button" htmlFor="product-intake-images"><Icon name="image" size={14} />添加多张图片</label><span>每轮最多 8 张</span><button className="primary-button small-button" type="submit" disabled={intakeBusy || (!intakeText.trim() && selectedFiles.length === 0)}><Icon name="spark" size={14} />{intakeBusy ? (localMode ? "本机预整理中…" : "Agent 整理中…") : (localMode ? "本机预整理" : "交给 Agent 整理")}</button></div>
        <div className="product-intake-disclosure"><Icon name="shield" size={13} /><span>{localMode ? "本机 Demo 只保留原文与图片，并机械提取明确的「标签：内容」；不做语义归纳或图片识别。要智能整理，请在模型配置中接入支持图片输入的 Agent。" : `点击整理后，本轮文字和压缩图片会发送到「${agentServiceLabel}」；请使用支持图片输入的模型。不会自动发送给客户。`}</span></div>
      </form>
      {intakeNotice && <div className="product-intake-status" role="status">{intakeNotice}</div>}
    </section>
    <div className="materials-grid">
      <section className="panel fact-panel"><div className="panel-heading"><div><span className="overline">FACT CARD</span><h2>产品事实卡</h2></div><span className={`review-badge ${workspace.status === "READY_FOR_REVIEW" ? "ready" : "needs-review"}`}>{workspace.status === "READY_FOR_REVIEW" ? "待审阅" : "收集中"}</span></div>
        <div className="product-quick-actions"><div><strong>{workspace.productName || "尚未命名产品"}</strong><small>整块修改名称、场景与卖点；不用逐行点改。</small></div><button type="button" className="primary-button small-button" onClick={openBulkEditor}>批量编辑 / 替换</button><button type="button" className="text-button" onClick={() => setPendingProductAction("start")} disabled={bulkOpen}>开始新产品</button>{canUndoProductSwitch && <button type="button" className="text-button" onClick={() => setPendingProductAction("undo")} disabled={bulkOpen}>撤销上次替换</button>}</div>
        {bulkOpen && <div className="product-bulk-editor"><div className="product-bulk-heading"><strong>整块编辑产品事实</strong><span>每行「标签：内容」；粘贴新产品资料可一次替换。修改后均需核对。</span></div><textarea ref={bulkEditorRef} aria-label="批量编辑产品事实" value={bulkText} onChange={(event) => setBulkText(event.currentTarget.value)} rows={12} spellCheck={false} placeholder={"产品名称：便携咖啡机\n品类：小家电\n使用场景：出差\n\n价格：999 元\n卖点：轻巧便携"} />{bulkError && <div className="product-bulk-error" role="alert">{bulkError}</div>}<div className="product-bulk-actions"><small>整块应用会替换事实卡；若产品名称改变，旧图片与草稿会在确认后移出当前工作区。</small><button type="button" className="text-button" onClick={() => setBulkOpen(false)}>取消</button><button type="button" className="primary-button small-button" onClick={applyBulkEditor}>应用整块修改</button></div></div>}
        <div className="fact-form"><label><span>产品名称</span><input value={workspace.productName} onChange={(event) => onUpdateField("productName", event.currentTarget.value)} placeholder="Agent 整理后自动填入" /></label><label><span>品类</span><input value={workspace.category} onChange={(event) => onUpdateField("category", event.currentTarget.value)} placeholder="Agent 整理后自动填入" /></label><label><span>目标人群</span><input value={workspace.audience} onChange={(event) => onUpdateField("audience", event.currentTarget.value)} placeholder="未提供时留空" /></label><label><span>使用场景</span><input value={workspace.scene} onChange={(event) => onUpdateField("scene", event.currentTarget.value)} placeholder="未提供时留空" /></label><div className="form-selects"><label><span>发布平台</span><select value={workspace.platform} onChange={(event) => onUpdateField("platform", event.currentTarget.value)}><option>朋友圈</option><option>小红书</option><option>视频号</option></select></label><label><span>文案口吻</span><select value={workspace.tone} onChange={(event) => onUpdateField("tone", event.currentTarget.value)}><option>专业种草</option><option>亲切日常</option><option>活泼有趣</option></select></label></div><div className="form-selects"><label><span>图片比例</span><select value={workspace.ratio} onChange={(event) => onUpdateField("ratio", event.currentTarget.value)}><option>3:4</option><option>4:5</option><option>9:16</option></select></label><label><span>视频方向</span><select value={workspace.videoDirection} onChange={(event) => onUpdateField("videoDirection", event.currentTarget.value)}><option>竖版 9:16 · 15 秒</option><option>横版 16:9 · 15 秒</option></select></label></div></div>
        {productImages.length > 0 && <div className="asset-upload"><div className="asset-upload-head"><div><span className="overline">PRODUCT IMAGES</span><strong>已收集图片</strong></div><span>{productImages.length} 张 · 本机保存</span></div><div className="product-image-grid">{productImages.map((image) => <figure key={image.id}><img src={image.previewUrl} alt={image.name} /><figcaption title={image.name}>{image.name}</figcaption><button type="button" aria-label={`移除产品图片 ${image.name}`} onClick={() => onRemoveImage(image.id)}>×</button></figure>)}</div></div>}
        <div className="facts-editor"><div className="facts-editor-head"><div><span className="overline">EVIDENCE STATUS</span><strong>整理结果 · 可直接修改</strong></div><div className="fact-editor-actions"><button className="text-button" onClick={onAddFact}><Icon name="plus" size={13} />补充事实</button><button className="text-button" onClick={onConfirmFacts} disabled={!hasConfirmableProductFacts(workspace)}><Icon name="check" size={13} />一键确认文字与可见信息</button></div></div>{workspace.facts.map((fact) => <div className="fact-row" key={fact.id}><input className="fact-label" value={fact.label} onChange={(event) => onUpdateFact(fact.id, "label", event.currentTarget.value)} placeholder="维度" /><input className="fact-value" value={fact.value} onChange={(event) => onUpdateFact(fact.id, "value", event.currentTarget.value)} placeholder="事实内容" /><select value={fact.status} onChange={(event) => onUpdateFact(fact.id, "status", event.currentTarget.value)}><option value="provided">已提供</option><option value="visible">图中可见</option><option value="pending">待确认</option><option value="missing">未获取</option></select><span className={`fact-status-dot fact-${fact.status}`} title={productFactStatusLabel(fact.status)} /></div>)}<div className="fact-boundary"><Icon name="shield" size={13} /><span>有证据的产品名称、品类、人群、场景与卖点会自动回填；字段可直接改字或整块粘贴。点击“一键确认”只确认用户文字及图中可见信息，证据不明确的内容仍待核实。</span></div></div>
        <button className="primary-button generate-material-button" onClick={onGenerate} disabled={confirmedCount === 0}><Icon name="spark" size={14} />{confirmedCount === 0 ? "先核对并确认事实" : "生成素材包草稿"}</button>
      </section>
      <section className="panel outputs-panel"><div className="panel-heading"><div><span className="overline">OUTPUTS</span><h2>素材输出</h2></div><span className="panel-note">人工审阅后再发布</span></div><div className="output-tabs">{workspace.outputs.map((output) => <button key={output.id} className={selectedOutput?.id === output.id ? "is-active" : ""} onClick={() => onSelectOutput(output.id)}><span>{productOutputTypeLabel(output.type)}</span><small>{output.stale ? "过期，需重生" : output.status === "DRAFT" ? "草稿" : "待审阅"}</small></button>)}</div><ProductOutputPreview output={selectedOutput} images={productImages} onCopy={onCopy} copied={copied} videoProviderReady={videoProviderReady} videoBusy={videoBusy} videoNotice={videoNotice} onGenerateVideo={(output) => onGenerateVideo(output.id)} onOpenVideoSettings={onOpenVideoSettings} /></section>
    </div>
    {pendingProductAction && <div className="modal-backdrop" role="presentation"><section className="customer-dialog product-switch-dialog" role="dialog" aria-modal="true" aria-labelledby="product-switch-title"><div className="panel-heading"><div><span className="overline">PRODUCT SWITCH</span><h2 id="product-switch-title">{pendingProductAction === "undo" ? "恢复上一版产品" : "替换当前产品？"}</h2></div><button type="button" className="dialog-close" aria-label="取消产品切换" onClick={() => setPendingProductAction(null)}>×</button></div><div className="product-switch-content"><p>{pendingProductAction === "bulk" ? `将「${workspace.productName || "未命名产品"}」替换为新填写的产品。` : pendingProductAction === "start" ? `将当前「${workspace.productName || "未命名产品"}」移出工作区，开始空白产品。` : "恢复上一版产品事实卡、图片与草稿；当前内容会被替换。"}</p><small>事实、图片和输出草稿会一起切换。本次运行可以使用“撤销上次替换”恢复上一版。</small><div className="dialog-actions"><button type="button" className="text-button" onClick={() => setPendingProductAction(null)}>取消</button><button type="button" className="primary-button small-button" onClick={confirmProductAction}>确认切换</button></div></div></section></div>}
  </div>;
}

function ReviewView({ records, selectedId, copied, onSelect, onMarkReviewed, onCopy }: { records: ReviewRecord[]; selectedId?: string; copied?: string; onSelect: (id: string) => void; onMarkReviewed: (id: string) => void; onCopy: (text: string, id: string) => void }) {
  const selected = records.find((record) => record.id === selectedId) ?? records[0];
  const pendingCount = records.filter((record) => record.status === "待复盘").length;
  const reviewedCount = records.filter((record) => record.status === "已复盘").length;
  const highRiskCount = records.filter((record) => record.decision.commercialRisk >= 6).length;

  return <div className="review-workspace"><section className="review-hero"><div><span className="overline">COMMUNICATION REVIEW</span><h2>把一次沟通，变成<span>下一次能力</span></h2><p>回看客户判断、销售动作和事实缺口，只沉淀可复用的规则，不把一次偶然回复当成经验。</p></div><div className="review-stats"><div><strong>{pendingCount}</strong><span>待复盘</span></div><div><strong>{reviewedCount}</strong><span>已沉淀</span></div><div><strong>{highRiskCount}</strong><span>高风险</span></div></div></section><div className="review-grid"><section className="panel review-list-panel"><div className="panel-heading"><div><span className="overline">SESSIONS</span><h2>沟通记录列表</h2></div><span className="panel-note">{records.length} 条 · 本机自动保存</span></div><div className="review-list">{records.length === 0 ? <div className="review-empty">完成一次策略分析后，记录会自动进入此列表。</div> : records.map((record) => <button key={record.id} className={`review-list-item ${selected?.id === record.id ? "is-active" : ""}`} onClick={() => onSelect(record.id)}><div className="review-list-top"><strong>{record.customer.name} · {record.customer.company || "聊天会话"}</strong><span className={record.status === "已复盘" ? "reviewed-label" : "pending-label"}>{record.status}</span></div><p>{record.messages.filter((message) => (message.sender === "customer" || message.sender === "transcript")).at(-1)?.text}</p><div><span>{decisionLabel(record.decision.intent)}</span><span>风险 {record.decision.commercialRisk}/9</span><time>{formatTime(record.createdAt)}</time></div></button>)}</div></section><section className="panel review-detail-panel">{selected ? <><div className="panel-heading"><div className="contact-heading"><div className="customer-avatar large-avatar">{selected.customer.name.slice(0, 1)}</div><div><span className="overline">REVIEW DETAIL</span><h2>{selected.customer.name}</h2><p>{[selected.customer.company, selected.customer.role].filter(Boolean).join(" · ") || "资料待补充"}</p></div></div><span className={`review-badge ${selected.status === "已复盘" ? "ready" : "needs-review"}`}>{selected.status}</span></div><div className="review-timeline"><span className="overline">CONVERSATION SNAPSHOT</span>{selected.messages.slice(-4).map((message) => <MessageBubble key={message.id} message={message} customerName={selected.customer.name} />)}</div><div className="review-judgment"><div><span>{selected.decision.source === "bocha-jev" ? "Bocha Jev 销售判断" : selected.decision.source === "demo" ? "演示样例判断" : "历史销售判断"}</span><strong>{decisionLabel(selected.decision.intent)}</strong><small>{decisionLabel(selected.decision.stage)} · {Math.round(selected.decision.confidence * 100)}% 置信</small></div><div><span>Agent 下一步</span><strong>{selected.strategy.singleNextMove}</strong><small>{selected.strategy.humanConfirmationRequired ? "需要人工确认" : "可先准备"}</small></div></div><div className="review-insight"><span className="overline">INSIGHT</span><h3>{selected.insight}</h3><p><strong>可复用规则：</strong>{selected.reusableRule}</p><div className="review-avoid"><span>本轮不要做</span><strong>{selected.strategy.stopCondition}</strong></div></div><div className="review-detail-actions"><button className="text-button" onClick={() => onCopy(selected.strategy.replies[0]?.text ?? "", `review-${selected.id}`)}><Icon name="copy" size={13} />{copied === `review-${selected.id}` ? "已复制推荐回复" : "复制推荐回复"}</button><button className="primary-button small-button" onClick={() => onMarkReviewed(selected.id)} disabled={selected.status === "已复盘"}><Icon name="check" size={14} />{selected.status === "已复盘" ? "已沉淀规则" : "标记为已复盘"}</button></div></> : <div className="review-empty">暂无可复盘记录。</div>}</section></div></div>;
}

function App() {
  const [initialProviderPreferences] = useState(loadProviderPreferences);
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
  const customersRef = useRef(customers);
  const wechatOperationInProgress = useRef(false);
  const wechatPollingInProgress = useRef(false);
  const wechatWasFrontmost = useRef(false);
  const screenCaptureNoticeShown = useRef(false);
  const lastAutomaticScan = useRef("");
  const lastAutomaticDraft = useRef("");
  const [selectedCustomerId, setSelectedCustomerId] = useState(initialWorkspace.selectedCustomerId);
  const selectedCustomerIdRef = useRef(selectedCustomerId);
  const [draft, setDraft] = useState("");
  const [draftSource, setDraftSource] = useState<"manual" | "wechat">("manual");
  const draftRef = useRef(draft);
  const selectedConversation = useMemo(() => customers.find((item) => item.profile.id === selectedCustomerId), [customers, selectedCustomerId]);
  const messages = selectedConversation?.messages ?? [];
  const decision = selectedConversation?.decision ?? demoDecision("");
  const strategy = selectedConversation?.strategy ?? buildStrategy(decision, "");
  const [productWorkspace, setProductWorkspace] = useState<ProductWorkspace>(() => normalizeProductWorkspace(savedWorkspace?.productWorkspace ?? defaultProductWorkspace));
  const [previousProductWorkspace, setPreviousProductWorkspace] = useState<ProductWorkspace | null>(null);
  const [productIntakeBusy, setProductIntakeBusy] = useState(false);
  const [productIntakeNotice, setProductIntakeNotice] = useState("");
  const productIntakeInProgress = useRef(false);
  const [reviewRecords, setReviewRecords] = useState<ReviewRecord[]>(() => {
    if (savedWorkspace?.reviewRecords) return savedWorkspace.reviewRecords;
    return initialWorkspace.customers
      .filter((item) => item.profile.id !== demoCustomer.id && item.messages.length > 0 && item.decision.source !== "demo")
      .map((item) => makeReviewRecord(item.profile, item.messages, item.decision, item.strategy))
      .slice(0, 12);
  });
  const [selectedReviewId, setSelectedReviewId] = useState<string | undefined>(savedWorkspace?.selectedReviewId);
  const [assetQueued, setAssetQueued] = useState(false);
  const [notice, setNotice] = useState(isTauri() ? "等待微信进入前台；识别仅在本机进行，生成策略前仍需配置并授权 Bocha Jev" : "网页模式可逐次共享聊天窗口并在本机 OCR；不会自动操作聊天 App 或调用外部服务。");
  const [copied, setCopied] = useState<string>();
  const [wechatBusy, setWechatBusy] = useState(false);
  const [wechatWindowTitle, setWechatWindowTitle] = useState("");
  const [wechatConversationTitle, setWechatConversationTitle] = useState("");
  const [pendingWeChatScan, setPendingWeChatScan] = useState<PendingWeChatScan>();
  const pendingWeChatScanRef = useRef<PendingWeChatScan | undefined>(undefined);
  const confirmedWeChatAnchor = useRef<PendingWeChatScan | undefined>(undefined);
  const [wechatFillBusy, setWechatFillBusy] = useState(false);
  const [wechatStatus, setWechatStatus] = useState(isTauri() ? "等待微信成为前台窗口" : "浏览器本机模式：等待你选择共享窗口");
  const [browserScreenReaderMode, setBrowserScreenReaderMode] = useState<"conversation" | "customers">();
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [customerManagementOpen, setCustomerManagementOpen] = useState(false);
  const [customerRemovalPending, setCustomerRemovalPending] = useState<CustomerConversation>();
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const analysisInProgress = useRef(false);
  const [agentMode, setAgentMode] = useState<AgentMode>(initialProviderPreferences.agentMode);
  const [shareWithProviders, setShareWithProviders] = useState(false);
  const [agentProfiles, setAgentProfiles] = useState(initialProviderPreferences.agentProfiles);
  const [draftAgentMode, setDraftAgentMode] = useState<AgentMode>(initialProviderPreferences.agentMode);
  const [draftAgentProfiles, setDraftAgentProfiles] = useState(initialProviderPreferences.agentProfiles);
  const [videoProvider, setVideoProvider] = useState(initialProviderPreferences.videoProvider);
  const [videoModel, setVideoModel] = useState(initialProviderPreferences.videoModel);
  const [draftVideoProvider, setDraftVideoProvider] = useState(initialProviderPreferences.videoProvider);
  const [draftVideoModel, setDraftVideoModel] = useState(initialProviderPreferences.videoModel);
  const [videoApiKey, setVideoApiKey] = useState("");
  const [draftVideoApiKey, setDraftVideoApiKey] = useState("");
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoStatus, setVideoStatus] = useState("");
  const [videoProviderCheck, setVideoProviderCheck] = useState("");
  const [videoAvailableModels, setVideoAvailableModels] = useState<string[]>([]);
  const videoPollBusy = useRef(false);
  const [draftShareWithProviders, setDraftShareWithProviders] = useState(false);
  const [draftAgentApiKey, setDraftAgentApiKey] = useState("");
  const [draftBochaJevApiKey, setDraftBochaJevApiKey] = useState("");
  const [draftBochaJevConsent, setDraftBochaJevConsent] = useState(false);
  const agentEndpoint = agentProfiles[agentMode].endpoint;
  const agentModel = agentProfiles[agentMode].model;
  const draftAgentEndpoint = draftAgentProfiles[draftAgentMode].endpoint;
  const draftAgentModel = draftAgentProfiles[draftAgentMode].model;
  const [agentApiKey, setAgentApiKey] = useState("");
  const [providerCheck, setProviderCheck] = useState("");
  const [agentAvailableModels, setAgentAvailableModels] = useState<string[]>([]);
  const [bochaJevApiKey, setBochaJevApiKey] = useState("");
  const [bochaJevConsent, setBochaJevConsent] = useState(false);
  const [bochaJevCheck, setBochaJevCheck] = useState("");

  const cloudProviderSelected = ["openai", "openrouter-free", "custom"].includes(agentMode);
  const draftCloudProviderSelected = ["openai", "openrouter-free", "custom"].includes(draftAgentMode);
  const agentServiceDescription: Record<AgentMode, { name: string; endpoint: string; note: string }> = {
    demo: { name: "本机 Demo", endpoint: "不连接外部服务", note: "用于演示策略流程，不调用云端模型。" },
    ollama: { name: "本机 Ollama", endpoint: draftAgentEndpoint, note: "策略请求发往本机 Ollama 服务。" },
    "openrouter-free": { name: "OpenRouter 免费路由", endpoint: draftAgentEndpoint, note: "需要 OpenRouter API Key；由免费路由选择可用模型。" },
    openai: { name: "OpenAI API", endpoint: draftAgentEndpoint, note: "使用 OpenAI 模型目录中的模型 ID。" },
    custom: { name: "自定义 OpenAI-compatible", endpoint: draftAgentEndpoint, note: "填写兼容 Chat Completions 的服务地址和模型 ID。" },
  };
  const productAgentServiceLabel = agentMode === "demo"
    ? "本机文字预整理（不识别图片）"
    : `${agentServiceDescription[agentMode].name} · ${agentModel || "模型未设置"}`;
  const localProductMode = shouldUseLocalProductIntake(isTauri(), agentMode);

  const conversationCount = useMemo(() => messages.filter((item) => item.sender === "customer" || item.sender === "transcript").length, [messages]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = saveWorkspace({ customers, selectedCustomerId, productWorkspace, reviewRecords, selectedReviewId });
      if (!saved) setNotice("本机存储空间不足，最近修改未能保存；可移除较大的产品图片后重试");
    }, 250);
    return () => window.clearTimeout(timer);
  }, [customers, selectedCustomerId, productWorkspace, reviewRecords, selectedReviewId]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  function updateCustomers(update: (current: CustomerConversation[]) => CustomerConversation[]) {
    const next = update(customersRef.current);
    customersRef.current = next;
    setCustomers(next);
  }

  function updateSelectedCustomerId(id: string) {
    selectedCustomerIdRef.current = id;
    setSelectedCustomerId(id);
  }

  function updatePendingWeChatScan(
    next: PendingWeChatScan | undefined | ((current: PendingWeChatScan | undefined) => PendingWeChatScan | undefined),
  ) {
    const value = typeof next === "function" ? next(pendingWeChatScanRef.current) : next;
    pendingWeChatScanRef.current = value;
    setPendingWeChatScan(value);
  }

  function openProviderDialog() {
    setDraftAgentMode(agentMode);
    setDraftAgentProfiles(agentProfiles);
    setDraftShareWithProviders(shareWithProviders);
    setDraftAgentApiKey(agentApiKey);
    setDraftBochaJevApiKey(bochaJevApiKey);
    setDraftBochaJevConsent(bochaJevConsent);
    setDraftVideoProvider(videoProvider);
    setDraftVideoModel(videoModel);
    setDraftVideoApiKey(videoApiKey);
    setProviderDialogOpen(true);
  }

  function confirmProviderSettings() {
    setAgentMode(draftAgentMode);
    setAgentProfiles(draftAgentProfiles);
    setShareWithProviders(draftShareWithProviders);
    setAgentApiKey(draftAgentApiKey);
    setBochaJevApiKey(draftBochaJevApiKey);
    setBochaJevConsent(draftBochaJevConsent);
    setVideoProvider(draftVideoProvider);
    setVideoModel(draftVideoModel.trim() || DEFAULT_VIDEO_MODEL);
    setVideoApiKey(draftVideoApiKey);
    saveProviderPreferences({ agentMode: draftAgentMode, agentProfiles: draftAgentProfiles, videoProvider: draftVideoProvider, videoModel: draftVideoModel.trim() || DEFAULT_VIDEO_MODEL });
    setProviderDialogOpen(false);
    setNotice("模型与服务设置已确认并应用；Agent、Bocha Jev 与视频 API Key 均仅在本次运行内存中保留。");
  }

  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    const timer = window.setInterval(() => {
      if (stopped || wechatPollingInProgress.current || wechatOperationInProgress.current || analysisInProgress.current) return;
      wechatPollingInProgress.current = true;
      void (async () => {
        try {
          const captureAllowed = await invoke<boolean>("has_screen_capture_access");
          if (!captureAllowed) {
            setWechatStatus("等待当前构建获得屏幕录制权限");
            if (!screenCaptureNoticeShown.current) {
              setNotice("当前应用尚未通过 macOS 屏幕录制权限预检。请确认已为正在运行的 Jev 销售副驾授权，并在授权后退出重开应用。");
              screenCaptureNoticeShown.current = true;
            }
            return;
          }
          screenCaptureNoticeShown.current = false;
          const isFrontmost = await invoke<boolean>("is_wechat_frontmost");
          if (!isFrontmost) {
            wechatWasFrontmost.current = false;
            setWechatStatus("录屏权限已就绪；等待微信成为前台窗口");
            return;
          }
          wechatWasFrontmost.current = true;
          const currentDraft = draftRef.current.trim();
          if (currentDraft && currentDraft !== lastAutomaticDraft.current) {
            setWechatStatus("微信已在前台；输入框有手动草稿，已暂停自动回填识别结果");
            return;
          }
          await readWeChatConversation(true);
        } catch (error) {
          setWechatStatus("微信窗口检测失败");
          setNotice(`自动检测微信失败：${String(error)}；可点击“重新读取当前会话”重试。`);
        } finally {
          wechatPollingInProgress.current = false;
        }
      })();
    }, 1500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

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
    if (!text || analysisInProgress.current) return false;
    const conversation = targetConversation ?? selectedConversation;
    if (!conversation) {
      setNotice("请先新增或选择客户，再分析这段聊天。");
      return false;
    }
    const parsedWeChat = source === "wechat" || !isTauri()
      ? (source === "wechat" ? parseLabeledWeChatTranscript(text) : parseBrowserTranscript(text)).map((message) => ({
          speaker: message.sender === "transcript" ? "unknown" as const : message.sender,
          text: message.text,
        }))
      : [];
    if (!isTauri()) {
      const imported = appendBrowserTranscript(conversation.messages, text);
      if (!imported) {
        setNotice("没有找到客户发言。本地演示不会把销售单方面发言当成客户需求；请粘贴“客户：…”对话，或直接输入客户原话。");
        return false;
      }
      const touchedProfile = { ...conversation.profile, lastTouched: `今天 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date())}` };
      const decision: SalesDecision = { ...demoDecision(imported.latestCustomerText), source: "demo" };
      const nextStrategy = buildStrategy(decision, imported.latestCustomerText);
      updateCustomers((current) => current.map((item) => item.profile.id === conversation.profile.id
        ? { ...item, profile: touchedProfile, messages: imported.messages, decision, strategy: nextStrategy }
        : item));
      updateSelectedCustomerId(conversation.profile.id);
      const reviewRecord = makeReviewRecord(touchedProfile, imported.messages, decision, nextStrategy);
      setReviewRecords((current) => [reviewRecord, ...current].slice(0, 12));
      setSelectedReviewId(reviewRecord.id);
      setDraft("");
      setDraftSource("manual");
      setAssetQueued(false);
      setNotice(`浏览器本地演示完成：${imported.messages.length - conversation.messages.length} 条消息已归入「${conversation.profile.name}」，并生成演示判断和复盘。未连接微信、Bocha Jev 或外部 Agent。`);
      return true;
    }
    if (!bochaJevConsent) {
      setNotice("请先在模型与服务配置中授权向 Bocha Jev 发送本轮对话，再生成判断。");
      openProviderDialog();
      return false;
    }
    if (source === "wechat" && !parsedWeChat.some((message) => message.speaker === "customer")) {
      setNotice("当前识别预览没有可靠判定为客户发送的消息；本轮未发给 Bocha Jev。请重读或手动整理客户原话。");
      return false;
    }
    const appendedMessages = source === "wechat"
      ? parsedWeChat.map((message) => createCustomerMessage(message.text, message.speaker === "unknown" ? "transcript" : message.speaker))
      : [createCustomerMessage(text, "customer")];
    const nextMessages = [...conversation.messages, ...appendedMessages];
    const state = nextMessages.slice(-6).map((message) => {
      const speaker = message.sender === "customer" ? "客户" : message.sender === "seller" ? "销售" : "微信 OCR（发言人未确认）";
      return `${speaker}：${message.text}`;
    }).join("\n");
    if (Array.from(state).length > 300) {
      setNotice("发给 Bocha Jev 的最近对话超过 300 个字符；请先整理成更短的摘要。本轮没有发送数据。");
      return false;
    }
    const useLocalStrategy = agentMode === "demo" || (cloudProviderSelected && !shareWithProviders);
    if (!useLocalStrategy && (!agentModel.trim() || (agentMode !== "ollama" && !agentApiKey.trim()))) {
      setNotice("请先填写 Agent 模型名和所需 API Key；本机 Ollama 不需要 Key。本轮尚未调用 Bocha Jev。");
      return false;
    }
    const strategyText = source === "wechat"
      ? [...parsedWeChat].reverse().find((message) => message.speaker === "customer")?.text ?? text
      : text;
    analysisInProgress.current = true;
    setAnalysisBusy(true);
    try {
    let nextDecision: SalesDecision;
    let nextStrategy: CustomerStrategy;
    try {
      const decision = await invoke<SalesDecision>("bocha_jev_decide", { state, apiKey: bochaJevApiKey });
      nextDecision = { ...decision, source: "bocha-jev" };
    } catch (error) {
      setNotice(`Bocha Jev 判断失败；未回退到本地规则，也未生成策略：${String(error)}`);
      return false;
    }
    if (!useLocalStrategy) {
      try {
        nextStrategy = await invoke<CustomerStrategy>("agent_strategy", {
          text: strategyText,
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
      nextStrategy = await demoStrategyProvider.generate({ decision: nextDecision, latestMessage: strategyText });
    }
    const touchedProfile = { ...conversation.profile, lastTouched: `今天 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date())}` };
    updateCustomers((current) => current.map((item) => item.profile.id === conversation.profile.id
      ? { ...item, profile: touchedProfile, messages: nextMessages, decision: nextDecision, strategy: nextStrategy }
      : item));
    updateSelectedCustomerId(conversation.profile.id);
    const reviewRecord = makeReviewRecord(touchedProfile, nextMessages, nextDecision, nextStrategy);
    setReviewRecords((current) => [reviewRecord, ...current].slice(0, 12));
    setSelectedReviewId(reviewRecord.id);
    setDraft("");
    setDraftSource("manual");
    setAssetQueued(false);
    setNotice(useLocalStrategy && cloudProviderSelected
      ? "Bocha Jev 判断已完成；本轮未同意向云端 Agent 发送内容，策略由本机 Demo 生成。请审阅候选回复后再回填"
      : `Bocha Jev 判断已完成；Agent：${agentMode === "demo" ? "本机 Demo" : agentMode === "ollama" ? "本机 Ollama" : "云端模型"}。请审阅候选回复后再回填`);
    return true;
    } finally {
      analysisInProgress.current = false;
      setAnalysisBusy(false);
    }
  }

  async function generateStrategy() {
    await analyzeText(draft, draftSource);
  }

  function selectCustomer(id: string) {
    if (id !== selectedCustomerIdRef.current) confirmedWeChatAnchor.current = undefined;
    updateSelectedCustomerId(id);
    updatePendingWeChatScan((pending) => pending ? { ...pending, customerId: id || undefined } : pending);
    draftRef.current = "";
    setDraft("");
    setDraftSource("manual");
    lastAutomaticDraft.current = "";
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
    confirmedWeChatAnchor.current = undefined;
    const conversation = createCustomerConversation(profile);
    updateCustomers((current) => [...current, conversation]);
    updateSelectedCustomerId(profile.id);
    updatePendingWeChatScan((pending) => pending && normalizeWeChatCustomerName(pending.title ?? "") === normalizeWeChatCustomerName(name)
      ? { ...pending, customerId: profile.id }
      : pending);
    draftRef.current = "";
    setDraft("");
    setDraftSource("manual");
    lastAutomaticDraft.current = "";
    setMode("sales");
    setCustomerDialogOpen(false);
    setNotice(`已新增客户「${name}」，可粘贴聊天或从已接入的聊天窗口读取。`);
  }

  function importBrowserOcrTranscript(customerId: string | undefined, transcript: string, newCustomerName?: string) {
    let targetCustomerId = customerId;
    let customer = targetCustomerId ? customersRef.current.find((item) => item.profile.id === targetCustomerId) : undefined;
    const title = newCustomerName?.trim();
    if (!customer && !targetCustomerId && title) {
      const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date());
      const profile: CustomerProfile = {
        id: `screen-customer-${crypto.randomUUID()}`,
        name: title,
        company: "",
        role: "",
        stage: "new_lead",
        lastTouched: `今天 ${time}`,
        note: "客户名称由用户核对的企业微信或其他聊天窗口标题确认；聊天内容仍待分析。",
      };
      const newConversation = createCustomerConversation(profile, [], undefined, undefined, title);
      customer = newConversation;
      updateCustomers((current) => [...current, newConversation]);
      targetCustomerId = customer.profile.id;
    }
    if (!customer) {
      setNotice("客户归属未确认或客户已不存在；请重新识别或选择客户后导入。");
      return;
    }
    confirmedWeChatAnchor.current = undefined;
    updateSelectedCustomerId(targetCustomerId!);
    draftRef.current = transcript;
    setDraft(transcript);
    setDraftSource("wechat");
    lastAutomaticDraft.current = "";
    setMode("sales");
    setNotice(`已把核对后的屏幕 OCR 文本载入「${customer.profile.name}」的草稿；还没有写入客户消息或发送给模型。`);
  }

  function importBrowserOcrCustomers(names: string[]): number {
    const current = customersRef.current;
    const candidates = collectNewWeChatCustomerNames(names, current, WECHAT_IMPORT_LIMIT);
    if (!candidates.length) return 0;
    const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date());
    const additions = candidates.map((name) => {
      const profile: CustomerProfile = {
        id: `screen-customer-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        name,
        company: "",
        role: "",
        stage: "new_lead",
        lastTouched: `今天 ${time}`,
        note: "来自用户选定窗口的本机 OCR；客户/单聊身份待核对。",
      };
      return createCustomerConversation(profile, [], undefined, undefined, name);
    });
    updateCustomers((latest) => [...latest, ...additions]);
    if (!selectedCustomerIdRef.current && additions[0]) updateSelectedCustomerId(additions[0].profile.id);
    setMode("sales");
    setNotice(`已添加 ${additions.length} 位屏幕 OCR 客户候选；请在客户管理中逐项核对是否为单聊。`);
    return additions.length;
  }

  function loadBrowserValidationSample() {
    if (isTauri()) return;
    let sample = customersRef.current.find((item) => item.profile.id === BROWSER_TEST_CUSTOMER_ID);
    if (!sample) {
      const createdAt = new Date().toISOString();
      const profile: CustomerProfile = {
        id: BROWSER_TEST_CUSTOMER_ID,
        name: "网页验证样例（虚构）",
        company: "本地演示数据",
        role: "测试客户",
        stage: "evaluation",
        lastTouched: "网页演示",
        note: "用于验证网页客户切换、消息归属与复盘；不是微信导入的真实客户。",
      };
      const messages: CustomerMessage[] = [
        { id: "browser-sample-message-1", sender: "customer", text: "这款产品适合拍产品图吗？价格大概多少？", createdAt },
        { id: "browser-sample-message-2", sender: "seller", text: "我先按影像表现和预算帮你整理，具体配置与价格以核实后的资料为准。", createdAt },
        { id: "browser-sample-message-3", sender: "customer", text: "麻烦发一份产品介绍和报价信息。", createdAt },
      ];
      const decision = demoDecision(messages.at(-1)!.text);
      sample = createCustomerConversation(profile, messages, decision, buildStrategy(decision, messages.at(-1)!.text));
      updateCustomers((current) => current.some((item) => item.profile.id === BROWSER_TEST_CUSTOMER_ID) ? current : [...current, sample!]);
    }
    confirmedWeChatAnchor.current = undefined;
    updateSelectedCustomerId(BROWSER_TEST_CUSTOMER_ID);
    setDraft("");
    setDraftSource("manual");
    setAssetQueued(false);
    setWechatWindowTitle("");
    setWechatConversationTitle("");
    setWechatStatus("网页测试模式：已选择虚构样例客户");
    setNotice("已打开虚构的网页测试客户和 3 条示例消息（并非微信识别）。你可以切换/新增客户，或粘贴带“客户：”“我：”的聊天，再用本地演示验证归属、角色解析和复盘。");
    setMode("sales");
  }

  function removePendingCustomer() {
    if (!customerRemovalPending) return;
    const removedId = customerRemovalPending.profile.id;
    const remaining = customersRef.current.filter((item) => item.profile.id !== removedId);
    updateCustomers(() => remaining);
    if (selectedCustomerIdRef.current === removedId) {
      confirmedWeChatAnchor.current = undefined;
      updateSelectedCustomerId(remaining[0]?.profile.id ?? "");
      setDraft("");
      setDraftSource("manual");
      setAssetQueued(false);
    }
    setCustomerRemovalPending(undefined);
    setNotice(`已从客户列表移除「${customerRemovalPending.profile.name}」；已生成的沟通复盘快照保留。`);
  }

  function findWeChatCustomer(title: string): CustomerConversation | undefined {
    const normalized = normalizeWeChatCustomerName(title);
    return customersRef.current.find((item) =>
      normalizeWeChatCustomerName(item.sourceConversationTitle ?? item.profile.name) === normalized,
    );
  }

  function ensureWeChatScanCustomer(scan: WeChatScanResult): { customer?: CustomerConversation; created: boolean } {
    const title = scan.conversation_title?.trim();
    if (!title) return { created: false };
    const resolution = resolveWeChatCustomer(title, scan.title_confidence, customersRef.current);
    if (resolution.kind === "matched") {
      return { customer: customersRef.current.find((item) => item.profile.id === resolution.customerId), created: false };
    }
    if (resolution.kind !== "create") return { created: false };
    const existing = findWeChatCustomer(resolution.name);
    if (existing) return { customer: existing, created: false };

    const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date());
    const conversation = createCustomerConversation({
      id: `wechat-${crypto.randomUUID()}`,
      name: resolution.name,
      company: "",
      role: "",
      stage: "new_lead",
      lastTouched: `今天 ${time}`,
      note: "微信会话标题由本机 OCR 高置信识别；聊天内容需核对后载入。",
    }, [], undefined, undefined, resolution.name);
    updateCustomers((current) => current.some((item) =>
      normalizeWeChatCustomerName(item.sourceConversationTitle ?? item.profile.name) === normalizeWeChatCustomerName(resolution.name),
    ) ? current : [...current, conversation]);
    return { customer: findWeChatCustomer(resolution.name), created: true };
  }

  function pendingFromWeChatScan(scan: WeChatScanResult): PendingWeChatScan {
    const title = scan.conversation_title?.trim() || undefined;
    const titleConfidence = scan.title_confidence;
    const resolution = title
      ? resolveWeChatCustomer(title, titleConfidence, customersRef.current)
      : { kind: "review" as const };
    const suggestedCustomer = resolution.kind === "matched"
      ? customersRef.current.find((item) => item.profile.id === resolution.customerId)
      : undefined;
    const messages = Array.isArray(scan.messages) ? scan.messages : [];
    const text = typeof scan.text === "string" ? scan.text.trim() : "";
    return {
      windowId: scan.window_id,
      title,
      titleConfidence,
      windowBounds: scan.window_bounds,
      visualInputRect: scan.visual_input_rect,
      visualChatSignature: scan.visual_chat_signature,
      messages,
      text,
      signature: wechatScanSignature({ ...scan, messages }),
      customerId: suggestedCustomer?.profile.id,
    };
  }

  async function confirmWeChatScan() {
    if (!pendingWeChatScan) return;
    const pending = pendingWeChatScan;
    const target = customersRef.current.find((item) => item.profile.id === pending.customerId);
    if (!target) {
      setNotice("请先从客户列表选择一个明确的归属对象；尚未把 OCR 文本写入客户记录。");
      return;
    }
    if (!pending.messages.length || !pending.text.trim()) {
      setNotice("当前预览没有可载入的聊天内容。请重读当前微信对话。");
      return;
    }
    if (!isTauri() || wechatOperationInProgress.current) return;
    wechatOperationInProgress.current = true;
    setWechatBusy(true);
    setWechatStatus("正在复核微信会话锚点…");
    try {
      const fresh = await invoke<WeChatScanResult>("scan_wechat");
      const freshSignature = wechatScanSignature(fresh);
      if (freshSignature !== pending.signature) {
        ensureWeChatScanCustomer(fresh);
        const refreshed = pendingFromWeChatScan(fresh);
        updatePendingWeChatScan(refreshed);
        setWechatWindowTitle(fresh.window_title);
        setWechatConversationTitle(refreshed.title ?? "");
        setWechatStatus("微信会话已变化，锚点预览已刷新");
        setNotice("确认期间微信窗口或可见消息发生了变化。旧结果未载入，请核对新预览与聊天对象后再次确认。");
        return;
      }
    } catch (error) {
      setNotice(`无法复核当前微信会话，识别结果未载入：${String(error)}`);
      return;
    } finally {
      wechatOperationInProgress.current = false;
      setWechatBusy(false);
    }
    const confirmedTarget = customersRef.current.find((item) => item.profile.id === pending.customerId);
    if (!confirmedTarget) {
      setNotice("所选客户已从列表移除；当前微信识别结果未载入。请重新选择归属对象。");
      return;
    }
    updateSelectedCustomerId(confirmedTarget.profile.id);
    confirmedWeChatAnchor.current = { ...pending, customerId: confirmedTarget.profile.id };
    setWechatConversationTitle(pending.title ?? "");
    setDraft(pending.text);
    setDraftSource("wechat");
    draftRef.current = pending.text;
    lastAutomaticDraft.current = pending.text;
    updatePendingWeChatScan(undefined);
    setWechatStatus(`已确认会话归属：${confirmedTarget.profile.name}`);
    const hasIncoming = pending.messages.some((message) => message.speaker === "customer");
    setNotice(hasIncoming
      ? `已将识别文本载入「${confirmedTarget.profile.name}」的草稿；请核对后手动点击“生成策略”。`
      : `已载入「${confirmedTarget.profile.name}」的识别草稿，但未可靠识别出客户侧消息；编辑确认前不会发送给 Bocha Jev。`);
  }

  async function importRecentWeChatCustomers(): Promise<boolean> {
    if (!isTauri()) {
      setWechatStatus("微信会话列表导入仅在 macOS 桌面 App 中可用");
      setNotice(`请在 macOS App 中打开微信会话列表后导入最多 ${WECHAT_IMPORT_LIMIT} 个候选；导入后请复核联系人类型。`);
      return false;
    }
    if (wechatOperationInProgress.current) return false;
    wechatOperationInProgress.current = true;
    setWechatBusy(true);
    setWechatStatus("正在本机识别微信会话列表…");
    setNotice("正在本机读取微信会话列表客户名称；不会读取聊天正文…");
    try {
      const captureAllowed = await invoke<boolean>("request_screen_capture_access");
      if (!captureAllowed) {
        saveWeChatImportAudit({ success: false, error: "screen_capture_authorization_required" });
        setWechatWindowTitle("");
        setWechatStatus("等待屏幕录制授权");
        setNotice("当前构建未通过 macOS 屏幕录制预检；即使开关显示开启，也可能是旧的临时签名身份。请使用稳定签名构建重新授权并重启；此时未读取微信内容。");
        return false;
      }
      const result = await invoke<{
        window_title: string;
        customers: Array<{ name: string }>;
        visible_rows: number;
        skipped_group_rows: number;
        skipped_uncertain_rows: number;
        status: string;
      }>("import_recent_wechat_customers");
      const importedNames = collectNewWeChatCustomerNames(
        result.customers.map((candidate) => candidate.name),
        customersRef.current,
        WECHAT_IMPORT_LIMIT,
      );
      const imported: CustomerConversation[] = [];
      for (const name of importedNames) {
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
        updateCustomers((current) => [...current, ...imported]);
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
      const limitNote = result.customers.length < WECHAT_IMPORT_LIMIT ? ` 当前窗口可见候选不足 ${WECHAT_IMPORT_LIMIT} 个；其余联系人未导入。` : "";
      setNotice(`${result.status} 本次新增 ${total} 位（已存在的客户自动去重）；${groupNote}${uncertainNote}${limitNote}`);
      return true;
    } catch (error) {
      const message = String(error);
      saveWeChatImportAudit({ success: false, error: message.slice(0, 180) });
      setWechatWindowTitle("");
      setWechatConversationTitle("");
      setWechatStatus("未能识别微信会话列表");
      setNotice(`${message} 请确认微信主窗口已打开并授权屏幕录制；聊天内容不会上传。`);
      return false;
    } finally {
      wechatOperationInProgress.current = false;
      setWechatBusy(false);
    }
  }

  async function readWeChatConversation(automatic = false): Promise<boolean> {
    if (!isTauri()) {
      setWechatStatus("微信自动识别仅在 macOS 桌面 App 中可用");
      setNotice("微信自动读取仅在 macOS 桌面应用中可用；可在下方手动粘贴聊天内容");
      return false;
    }
    if (wechatOperationInProgress.current || analysisInProgress.current) return false;
    wechatOperationInProgress.current = true;
    setWechatBusy(true);
    setWechatStatus("正在定位当前微信对话并进行本机 OCR…");
    setNotice("正在锚定当前微信会话；识别结果只会先展示，不会自动载入或分析…");
    try {
      if (!automatic) {
        const captureAllowed = await invoke<boolean>("request_screen_capture_access");
        if (!captureAllowed) {
          setWechatWindowTitle("");
          setWechatConversationTitle("");
          setWechatStatus("等待屏幕录制授权");
          setNotice("当前构建未通过 macOS 屏幕录制预检；即使开关显示开启，也可能是旧的临时签名身份。请使用稳定签名构建重新授权并重启；当前没有读取微信内容。");
          return false;
        }
      }
      const scan = await invoke<WeChatScanResult>("scan_wechat");
      if (!Number.isInteger(scan.window_id) || !Array.isArray(scan.messages)) {
        throw new Error("当前运行的客户端仍返回旧版微信识别数据；请退出旧 App 并启动新构建。");
      }
      const customerResolution = ensureWeChatScanCustomer(scan);
      const pending = pendingFromWeChatScan(scan);
      if (confirmedWeChatAnchor.current?.signature !== pending.signature) {
        confirmedWeChatAnchor.current = undefined;
      }
      setWechatWindowTitle(scan.window_title || "微信");
      setWechatConversationTitle(pending.title ?? "");
      const currentDraft = draftRef.current.trim();
      if (currentDraft && currentDraft !== lastAutomaticDraft.current) {
        if (pending.signature !== lastAutomaticScan.current || pendingWeChatScanRef.current?.signature !== pending.signature) {
          updatePendingWeChatScan(pending);
        }
        lastAutomaticScan.current = pending.signature;
        setWechatStatus("输入框已有手动草稿；为避免覆盖，当前识别结果未载入");
        setNotice("当前对话已锚定并显示在预览中；原有手动草稿未改动。确认载入会替换草稿，请先检查并自行决定。");
        return true;
      }
      if (automatic && canSkipUnchangedAutomaticWeChatScan(
        pending.signature,
        lastAutomaticScan.current,
        pending.customerId,
        selectedCustomerIdRef.current,
      )) return true;
      if (pending.customerId && pending.customerId !== selectedCustomerIdRef.current) {
        confirmedWeChatAnchor.current = undefined;
        if (currentDraft && currentDraft === lastAutomaticDraft.current) {
          draftRef.current = "";
          setDraft("");
          setDraftSource("manual");
          lastAutomaticDraft.current = "";
        }
        updateSelectedCustomerId(pending.customerId);
        setAssetQueued(false);
      }
      if (!pending.messages.length || !pending.text) {
        setWechatStatus("已定位微信窗口，但没有提取到可核对的聊天消息");
        setNotice(pending.customerId
          ? `已识别并切换到客户「${customersRef.current.find((item) => item.profile.id === pending.customerId)?.profile.name ?? pending.title}」，但未读到可核对消息。请打开具体单聊或稍后重新读取；不会载入旧草稿。`
          : "当前只锚定了窗口，未读取到消息。请打开具体单聊、滚动到可见消息后重新读取；原草稿保留。");
        updatePendingWeChatScan(undefined);
        lastAutomaticScan.current = pending.signature;
        return false;
      }
      updatePendingWeChatScan(pending);
      lastAutomaticScan.current = pending.signature;
      const matched = pending.customerId
        ? customersRef.current.find((item) => item.profile.id === pending.customerId)
        : undefined;
      const titleStatus = pending.title
        ? `标题「${pending.title}」${pending.titleConfidence !== undefined ? ` · OCR ${Math.round(pending.titleConfidence * 100)}%` : ""}`
        : "会话标题未确认";
      setWechatStatus(`已锚定微信窗口 #${pending.windowId} · ${titleStatus}`);
      setNotice(matched
        ? `识别到 ${pending.messages.length} 条可见消息；${customerResolution.created ? "已自动新增并切换到" : "已匹配并切换到"}「${matched.profile.name}」，仍需你核对对象和每条消息后确认载入。`
        : `识别到 ${pending.messages.length} 条可见消息；请核对会话标题与客户归属，再确认载入。`);
      return true;
    } catch (error) {
      const message = String(error);
      setWechatWindowTitle("");
      setWechatConversationTitle("");
      setWechatStatus("未能识别微信窗口");
      setNotice(`${message} 可手动粘贴聊天，或稍后重试微信识别。`);
      return false;
    } finally {
      wechatOperationInProgress.current = false;
      setWechatBusy(false);
    }
  }

  async function fillWeChat(text: string) {
    const anchor = confirmedWeChatAnchor.current;
    if (!anchor || !anchor.title || !anchor.messages.length || anchor.customerId !== selectedCustomerIdRef.current) {
      setNotice("请先读取并确认当前微信会话及客户归属，再使用回填；当前没有向微信写入任何内容。");
      return;
    }
    if (!isTauri()) {
      setNotice("微信回填只在 macOS 桌面 App 中可用；没有改动剪贴板。可使用旁边的“复制”按钮手动粘贴。");
      return;
    }
    if (wechatFillBusy) return;
    setWechatFillBusy(true);
    try {
      const captureAllowed = await invoke<boolean>("request_screen_capture_access");
      if (!captureAllowed) {
        setNotice("已请求 macOS 屏幕录制授权。请在系统提示/隐私设置中允许 Jev 销售副驾；如果刚开启权限，请完全退出并重开 App 后再次点击回填。当前没有向微信写入内容。");
        return;
      }
      const accessibilityAllowed = await invoke<boolean>("request_accessibility_access");
      if (!accessibilityAllowed) {
        setNotice("已请求 macOS 辅助功能授权；请在系统提示或“系统设置 → 隐私与安全性 → 辅助功能”中允许 Jev 销售副驾。授权后请完全退出并重开 App，再次点击回填。当前没有向微信写入内容。");
        return;
      }
      const result = await invoke<string>("fill_wechat_input", {
        text,
        windowId: anchor.windowId,
        conversationTitle: anchor.title,
        windowBounds: anchor.windowBounds,
        visualInputRect: anchor.visualInputRect ?? null,
        visualChatSignature: anchor.visualChatSignature ?? null,
        messages: anchor.messages,
      });
      setNotice(result);
    } catch (error) {
      setNotice(`${String(error)} 没有改动剪贴板，也不会自动发送；请核对微信会话与输入框，或使用“复制”按钮手动粘贴。`);
    } finally {
      setWechatFillBusy(false);
    }
  }

  async function checkAgent() {
    setProviderCheck("正在检查 Agent /models（不会发送客户对话或调用生成模型）…");
    try {
      const result = isTauri()
        ? await invoke<{ message: string; models: string[] }>("check_agent_provider", { endpoint: draftAgentProfiles[draftAgentMode].endpoint, apiKey: draftAgentApiKey })
        : { message: "网页已连接 Agent", models: await checkBrowserAgent(draftAgentProfiles[draftAgentMode].endpoint, draftAgentApiKey) };
      setAgentAvailableModels(result.models);
      setProviderCheck(`${result.message}${result.models.length ? ` · 已读取 ${result.models.length} 个模型，可在模型建议中选择` : " · 可手动填写模型 ID"}`);
    } catch (error) { setProviderCheck(String(error)); }
  }

  async function checkBochaJev() {
    if (!isTauri()) { setBochaJevCheck("连通性检查仅可在桌面 App 运行；不会提交客户对话。"); return; }
    setBochaJevCheck("正在读取 Bocha Jev /models（不会发送客户对话或执行决策）…");
    try {
      setBochaJevCheck(await invoke<string>("check_bocha_jev_provider", { apiKey: draftBochaJevApiKey }));
    } catch (error) {
      setBochaJevCheck(String(error));
    }
  }

  async function checkVideoProvider() {
    if (draftVideoProvider === "none") {
      setVideoProviderCheck("请先选择一个视频模型 API。");
      return;
    }
    setVideoProviderCheck("正在读取火山方舟模型目录；不会创建视频任务或产生生成费用…");
    try {
      const models = isTauri()
        ? (await invoke<{ ok: boolean; message: string; models: string[] }>("check_seedance_video_provider", { apiKey: draftVideoApiKey })).models
        : await checkSeedanceProvider(draftVideoApiKey);
      setVideoAvailableModels(models);
      const available = models.includes(draftVideoModel.trim() || DEFAULT_VIDEO_MODEL);
      setVideoProviderCheck(`API 连接成功 · ${models.length} 个可见模型${available ? ` · ${draftVideoModel.trim() || DEFAULT_VIDEO_MODEL} 可用` : ` · 目录未列出 ${draftVideoModel.trim() || DEFAULT_VIDEO_MODEL}，请确认账号已开通模型`}`);
    } catch (error) {
      setVideoProviderCheck(String(error));
    }
  }

  function selectAgentMode(value: AgentMode) {
    setDraftAgentMode(value);
    setDraftAgentApiKey("");
    setAgentAvailableModels([]);
    setProviderCheck("");
  }

  function updateAgentProfile(update: Partial<(typeof agentProfiles)[AgentMode]>) {
    setDraftAgentProfiles((current) => ({ ...current, [draftAgentMode]: { ...current[draftAgentMode], ...update } }));
    if ("endpoint" in update) {
      setAgentAvailableModels([]);
      setProviderCheck("");
    }
  }

  function resetDemo() {
    setDraft("");
    setDraftSource("manual");
    setAssetQueued(false);
    if (selectedConversation?.profile.id === demoCustomer.id) {
      const nextDecision = demoDecision(demoMessages[0].text);
      updateCustomers((current) => current.map((item) => item.profile.id === demoCustomer.id
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
    setProductWorkspace((current) => ({ ...current, [field]: value, outputs: [], selectedOutputId: undefined } as ProductWorkspace));
  }

  function setProductStatus(message: string) {
    setProductIntakeNotice(message);
    setNotice(message);
  }

  function applyProductBulkEdit(text: string): string | null {
    let next: ProductWorkspace;
    try {
      next = applyProductFactsBulkEdit(productWorkspace, text);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    setPreviousProductWorkspace(productWorkspace);
    setProductWorkspace(next);
    setProductStatus(`已整块应用 ${next.facts.length} 条事实；有改动的内容保持待核对，确认后再生成素材。`);
    return null;
  }

  function startNewProduct() {
    setPreviousProductWorkspace(productWorkspace);
    setProductWorkspace({ ...defaultProductWorkspace });
    setProductStatus("已切换到空白产品。现在可直接粘贴新资料；如需恢复旧案例，点击“撤销上次替换”。");
  }

  function undoProductSwitch() {
    if (!previousProductWorkspace) return;
    setProductWorkspace(previousProductWorkspace);
    setPreviousProductWorkspace(null);
    setProductStatus("已恢复上一版产品事实卡与图片。");
  }

  function updateProductFact(id: string, field: "label" | "value" | "status", value: string) {
    setProductWorkspace((current) => ({
      ...current,
      facts: current.facts.map((fact) => fact.id === id ? { ...fact, [field]: value, ...(field === "status" ? {} : { status: "pending" as const, source: "用户手动编辑 · 待核对" }) } : fact),
      outputs: [],
      selectedOutputId: undefined,
      status: "COLLECTING",
    }));
  }

  function confirmProductFacts() {
    setProductWorkspace((current) => {
      const next = confirmAgentProductFacts(current);
      const changed = next.facts.some((fact, index) => fact.status !== current.facts[index]?.status);
      return changed ? { ...next, outputs: [], selectedOutputId: undefined } : next;
    });
    setProductStatus("已一键确认有文字或图片证据支持的事实；证据不足的项目仍保留待核实状态。生成前可继续整块修改。");
  }

  function addProductFact() {
    setProductWorkspace((current) => ({
      ...current,
      facts: [...current.facts, { id: `fact-${Date.now()}`, label: "新卖点", value: "", status: "pending", source: "待用户补充" }],
      outputs: [],
      selectedOutputId: undefined,
      status: "COLLECTING",
    }));
  }

  async function organizeProductIntake(text: string, files: File[]): Promise<boolean> {
    if (productIntakeInProgress.current) return false;
    if (!localProductMode && (!agentModel.trim() || (agentMode !== "ollama" && !agentApiKey.trim()))) {
      setProductStatus("请先确认 Agent 模型和 API Key；本轮素材仍留在输入框。");
      openProviderDialog();
      return false;
    }
    if (text.length > 12_000 || files.length > 8) {
      setProductStatus("单次文字最多 12,000 字、图片最多 8 张；素材仍留在输入框。");
      return false;
    }
    productIntakeInProgress.current = true;
    setProductIntakeBusy(true);
    try {
      const images: ProductImage[] = [];
      for (const file of files) {
        const previewUrl = await prepareImageForLocalStorage(file);
        if (previewUrl.length > 1_900_000) throw new Error(`图片 ${file.name} 压缩后仍过大，请换小一些的图片`);
        images.push({
          id: `image-${crypto.randomUUID()}`,
          name: file.name,
          previewUrl,
          source: "local-upload",
          note: "等待本轮素材整理",
        });
      }
      const newImageChars = images.reduce((total, image) => total + (image.previewUrl?.length ?? 0), 0);
      if (newImageChars > 9_000_000) throw new Error("本轮图片合计过大，请减少图片数量或更换较小图片");

      const result = localProductMode
        ? localProductIntake(text, images.length)
        : isTauri()
          ? await invoke<AgentProductIntakeResult>("agent_product_intake", {
            text,
            images: images.map((image) => image.previewUrl!),
            endpoint: agentEndpoint,
            apiKey: agentApiKey,
            model: agentModel,
          })
          : await requestBrowserProductIntake({
            text,
            images: images.map((image) => image.previewUrl!),
            endpoint: agentEndpoint,
            apiKey: agentApiKey,
            model: agentModel,
          });
      if (localProductMode && needsExplicitProductName(productWorkspace, text, result)) {
        setProductStatus(`当前事实卡属于「${productWorkspace.productName}」，本轮文字未标明产品名称。请在输入首行添加「产品名称：…」后重试，以免混入其他产品。`);
        return false;
      }
      const changedProduct = Boolean(result.productName.trim() && productWorkspace.productName.trim()
        && result.productName.trim().toLocaleLowerCase() !== productWorkspace.productName.trim().toLocaleLowerCase());
      if (changedProduct && !window.confirm(`当前事实卡属于「${productWorkspace.productName}」。改为「${result.productName}」会替换当前产品的事实、图片和输出草稿。是否继续？`)) {
        setProductStatus("已取消切换产品；原素材留在输入框，现有事实卡未改动。");
        return false;
      }
      const currentImages = changedProduct ? [] : productWorkspace.images.filter((image) => image.source === "local-upload");
      if (currentImages.length + files.length > 12) throw new Error("本机最多保留 12 张产品图，请先移除不需要的图片再整理");
      const savedImageChars = currentImages.reduce((total, image) => total + (image.previewUrl?.length ?? 0), 0);
      if (savedImageChars + newImageChars > 3_200_000) throw new Error("产品图片占用的本机存储将超过安全上限，请先移除旧图片");
      if (changedProduct) setPreviousProductWorkspace(productWorkspace);
      setProductWorkspace((current) => applyAgentProductIntake(current, text, images, result, new Date().toISOString(), localProductMode));
      setProductStatus(localProductMode
        ? images.length > 0
          ? `本机已保留本轮原文并收集 ${images.length} 张图片；未调用 Agent，也未做语义或图片识别。请配置多模态 Agent 后再做智能整理。`
          : "本机已保留本轮原文；未调用 Agent 或做语义识别。只整理了明确的标签：内容，请配置 Agent 后再做智能整理。"
        : `Agent 已整理文字与 ${images.length} 张图片，并更新产品事实卡；请核对来源标记。`);
      return true;
    } catch (error) {
      setProductStatus(`产品素材整理未完成：${error instanceof Error ? error.message : String(error)}。素材仍留在输入框，可调整后重试。`);
      return false;
    } finally {
      productIntakeInProgress.current = false;
      setProductIntakeBusy(false);
    }
  }

  function removeProductImage(id: string) {
    setProductWorkspace((current) => ({
      ...current,
      images: current.images.filter((image) => image.id !== id),
      intakeMessages: (current.intakeMessages ?? []).map((message) => ({
        ...message,
        attachmentIds: message.attachmentIds?.filter((imageId) => imageId !== id),
      })),
      outputs: [],
      selectedOutputId: undefined,
      status: "COLLECTING",
    }));
  }

  function generateProductPackage() {
    if (productWorkspace.facts.length === 0) {
      setProductStatus("先提交产品文字或图片，由 Agent 整理产品事实后再生成素材包。");
      return;
    }
    const outputs = buildProductOutputs(productWorkspace);
    setProductWorkspace((current) => ({ ...current, outputs, selectedOutputId: outputs[0]?.id, status: "READY_FOR_REVIEW" }));
    setProductStatus("已生成产品素材包草稿，等待人工审阅");
  }

  function updateVideoGeneration(outputId: string, videoGeneration: NonNullable<ProductOutput["videoGeneration"]>) {
    setProductWorkspace((current) => ({
      ...current,
      outputs: current.outputs.map((output) => output.id === outputId ? { ...output, videoGeneration } : output),
    }));
  }

  async function generateProductVideo(outputId: string) {
    const output = productWorkspace.outputs.find((item) => item.id === outputId);
    if (!output || output.stale || output.type !== "video-script" || !output.scenes?.length) {
      setVideoStatus("请先生成产品素材包中的视频分镜脚本。");
      return;
    }
    if (productWorkspace.images.filter((image) => image.source === "local-upload" && image.previewUrl).length === 0) {
      setVideoStatus("请先上传至少一张真实产品图，避免视频模型凭空生成不相符的产品外观。");
      return;
    }
    if (videoProvider !== "volcengine-seedance" || !videoApiKey.trim()) {
      setVideoStatus("请先在模型与服务配置中选择视频 API 并填写 API Key。");
      openProviderDialog();
      return;
    }
    if (!window.confirm("将按当前 15 秒分镜与已上传产品图创建一次火山方舟 Seedance 视频任务。任务创建可能产生费用；是否继续？")) return;
    setVideoBusy(true);
    setVideoStatus("正在创建视频生成任务；不会自动重复提交…");
    try {
      const prompt = buildVideoGenerationPrompt(productWorkspace, output);
      const images = productWorkspace.images
        .filter((image) => image.source === "local-upload" && image.previewUrl)
        .slice(0, 12)
        .map((image) => image.previewUrl!);
      const ratio = productWorkspace.videoDirection.includes("16:9") ? "16:9" : "9:16";
      const task = isTauri()
        ? await invoke<{ id: string; status: "queued" | "running" | "succeeded" | "failed" | "expired" | "unknown"; videoUrl?: string; error?: string }>("create_seedance_video_task", {
          apiKey: videoApiKey,
          model: videoModel,
          prompt,
          ratio,
          images,
        })
        : await createSeedanceTask({ apiKey: videoApiKey, model: videoModel, prompt, ratio, images });
      updateVideoGeneration(outputId, {
        provider: "volcengine-seedance",
        taskId: task.id,
        status: task.status,
        videoUrl: task.videoUrl,
        error: task.error,
        updatedAt: new Date().toISOString(),
      });
      setVideoStatus(task.videoUrl ? "成片已返回；请检查产品外观、配音、文字与事实一致性。" : `视频任务已创建（${task.id}），正在等待生成。`);
    } catch (error) {
      setVideoStatus(`视频任务创建失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setVideoBusy(false);
    }
  }

  function markReviewReviewed(id: string) {
    setReviewRecords((current) => current.map((record) => record.id === id ? { ...record, status: "已复盘" } : record));
    setNotice("已把本次沟通标记为已复盘，规则可以继续迭代");
  }

  const selectedProductOutput = productWorkspace.outputs.find((output) => output.id === productWorkspace.selectedOutputId) ?? productWorkspace.outputs[0];
  const videoProviderReady = videoProvider === "volcengine-seedance" && Boolean(videoApiKey.trim()) && Boolean(videoModel.trim());

  useEffect(() => {
    const generation = selectedProductOutput?.videoGeneration;
    if (!generation || !videoApiKey.trim()) return;
    if (!["queued", "running"].includes(generation.status)
        && !(generation.status === "succeeded" && !generation.videoUrl)) return;
    let stopped = false;
    let timer = 0;
    let currentStatus = generation.status;
    let hasVideo = Boolean(generation.videoUrl);
    const poll = async () => {
      if (stopped || videoPollBusy.current) return;
      videoPollBusy.current = true;
      try {
        const result = isTauri()
          ? await invoke<{ id: string; status: NonNullable<ProductOutput["videoGeneration"]>["status"]; videoUrl?: string; error?: string }>("get_seedance_video_task", { apiKey: videoApiKey, taskId: generation.taskId })
          : await getSeedanceTask(videoApiKey, generation.taskId);
        if (stopped) return;
        currentStatus = result.status;
        hasVideo = Boolean(result.videoUrl);
        updateVideoGeneration(selectedProductOutput.id, {
          provider: "volcengine-seedance",
          taskId: result.id,
          status: result.status,
          videoUrl: result.videoUrl,
          error: result.error,
          updatedAt: new Date().toISOString(),
        });
        if (result.videoUrl) setVideoStatus("成片已生成；视频链接有效期为 24 小时，请及时打开或保存，并人工检查内容。");
        else if (result.status === "failed") setVideoStatus(`视频生成失败：${result.error || "服务商未提供原因"}`);
        else if (result.status === "expired") setVideoStatus("视频任务已过期；如仍需成片，请检查脚本后重新创建任务。");
        else if (result.status === "running" || result.status === "queued") setVideoStatus(result.status === "queued" ? "视频任务排队中…" : "视频正在生成…");
      } catch (error) {
        if (!stopped) setVideoStatus(`暂时无法查询视频任务，将稍后重试：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        videoPollBusy.current = false;
        if (!stopped && (["queued", "running"].includes(currentStatus) || (currentStatus === "succeeded" && !hasVideo))) {
          timer = window.setTimeout(() => void poll(), 10_000);
        }
      }
    };
    timer = window.setTimeout(() => void poll(), 7_000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [selectedProductOutput?.id, selectedProductOutput?.videoGeneration?.taskId, selectedProductOutput?.videoGeneration?.status, selectedProductOutput?.videoGeneration?.videoUrl, videoApiKey]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">J</div><div><strong>Jev 销售副驾</strong><span>SALES COPILOT</span></div></div>
        <div className="local-badge"><i />本地优先 · 人工发送</div>
        <nav className="mode-nav" aria-label="工作模式">
          <span className="nav-title">WORKSPACE</span>
          {(Object.keys(modeLabels) as AppMode[]).map((item) => <button key={item} className={mode === item ? "is-active" : ""} onClick={() => setMode(item)}><span className="nav-icon"><Icon name={item === "sales" ? "message" : item === "materials" ? "image" : "refresh"} size={16} /></span><span><strong>{modeLabels[item].label}</strong><small>{modeLabels[item].sub}</small></span>{item === "sales" && <i className="nav-dot" />}</button>)}
        </nav>
        <div className="customer-section"><div className="section-heading"><span>客户管理 · {customers.length}</span><div className="section-heading-actions"><button type="button" aria-label="打开客户管理列表" title="打开客户管理列表" onClick={() => setCustomerManagementOpen(true)}><Icon name="list" size={13} /><span>列表</span></button><button type="button" aria-label="手动新增客户" title="手动新增客户" onClick={() => setCustomerDialogOpen(true)}><Icon name="plus" size={14} /><span>新增</span></button><button className="remove-customer-trigger" type="button" aria-label="移除当前客户" title={selectedConversation ? `移除 ${selectedConversation.profile.name}` : "请先选择客户"} disabled={!selectedConversation} onClick={() => selectedConversation && setCustomerRemovalPending(selectedConversation)}><Icon name="trash" size={13} /><span>移除</span></button></div></div>{customers.map((item) => <button type="button" key={item.profile.id} aria-pressed={item.profile.id === selectedCustomerId} aria-label={`切换到客户 ${item.profile.name}`} className={`customer-item ${item.profile.id === selectedCustomerId ? "is-active" : ""}`} onClick={() => selectCustomer(item.profile.id)}><div className={`customer-avatar ${item.profile.id === selectedCustomerId ? "" : "muted-avatar"}`}>{item.profile.name.slice(0, 1)}</div><div><strong>{item.profile.name}</strong><small>{item.profile.company || item.profile.role || "聊天会话 · 资料待补充"}</small></div><i /></button>)}</div>
        <div className="sidebar-bottom"><div className="privacy-card"><Icon name="shield" size={16} /><div><strong>本机自动保存</strong><span>Bocha Jev 与云端 Agent 分别授权</span></div></div><div className="provider-row"><span className="provider-dot" />判断：Bocha Jev · Agent：{agentMode === "demo" ? "本地 Demo" : agentMode === "ollama" ? "本地模型" : "云端模型"}</div><button className="provider-settings-trigger" type="button" onClick={openProviderDialog} aria-haspopup="dialog" aria-expanded={providerDialogOpen}><span className="provider-settings-icon">⚙</span><span>模型与服务配置</span><span className="provider-settings-arrow">›</span></button></div>
      </aside>
      <main className="main-area">
        <header className="topbar"><div><span className="crumb">JEV SALES COPILOT / {modeLabels[mode].label.toUpperCase()}</span><h1>{mode === "sales" ? "客户沟通副驾" : modeLabels[mode].label}</h1></div><div className="top-actions"><button className="compact-header-action" type="button" onClick={() => setCustomerManagementOpen(true)} aria-haspopup="dialog" aria-label={`打开客户管理列表，共 ${customers.length} 位客户`}><Icon name="message" size={13} /><span className="compact-wide-label">客户管理 · {customers.length}</span><span className="compact-short-label">客户 · {customers.length}</span></button><button className="compact-header-action" type="button" onClick={openProviderDialog} aria-haspopup="dialog" aria-label="打开模型与服务配置"><span aria-hidden="true">⚙</span><span className="compact-wide-label">模型与服务配置</span><span className="compact-short-label">设置</span></button><span className="demo-pill">{!isTauri() ? "浏览器样例" : bochaJevConsent ? "Bocha Jev 已授权" : "Bocha Jev 待授权"}</span><span className="safe-pill"><i />不自动发送</span><div className="user-avatar">象</div></div></header>
        <div className="content-scroll">
          {mode === "materials" ? <ProductMaterialsView workspace={productWorkspace} selectedOutput={selectedProductOutput} copied={copied} onUpdateField={updateProductField} onUpdateFact={updateProductFact} onAddFact={addProductFact} onConfirmFacts={confirmProductFacts} onSubmitIntake={organizeProductIntake} onRemoveImage={removeProductImage} intakeBusy={productIntakeBusy} intakeNotice={productIntakeNotice} agentServiceLabel={localProductMode ? "本机文字预整理（不识别图片）" : productAgentServiceLabel} localMode={localProductMode} onApplyBulkEdit={applyProductBulkEdit} onStartNewProduct={startNewProduct} onUndoProductSwitch={undoProductSwitch} canUndoProductSwitch={Boolean(previousProductWorkspace)} onGenerate={generateProductPackage} onSelectOutput={(id) => setProductWorkspace((current) => ({ ...current, selectedOutputId: id }))} onCopy={copyText} videoProviderReady={videoProviderReady} videoBusy={videoBusy} videoNotice={videoStatus} onGenerateVideo={generateProductVideo} onOpenVideoSettings={openProviderDialog} /> : mode === "review" ? <ReviewView records={reviewRecords} selectedId={selectedReviewId ?? reviewRecords[0]?.id} copied={copied} onSelect={setSelectedReviewId} onMarkReviewed={markReviewReviewed} onCopy={copyText} /> : <>
            <section className="hero-row"><div><span className="overline">TODAY'S CUSTOMER MOMENT</span><h2>让每一次客户回复，<em>都有下一步</em></h2><p>{!isTauri() ? "浏览器可逐次共享企业微信或其他聊天窗口并本机 OCR；分析仍为本地演示。" : "Bocha Jev 负责结构化判断，Agent 再生成策略。你负责最后的判断和发送。"}</p></div><div className="hero-stats"><div><strong>{conversationCount}</strong><span>本次客户消息</span></div><div><strong>{Math.round(decision.confidence * 100)}%</strong><span>当前判断置信度</span></div><div><strong>{decision.commercialRisk}</strong><span>商业风险 / 9</span></div></div></section>
            <div className="workspace-grid">
              <section className="panel conversation-panel">
                <div className="panel-heading conversation-heading">
                  <div className="contact-heading"><div className="customer-avatar large-avatar">{selectedConversation?.profile.name.slice(0, 1) ?? "客"}</div><div><span className="overline">CURRENT CUSTOMER</span><h2>{selectedConversation?.profile.name ?? "请先新增客户"}</h2><p>{selectedConversation?.profile.company || selectedConversation?.profile.role || "客户资料可随时补充"}</p></div></div>
                  <div className="conversation-head-actions"><span className="stage-pill">{decisionLabel(decision.stage)}</span><select aria-label="切换当前客户" value={selectedCustomerId} onChange={(event) => selectCustomer(event.currentTarget.value)}>{customers.map((item) => <option key={item.profile.id} value={item.profile.id}>{item.profile.name}</option>)}</select><button className="text-button" type="button" onClick={() => setCustomerDialogOpen(true)}><Icon name="plus" size={13} />新增</button></div>
                </div>
                <div className={`wechat-status ${!isTauri() ? "is-browser" : ""} ${wechatBusy ? "is-busy" : wechatWindowTitle ? "is-ready" : "is-idle"}`} role="status"><span className="wechat-status-dot" /><div><strong>{wechatStatus}</strong><small>{!isTauri() ? "选择企业微信或其他聊天窗口后，截图只在本机 OCR；每次需手动选择来源并核对客户、发言人。" : wechatConversationTitle ? `窗口：${wechatWindowTitle} · 当前会话：${wechatConversationTitle}` : wechatWindowTitle ? `微信窗口：${wechatWindowTitle} · 自动定位当前前台对话` : "打开微信单聊后自动定位；核对预览后才会载入或分析"}</small></div>{!isTauri() ? <div className="browser-screen-buttons"><button className="text-button" type="button" onClick={() => setBrowserScreenReaderMode("conversation")}>读取当前聊天</button><button className="text-button" type="button" onClick={() => setBrowserScreenReaderMode("customers")}>读取可见名单</button><button className="text-button browser-sample-button" type="button" onClick={loadBrowserValidationSample}><Icon name="refresh" size={13} />网页样例</button></div> : <><button className="text-button" type="button" onClick={() => void importRecentWeChatCustomers()} disabled={wechatBusy}><Icon name="refresh" size={13} />{wechatBusy ? "处理中…" : "导入会话列表"}</button><button className="text-button" type="button" onClick={() => void readWeChatConversation()} disabled={wechatBusy || analysisBusy}>{wechatBusy ? "识别中…" : "读取当前对话"}</button></>}</div>
                {pendingWeChatScan && <section className="wechat-match-card" aria-label="当前微信对话锚点与识别预览" data-testid="wechat-match-confirmation">
                  <div className="wechat-match-copy"><strong>当前对话锚点 · 待确认</strong><span>微信窗口 #{pendingWeChatScan.windowId} · {pendingWeChatScan.title ? `识别标题「${pendingWeChatScan.title}」` : "标题未能确认"}{pendingWeChatScan.titleConfidence !== undefined ? ` · 标题 OCR ${Math.round(pendingWeChatScan.titleConfidence * 100)}%` : ""} · ${pendingWeChatScan.messages.length} 条可见消息。尚未载入客户记录。</span></div>
                  <label className="wechat-match-select"><span>此对话归属客户</span><select aria-label="选择当前微信对话对应客户" value={pendingWeChatScan.customerId ?? ""} onChange={(event) => { const customerId = event.currentTarget.value || undefined; updatePendingWeChatScan((current) => current ? { ...current, customerId } : undefined); }}><option value="">请选择客户</option>{customers.map((item) => <option key={item.profile.id} value={item.profile.id}>{item.profile.name}</option>)}</select></label>
                  <div className="wechat-ocr-preview" aria-label="逐条核对 OCR 消息">
                    {pendingWeChatScan.messages.map((message, index) => <article className={`wechat-ocr-message is-${message.speaker}`} key={`${index}-${message.text.slice(0, 16)}`}>
                      <div className="wechat-ocr-meta"><strong>{message.speaker === "customer" ? "对方消息" : message.speaker === "seller" ? "我的消息" : "方向未确认"}</strong>{message.sender && <span>发言人：{message.sender}</span>}<small>文字 OCR {Math.round(message.confidence * 100)}%</small></div>
                      <p>{message.text}</p>
                    </article>)}
                  </div>
                  {!pendingWeChatScan.messages.some((message) => message.speaker === "customer") && <p className="wechat-ocr-warning">没有可靠识别到对方发言。可以先载入草稿人工校对，但生成策略前必须确认并整理客户原话。</p>}
                  <div className="wechat-match-actions"><button className="text-button" type="button" onClick={() => { setCustomerManagementOpen(false); setCustomerDialogOpen(true); }}>新增客户</button><button className="text-button" type="button" onClick={() => updatePendingWeChatScan(undefined)}>丢弃预览</button><button className="primary-button small-button" type="button" onClick={confirmWeChatScan} disabled={!pendingWeChatScan.customerId || !customers.some((item) => item.profile.id === pendingWeChatScan.customerId)}><Icon name="check" size={13} />确认对象并载入</button></div>
                </section>}
                <div className="conversation-list">{messages.length ? messages.map((message) => <MessageBubble key={message.id} message={message} customerName={selectedConversation?.profile.name} />) : <div className="conversation-empty"><strong>「{selectedConversation?.profile.name}」还没有会话记录</strong><span>可粘贴聊天内容，或打开微信中的对应会话后重新识别。</span></div>}</div>
                <div className="message-input"><div className="input-label"><span>{!isTauri() ? "粘贴聊天以验证本地解析" : "输入或自动读取微信聊天"}</span><small>{!isTauri() ? "可粘贴“客户：…”与“我：…”多轮文本；网页只生成本地演示判断。" : !bochaJevConsent ? "生成前需在设置中授权 Bocha Jev 接收最近对话片段" : cloudProviderSelected && shareWithProviders ? "本轮对话将发送给 Bocha Jev 和已同意的云端 Agent" : agentMode === "ollama" ? "对话发送给 Bocha Jev；策略由本机 Ollama 处理" : "对话发送给 Bocha Jev；策略由本地 Demo 处理"}</small></div><textarea value={draft} onChange={(event) => { lastAutomaticDraft.current = ""; setDraft(event.currentTarget.value); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); generateStrategy(); } }} placeholder={!isTauri() ? "客户：想了解这款产品的价格？\n我：我先确认使用场景，再给你准确介绍。\n客户：主要用于拍产品图。" : "手动粘贴聊天内容；微信 OCR 识别后也会出现在这里……"} rows={3} /><div className="input-actions"><button className="text-button" onClick={resetDemo}><Icon name="refresh" size={13} />{selectedConversation?.profile.id === demoCustomer.id ? "重置案例" : "清空草稿"}</button><span>Enter 生成 · Shift + Enter 换行</span><button className="primary-button small-button" onClick={generateStrategy} disabled={!draft.trim() || wechatBusy || analysisBusy}><Icon name="spark" size={14} />{analysisBusy ? "处理中…" : !isTauri() ? "本地演示分析" : "生成策略"}</button></div></div>
              </section>
              <DecisionCard decision={decision} />
            </div>
            <div className="lower-grid"><StrategyCard strategy={strategy} /><div className="right-stack"><RepliesCard strategy={strategy} onCopy={copyText} onFill={fillWeChat} canFill={Boolean(confirmedWeChatAnchor.current && confirmedWeChatAnchor.current.customerId === selectedCustomerId)} fillBusy={wechatFillBusy} /><section className="panel asset-panel"><div className="panel-heading"><div><span className="overline">NEXT ASSET</span><h2>推荐素材</h2></div><span className={assetQueued ? "queued-badge" : "panel-note"}>{assetQueued ? "任务已准备" : "按需调用"}</span></div>{strategy.asset ? <div className="asset-content"><div className="asset-icon"><Icon name="image" size={19} /></div><div><strong>{strategy.asset.title}</strong><p>{strategy.asset.reason}</p><span>product-showcase · {strategy.asset.type === "comparison_card" ? "差异对比图解" : "产品卖点素材"}</span></div></div> : <div className="asset-empty"><span>当前先完成需求了解</span><small>客户出现明确的资料、对比或分享需求后再生成</small></div>}<button className="asset-button" onClick={queueAsset} disabled={!strategy.asset || assetQueued}><Icon name="spark" size={14} />{assetQueued ? "素材任务已准备" : "生成素材任务草稿"}</button></section></div></div>
            <div className="status-line"><span className="status-light" />{notice}<span className="status-tail">先确认对话锚点；不会自动发送消息</span></div>
          </>}
        </div>
      </main>
      {customerManagementOpen && <CustomerManagementDialog customers={customers} selectedCustomerId={selectedCustomerId} onClose={() => setCustomerManagementOpen(false)} onSelect={(id) => { selectCustomer(id); setCustomerManagementOpen(false); }} onAdd={() => { setCustomerManagementOpen(false); setCustomerDialogOpen(true); }} onRemove={(customer) => { setCustomerManagementOpen(false); setCustomerRemovalPending(customer); }} />}
      {browserScreenReaderMode && !isTauri() && <BrowserScreenReader initialMode={browserScreenReaderMode} customers={customers} onClose={() => setBrowserScreenReaderMode(undefined)} onImportConversation={importBrowserOcrTranscript} onImportCustomers={importBrowserOcrCustomers} />}
      {customerDialogOpen && <CustomerDialog onClose={() => setCustomerDialogOpen(false)} onSave={addCustomer} />}
      {providerDialogOpen && <div className="modal-backdrop provider-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProviderDialogOpen(false); }}>
        <section className="provider-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-dialog-title">
          <header className="provider-dialog-header">
            <div><span className="overline">MODEL & SERVICE</span><h2 id="provider-dialog-title">模型与服务配置</h2></div>
            <button className="dialog-close" type="button" aria-label="关闭模型与服务配置" onClick={() => setProviderDialogOpen(false)}>×</button>
          </header>
          <div className="provider-dialog-content">
            <div className="provider-sections">
              <section className="provider-card bocha-provider-card">
                <div className="provider-section-heading">
                  <div><strong>客户判断模型</strong><small>Bocha Jev · 固定决策服务</small></div>
                  <span className="provider-role-badge">结构化判断</span>
                </div>
                <div className="provider-specs">
                  <div><span>模型</span><strong>bocha-jev-v1</strong></div>
                  <div><span>接口</span><strong>https://jev.bocha.cn/v1/systemone</strong></div>
                  <div><span>输出</span><strong>Choice · Score · Noul</strong></div>
                </div>
                <div className="provider-fields">
                  <label>
                    <span>Bocha Jev Client API Key</span>
                    <input type="password" autoComplete="off" value={draftBochaJevApiKey} onChange={(event) => setDraftBochaJevApiKey(event.currentTarget.value)} placeholder="粘贴 API Key；仅保留在本次运行内存" />
                    <small>也可在启动应用时通过 BOCHA_JEV_API_KEY 环境变量提供。</small>
                  </label>
                  <div className="provider-action"><button className="text-button" type="button" onClick={() => void checkBochaJev()}>测试 Bocha Jev 连接</button><span>读取模型目录，不提交客户对话。</span></div>
                  {bochaJevCheck && <div className="provider-result" role="status">{bochaJevCheck}</div>}
                  <label className="provider-toggle consent-toggle"><input type="checkbox" checked={draftBochaJevConsent} onChange={(event) => setDraftBochaJevConsent(event.currentTarget.checked)} /><span>允许在点击“生成策略”时，将最近最多 6 条、总长不超过 300 字符的对话发送给 Bocha Jev。此授权仅对本次应用运行有效；点击底部确认后生效。</span></label>
                </div>
              </section>

              <section className="provider-card agent-provider-card">
                <div className="provider-section-heading">
                  <div><strong>Agent 策略模型</strong><small>根据 Bocha Jev 判断生成下一步策略与候选回复</small></div>
                  <label className="provider-mode"><span>服务商</span><select value={draftAgentMode} onChange={(event) => selectAgentMode(event.currentTarget.value as AgentMode)}><option value="demo">本机 Demo · 无需 API</option><option value="ollama">本机 Ollama</option><option value="openrouter-free">OpenRouter 免费路由</option><option value="openai">OpenAI API</option><option value="custom">自定义 OpenAI-compatible</option></select></label>
                </div>
                <div className="provider-active-service"><div><span>{agentServiceDescription[draftAgentMode].name}</span><strong>{agentServiceDescription[draftAgentMode].endpoint}</strong></div><small>{agentServiceDescription[draftAgentMode].note}</small></div>
                {draftAgentMode === "demo" ? <p className="provider-local-note">本机 Demo 可直接运行；如需使用其他 Agent 服务，请在上方选择服务商。</p> : <div className="provider-fields">
                  {draftAgentMode !== "ollama" && <label><span>服务商 API Key</span><input type="password" autoComplete="off" value={draftAgentApiKey} onChange={(event) => setDraftAgentApiKey(event.currentTarget.value)} placeholder={draftAgentMode === "openrouter-free" ? "填写 OpenRouter API Key" : "填写服务商 API Key"} /><small>密钥只保留在本次应用运行内存。</small></label>}
                  <label><span>模型 ID</span><input list="agent-model-catalog" value={draftAgentModel} onChange={(event) => updateAgentProfile({ model: event.currentTarget.value })} placeholder={draftAgentMode === "ollama" ? "如 qwen3:8b" : "填写模型 ID，或先测试连接再从目录选择"} /><datalist id="agent-model-catalog">{agentAvailableModels.map((model) => <option key={model} value={model} />)}</datalist><small>服务与模型选择会保存在本机；API Key 不保存。</small></label>
                  {draftAgentMode === "custom" && <label><span>OpenAI-compatible Base URL</span><input value={draftAgentEndpoint} onChange={(event) => updateAgentProfile({ endpoint: event.currentTarget.value })} placeholder="https://provider.example/v1" /></label>}
                  {draftAgentMode === "ollama" && <label><span>本机 Ollama Base URL</span><input value={draftAgentEndpoint} onChange={(event) => updateAgentProfile({ endpoint: event.currentTarget.value })} placeholder="http://localhost:11434/v1" /></label>}
                  {(draftAgentMode === "openai" || draftAgentMode === "openrouter-free") && <div className="provider-fixed-endpoint"><span>服务地址</span><strong>{draftAgentEndpoint}</strong></div>}
                  <div className="provider-action"><button className="text-button" type="button" onClick={() => void checkAgent()}>测试 Agent 连接</button><span>读取模型目录，不生成内容；连接后可选择可用模型 ID。</span></div>
                </div>}
                {providerCheck && <div className="provider-result" role="status">{providerCheck}</div>}
                {draftCloudProviderSelected && <label className="provider-toggle consent-toggle"><input type="checkbox" checked={draftShareWithProviders} onChange={(event) => setDraftShareWithProviders(event.currentTarget.checked)} /><span>同意在点击“生成策略”时，将本轮对话及结构化判断发送给所选云端 Agent；点击底部确认后生效。</span></label>}
              </section>
              <section className="provider-card video-provider-card">
                <div className="provider-section-heading">
                  <div><strong>视频生成模型</strong><small>根据当前 15 秒分镜脚本和产品图生成视频</small></div>
                  <label className="provider-mode"><span>视频服务</span><select value={draftVideoProvider} onChange={(event) => { setDraftVideoProvider(event.currentTarget.value as typeof draftVideoProvider); setVideoProviderCheck(""); setVideoAvailableModels([]); }}><option value="none">暂不接入</option><option value="volcengine-seedance">火山方舟 · Seedance 2.5</option></select></label>
                </div>
                {draftVideoProvider === "none" ? <p className="provider-local-note">接入视频 API 后，可在“产品素材 → 15 秒视频脚本”里一键创建视频任务。生成按钮会再次提示可能产生的费用。</p> : <div className="provider-fields">
                  <label><span>火山方舟 API Key</span><input type="password" autoComplete="off" value={draftVideoApiKey} onChange={(event) => { setDraftVideoApiKey(event.currentTarget.value); setVideoProviderCheck(""); }} placeholder="粘贴 API Key；仅保留在本次运行内存" /><small>不会写入浏览器或本机设置文件。</small></label>
                  <label><span>模型 ID</span><input list="video-model-catalog" value={draftVideoModel} onChange={(event) => setDraftVideoModel(event.currentTarget.value)} placeholder={DEFAULT_VIDEO_MODEL} /><datalist id="video-model-catalog">{[DEFAULT_VIDEO_MODEL, ...videoAvailableModels].filter((model, index, all) => all.indexOf(model) === index).map((model) => <option key={model} value={model} />)}</datalist><small>默认 Seedance 2.5；按账号开通情况确认可用。</small></label>
                  <div className="provider-fixed-endpoint"><span>任务 API</span><strong>{"https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"}</strong></div>
                  <div className="provider-action"><button className="text-button" type="button" onClick={() => void checkVideoProvider()}>测试视频 API 连接</button><span>仅读取模型目录，不会创建生成任务。</span></div>
                  {videoProviderCheck && <div className="provider-result" role="status">{videoProviderCheck}</div>}
                </div>}
              </section>
              <p className="provider-disclosure">聊天与产品资料仅在你主动点击相应处理按钮后发给所选服务。图片在本机保存；使用视频 API 时，分镜和产品图会发送至火山方舟。API Key 仅保留在本次运行内存；视频任务可能计费，生成链接有效期有限。应用不会自动发送客户消息。</p>
            </div>
          </div>
          <footer className="provider-dialog-footer"><button className="text-button" type="button" onClick={() => setProviderDialogOpen(false)}>取消</button><button className="primary-button small-button" type="button" data-testid="confirm-provider-settings" aria-label="确认并应用模型与 API 接口设置" onClick={confirmProviderSettings}><Icon name="check" size={14} />确认并应用模型与 API 接口设置</button></footer>
        </section>
      </div>}
      {customerRemovalPending && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCustomerRemovalPending(undefined); }}><section className="customer-dialog customer-removal-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-customer-title"><div className="panel-heading"><div><span className="overline">CUSTOMER MANAGEMENT</span><h2 id="remove-customer-title">移除客户</h2></div><button className="dialog-close" type="button" aria-label="取消移除" onClick={() => setCustomerRemovalPending(undefined)}>×</button></div><div className="removal-confirmation"><p>确定从客户列表移除「{customerRemovalPending.profile.name}」及其本机聊天记录吗？</p><small>已生成的沟通复盘快照会保留。</small><div className="dialog-actions"><button className="text-button" type="button" onClick={() => setCustomerRemovalPending(undefined)}>取消</button><button className="danger-button" type="button" onClick={removePendingCustomer}><Icon name="trash" size={13} />确认移除</button></div></div></section></div>}
    </div>
  );
}

export default App;
