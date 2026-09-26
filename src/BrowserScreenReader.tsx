import { useRef, useState, type PointerEvent } from "react";
import type { CustomerConversation } from "./types";
import { captureDisplayFrame, describeDisplayCaptureError, recognizeDisplayRegion, type CapturedDisplayFrame } from "./browser-screen-capture";
import {
  buildBrowserScreenTranscript,
  classifyBrowserScreenOcrLines,
  detectBrowserConversationTitle,
  findBrowserCustomerTitleMatch,
  formatBrowserScreenNameCandidates,
  isLikelyGroupConversationTitle,
  isBrowserNonContactHeaderLabel,
  type BrowserScreenOcrLine,
  type BrowserScreenOcrLineInput,
  type BrowserScreenOcrSpeaker,
} from "./browser-screen-reader-utils";

type ReadMode = "conversation" | "customers";
type Props = {
  initialMode: ReadMode;
  customers: CustomerConversation[];
  onClose: () => void;
  onImportConversation: (customerId: string | undefined, transcript: string, newCustomerName?: string) => void;
  onImportCustomers: (names: string[]) => number;
};

const speakerOptions: Array<{ value: BrowserScreenOcrSpeaker; label: string }> = [
  { value: "customer", label: "客户" },
  { value: "seller", label: "我" },
  { value: "unknown", label: "未确认" },
  { value: "ignore", label: "日期/忽略" },
];

