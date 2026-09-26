export type WeChatCustomerRef = {
  profile: { id: string; name: string };
  sourceConversationTitle?: string;
};

export type WeChatCustomerResolution =
  | { kind: "matched"; customerId: string }
  | { kind: "review" }
  | { kind: "create"; name: string };

export function canSkipUnchangedAutomaticWeChatScan(
  scanSignature: string,
  lastAutomaticSignature: string,
  scannedCustomerId: string | undefined,
  selectedCustomerId: string,
): boolean {
  return scanSignature === lastAutomaticSignature
    && (!scannedCustomerId || scannedCustomerId === selectedCustomerId);
}

export function normalizeWeChatCustomerName(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, "");
}

const GROUP_MARKERS = ["群", "@chatroom", "chatroom", "多人聊天", "群组"];
const NON_CUSTOMER_NAMES = new Set([
  "微信",
  "wechat",
  "weixin",
  "搜索",
  "聊天",
  "通讯录",
  "文件传输助手",
  "服务通知",
  "微信团队",
  "订阅号",
  "服务号",
  "企业微信",
  "微信电脑版",
  "windows微信",
  "mac微信",
]);

export function resolveWeChatCustomer(
  title: string | undefined,
  confidence: number | undefined,
  customers: WeChatCustomerRef[],
): WeChatCustomerResolution {
  const name = title?.trim() ?? "";
  const normalized = normalizeWeChatCustomerName(name);
  if (!normalized || NON_CUSTOMER_NAMES.has(normalized)) return { kind: "review" };
  if (GROUP_MARKERS.some((marker) => normalized.includes(marker))) return { kind: "review" };

  if ((confidence ?? 0) >= 0.65) {
    const match = customers.find((item) =>
      normalizeWeChatCustomerName(item.sourceConversationTitle ?? item.profile.name) === normalized,
    );
    if (match) return { kind: "matched", customerId: match.profile.id };
  }

  const characterCount = [...name].length;
  const looksLikeDirectContact = characterCount > 0
    && characterCount <= 18
    && !name.endsWith("...")
    && ![...name].every((character) => /[0-9]/.test(character));
  if ((confidence ?? 0) >= 0.9 && looksLikeDirectContact) {
    return { kind: "create", name };
  }

  return { kind: "review" };
}

export function collectNewWeChatCustomerNames(
  candidates: string[],
  customers: WeChatCustomerRef[],
  limit = 10,
): string[] {
  const maxNames = Math.max(0, Math.floor(limit));
  if (maxNames === 0) return [];
  const seen = new Set(customers.map((item) =>
    normalizeWeChatCustomerName(item.sourceConversationTitle ?? item.profile.name),
  ));
  const added: string[] = [];
  for (const rawName of candidates) {
    const name = rawName.trim();
    const normalized = normalizeWeChatCustomerName(name);
    if (
      !name
      || !normalized
      || seen.has(normalized)
      || NON_CUSTOMER_NAMES.has(normalized)
      || GROUP_MARKERS.some((marker) => normalized.includes(marker))
    ) continue;
    seen.add(normalized);
    added.push(name);
    if (added.length >= maxNames) break;
  }
  return added;
}
