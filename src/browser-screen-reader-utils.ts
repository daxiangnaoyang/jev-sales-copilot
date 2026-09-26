export type BrowserScreenOcrSpeaker = "customer" | "seller" | "unknown" | "ignore";

export function isDateOrTimeLine(line: string): boolean {
  const value = line.trim().replace(/^[\[【(（]|[\]】)）]$/g, "");
  return /^(?:\d{4}\s*[年./-]\s*\d{1,2}\s*(?:月|[./-])\s*\d{1,2}\s*日?(?:\s+.*)?|\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s+.*)?|\d{1,2}:\d{2}(?::\d{2})?|(?:今天|昨天|前天|星期[一二三四五六日天])(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)$/.test(value);
}

export interface BrowserScreenOcrLineInput {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface BrowserScreenOcrLine extends BrowserScreenOcrLineInput {
  id: string;
  speaker: BrowserScreenOcrSpeaker;
}

export interface BrowserCustomerTitleMatch {
  profile: { id: string; name: string };
  sourceConversationTitle?: string;
}

const nonContactHeaderLabels = new Set([
  "微信", "企业微信", "wechat", "wecom", "聊天", "聊天记录", "聊天信息", "聊天详情",
  "搜索", "消息", "联系人", "通讯录", "文件", "更多", "视频通话", "语音通话",
]);

export function isBrowserNonContactHeaderLabel(value: string): boolean {
  return nonContactHeaderLabels.has(normalizeBrowserCustomerTitle(value));
}

export function normalizeBrowserCustomerTitle(title: string): string {
  return title.trim().toLocaleLowerCase().replace(/\s+/g, "");
}

export function isLikelyGroupConversationTitle(title: string): boolean {
  const normalized = normalizeBrowserCustomerTitle(title);
  return ["群", "@chatroom", "chatroom", "多人聊天", "群组", "group"].some((marker) => normalized.includes(marker))
    || /[（(]\s*\d+\s*[）)]$/.test(title.trim());
}

export function findBrowserCustomerTitleMatch(title: string, customers: BrowserCustomerTitleMatch[]): string | undefined {
  const normalized = normalizeBrowserCustomerTitle(title);
  if (!normalized) return undefined;
  const matches = customers.filter((customer) => [customer.sourceConversationTitle, customer.profile.name]
    .filter((candidate): candidate is string => Boolean(candidate))
    .some((candidate) => normalizeBrowserCustomerTitle(candidate) === normalized));
  const uniqueIds = [...new Set(matches.map((customer) => customer.profile.id))];
  return uniqueIds.length === 1 ? uniqueIds[0] : undefined;
}

export function detectBrowserConversationTitle(
  lines: BrowserScreenOcrLineInput[],
  cropHeight: number,
): BrowserScreenOcrLineInput | undefined {
  if (cropHeight <= 0) return undefined;
  return lines
    .filter((line) => {
      const text = line.text.replace(/\s+/g, " ").trim();
      return text.length > 0
        && [...text].length <= 30
        && line.confidence >= 55
        && line.bbox.y0 <= cropHeight * 0.22
        && !isDateOrTimeLine(text)
        && !nonContactHeaderLabels.has(normalizeBrowserCustomerTitle(text));
    })
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)[0];
}

export function classifyBrowserScreenOcrLines(
  lines: BrowserScreenOcrLineInput[],
  cropWidth: number,
  cropHeight?: number,
): BrowserScreenOcrLine[] {
  return lines
    .map((line, index) => {
      const text = line.text.replace(/\s+/g, " ").trim();
      if (!text) return undefined;
      const centerX = (line.bbox.x0 + line.bbox.x1) / 2;
      const speaker: BrowserScreenOcrSpeaker = isDateOrTimeLine(text)
        ? "ignore"
        : cropHeight && line.bbox.y0 <= cropHeight * 0.22
          ? "unknown"
        : line.confidence < 55
          ? "unknown"
          : centerX < cropWidth * 0.5 ? "customer" : "seller";
      return { ...line, text, id: `screen-ocr-${index}`, speaker };
    })
    .filter((line): line is BrowserScreenOcrLine => Boolean(line))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
}

export function buildBrowserScreenTranscript(lines: BrowserScreenOcrLine[]): string {
  return lines
    .filter((line) => line.speaker !== "ignore" && line.text.trim())
    .map((line) => `${line.speaker === "customer" ? "客户" : line.speaker === "seller" ? "我" : "未确认"}：${line.text.trim()}`)
    .join("\n");
}

export function formatBrowserScreenNameCandidates(lines: BrowserScreenOcrLine[]): string {
  return lines
    .filter((line) => line.speaker !== "ignore")
    .map((line) => line.text.trim())
    .filter((line) => Boolean(line) && !isBrowserNonContactHeaderLabel(line))
    .join("\n");
}