export function BrowserScreenReader({ initialMode, customers, onClose, onImportConversation, onImportCustomers }: Props) {
  const [mode, setMode] = useState<ReadMode>(initialMode);
  const [frame, setFrame] = useState<CapturedDisplayFrame>();
  const [region, setRegion] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | undefined>(undefined);
  const [lines, setLines] = useState<BrowserScreenOcrLine[]>([]);
  const [namesText, setNamesText] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [conversationTitle, setConversationTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("先选择要读取的聊天窗口，再框选名单或聊天正文区域。");
  const [error, setError] = useState("");

  async function chooseWindow() {
    setError("");
    setBusy(true);
    setStatus("等待你在浏览器共享窗口选择器中选择企业微信或其他聊天窗口……");
    try {
      const captured = await captureDisplayFrame();
      setFrame(captured);
      setRegion({ left: 0, top: 0, width: captured.width, height: captured.height });
      setLines([]);
      setNamesText("");
      setConversationTitle("");
      setCustomerId("");
      setProgress(0);
      setStatus("已截取一帧。拖动选框，只圈选名单或聊天内容，再开始本机 OCR。");
    } catch (reason) {
      setError(describeDisplayCaptureError(reason));
      setStatus("没有读取画面。");
    } finally {
      setBusy(false);
    }
  }

  function pointInFrame(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!frame || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(frame.width, (event.clientX - rect.left) * frame.width / rect.width)),
      y: Math.max(0, Math.min(frame.height, (event.clientY - rect.top) * frame.height / rect.height)),
    };
  }

  function beginSelection(event: PointerEvent<HTMLDivElement>) {
    if (!frame || busy) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointInFrame(event);
    dragStart.current = point;
    setDragging(true);
    setRegion({ left: point.x, top: point.y, width: 1, height: 1 });
  }

  function moveSelection(event: PointerEvent<HTMLDivElement>) {
    if (!dragging || !dragStart.current) return;
    const point = pointInFrame(event);
    const start = dragStart.current;
    setRegion({
      left: Math.min(start.x, point.x),
      top: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  }

  function finishSelection() {
    setDragging(false);
    dragStart.current = undefined;
    if (region.width < 12 || region.height < 12) {
      setError("选区太小；请拖动鼠标框住完整的名单区域或聊天正文。");
    } else {
      setError("");
    }
  }

  async function runOcr() {
    if (!frame || region.width < 12 || region.height < 12) {
      setError("请先选择一个可识别的区域。");
      return;
    }
    setBusy(true);
    setProgress(0);
    setError("");
    setStatus("正在准备本机中文 OCR；首次使用会下载并缓存中文识别模型。");
    try {
      const recognized: BrowserScreenOcrLineInput[] = await recognizeDisplayRegion(frame.imageDataUrl, region, (value) => {
        setStatus(value.status || "本机 OCR 处理中……");
        setProgress(Math.round(value.progress * 100));
      });
      const titleCandidate = mode === "conversation" ? detectBrowserConversationTitle(recognized, region.height) : undefined;
      const classified = classifyBrowserScreenOcrLines(recognized, region.width, region.height);
      const transcriptLines = titleCandidate
        ? classified.filter((line) => {
          const isTitle = line.text === titleCandidate.text.replace(/\s+/g, " ").trim()
            && line.confidence === titleCandidate.confidence
            && line.bbox.x0 === titleCandidate.bbox.x0
            && line.bbox.y0 === titleCandidate.bbox.y0;
          const isAppChrome = line.bbox.y0 <= region.height * 0.22 && isBrowserNonContactHeaderLabel(line.text);
          return !isTitle && !isAppChrome;
        })
        : classified;
      setLines(mode === "conversation" ? transcriptLines : classified);
      setNamesText(formatBrowserScreenNameCandidates(classified));
      if (mode === "conversation") {
        const title = titleCandidate?.text.replace(/\s+/g, " ").trim() ?? "";
        const matchedId = title ? findBrowserCustomerTitleMatch(title, customers) : undefined;
        setConversationTitle(title);
        setCustomerId(matchedId ?? "");
        setStatus(classified.length
          ? title && isLikelyGroupConversationTitle(title)
            ? `识别到的会话标题「${title}」带群聊标记，已阻止按单聊导入；请切换到单聊后重读。`
          : title
            ? matchedId
              ? `OCR 完成：会话标题「${title}」唯一匹配到客户；请核对发言内容后导入。`
              : `OCR 完成：识别到会话标题「${title}」，未匹配现有客户；确认名称后可新建客户。`
            : "OCR 完成，但没有可靠读出顶部会话名；请选择客户或人工填写名称，避免沿用旧客户。"
          : "OCR 没识别到文字；请重新框选并确保界面清晰。 ");
      } else {
        setConversationTitle("");
        setCustomerId("");
        setStatus(classified.length ? `OCR 完成：识别到 ${classified.length} 行；请检查名称，并手动排除群聊或非客户项。` : "OCR 没识别到文字；请重新框选并确保界面清晰。 ");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus("OCR 未完成；截图未离开本机。");
    } finally {
      setBusy(false);
    }
  }

  function updateLine(id: string, update: Partial<BrowserScreenOcrLine>) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...update } : line));
  }

  function useConversation() {
    const transcript = buildBrowserScreenTranscript(lines);
    const newCustomerName = conversationTitle.trim();
    if (!customerId && !newCustomerName) { setError("请选择已登记客户，或填写 OCR 没有识别到的会话名称。"); return; }
    if (!transcript || !lines.some((line) => line.speaker === "customer")) {
      setError("至少确认一条客户发言后才能导入；日期/时间默认忽略，未确认文本不会作为客户原话。");
      return;
    }
    onImportConversation(customerId || undefined, transcript, customerId ? undefined : newCustomerName);
    onClose();
  }

  function importCustomerNames() {
    const count = onImportCustomers(namesText.split(/\r?\n/).map((name) => name.trim()).filter(Boolean));
    setStatus(count ? `已添加 ${count} 位客户候选；请继续核对是否为单聊。` : "没有可导入的新名称；可能为空、重复、系统项或带有明确群聊标记。");
    if (count) onClose();
  }

  const canUseConversation = Boolean((customerId || conversationTitle.trim()) && !isLikelyGroupConversationTitle(conversationTitle) && lines.some((line) => line.speaker === "customer"));
  return <div className="modal-backdrop browser-screen-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="browser-screen-dialog" role="dialog" aria-modal="true" aria-labelledby="browser-screen-title">
      <header className="browser-screen-header"><div><span className="overline">LOCAL SCREEN OCR</span><h2 id="browser-screen-title">读取聊天窗口 · 网页本机模式</h2><p>适用于企业微信及其他桌面聊天 App；截图和 OCR 在本机处理。</p></div><button className="dialog-close" type="button" aria-label="关闭屏幕识别" disabled={busy} onClick={onClose}>×</button></header>
      <div className="browser-screen-body">
        <div className="browser-screen-modes" role="tablist" aria-label="选择读取内容">
          <button type="button" role="tab" aria-selected={mode === "conversation"} className={mode === "conversation" ? "is-active" : ""} onClick={() => { setMode("conversation"); setLines([]); setCustomerId(""); setConversationTitle(""); }}>读取聊天</button>
          <button type="button" role="tab" aria-selected={mode === "customers"} className={mode === "customers" ? "is-active" : ""} onClick={() => { setMode("customers"); setLines([]); setCustomerId(""); setConversationTitle(""); }}>读取可见名单</button>
        </div>
        <div className="browser-screen-privacy"><strong>需要你逐次授权</strong><span>点击下方后，在浏览器弹窗中手动选择要共享的窗口；每次只截一帧，不会持续录屏、上传、滚动或操作聊天 App。首次 OCR 会联网加载并缓存中文识别模块/模型，截图内容不上传。</span></div>
        <div className="browser-screen-toolbar"><button type="button" className="primary-button small-button" onClick={() => void chooseWindow()} disabled={busy}><span aria-hidden="true">▣</span>{frame ? "重新选择窗口" : "选择聊天窗口"}</button><button type="button" className="text-button" onClick={() => void runOcr()} disabled={busy || !frame}>{busy && progress > 0 ? `本机 OCR ${progress}%` : "识别选中区域"}</button><span>{mode === "conversation" ? "框选聊天标题 + 消息区，排除左侧名单" : "框选左侧会话名单，之后逐行核对"}</span></div>
        {frame && <div className="browser-screen-capture-preview">
          <div className="browser-screen-preview-heading"><strong>截图预览 · 拖动框选</strong><small>{frame.width} × {frame.height} · 仅当前页面内存</small></div>
          <div className="browser-screen-image-stage" style={{ aspectRatio: `${frame.width} / ${frame.height}`, maxWidth: `min(100%, ${(frame.width / frame.height) * 35}vh)` }} onPointerDown={beginSelection} onPointerMove={moveSelection} onPointerUp={finishSelection} onPointerCancel={finishSelection}>
            <img src={frame.imageDataUrl} alt="本机屏幕截图预览" draggable={false} />
            <div className="browser-screen-selection" style={{ left: `${region.left / frame.width * 100}%`, top: `${region.top / frame.height * 100}%`, width: `${region.width / frame.width * 100}%`, height: `${region.height / frame.height * 100}%` }} />
          </div>
        </div>}
        {status && <div className="browser-screen-status" role="status">{status}</div>}
        {error && <div className="browser-screen-error" role="alert">{error}</div>}
        {lines.length > 0 && mode === "conversation" && <>
          <label className="browser-screen-customer"><span>会话名称（OCR 候选，可修改）</span><input aria-label="编辑 OCR 会话名称" value={conversationTitle} onChange={(event) => { const value = event.currentTarget.value; const matchedId = findBrowserCustomerTitleMatch(value, customers); setConversationTitle(value); setCustomerId(matchedId ?? ""); setStatus(matchedId ? `会话名称已唯一匹配到「${customers.find((customer) => customer.profile.id === matchedId)?.profile.name ?? value}」。` : value ? "会话名称未精确匹配客户；核对后会创建新客户，或从下方手动选择。" : "请手动选择客户，或填写会话名称。"); }} placeholder="建议框选聊天标题一起识别" /></label>
          <label className="browser-screen-customer"><span>客户归属</span><select aria-label="选择 OCR 聊天归属客户" value={customerId} onChange={(event) => { const id = event.currentTarget.value; setCustomerId(id); const selected = customers.find((customer) => customer.profile.id === id); if (selected) setStatus(`已手动选择「${selected.profile.name}」；请确认这是当前聊天对象。`); }}><option value="">未匹配；确认后按标题新建</option>{customers.map((customer) => <option key={customer.profile.id} value={customer.profile.id}>{customer.profile.name}</option>)}</select></label>
          <div className="browser-screen-lines" aria-label="逐条核对本机 OCR 结果">{lines.map((line) => <article className="browser-screen-line" key={line.id}>
            <label><span>识别文字</span><input aria-label="编辑识别文字" value={line.text} onChange={(event) => updateLine(line.id, { text: event.currentTarget.value })} /></label>
            <label className="browser-screen-speaker"><span>归属</span><select aria-label="选择识别行归属" value={line.speaker} onChange={(event) => updateLine(line.id, { speaker: event.currentTarget.value as BrowserScreenOcrSpeaker })}>{speakerOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <small>OCR {Math.round(line.confidence)}%</small>
          </article>)}</div>
          <div className="browser-screen-actions"><span>日期/时间默认忽略；低置信度行默认未确认。标题未唯一匹配时不会沿用旧客户；核对后可新建客户并载入草稿。</span><button type="button" className="primary-button small-button" disabled={busy || !canUseConversation} onClick={useConversation}>{customerId ? "载入所选客户草稿" : conversationTitle.trim() ? `新建「${conversationTitle.trim()}」并载入` : "选择客户后载入"}</button></div>
        </>}
        {lines.length > 0 && mode === "customers" && <div className="browser-screen-list-import">
          <label><span>名单候选 · 每行一位，导入前可修改</span><textarea value={namesText} onChange={(event) => setNamesText(event.currentTarget.value)} rows={6} /></label>
          <div className="browser-screen-actions"><span>最多 10 位；会跳过重复项及文本中明确标出的群聊/系统项。OCR 无法保证单聊身份，请逐行核对。</span><button type="button" className="primary-button small-button" disabled={busy || !namesText.trim()} onClick={importCustomerNames}>加入客户管理</button></div>
        </div>}
      </div>
    </section>
  </div>;
}
