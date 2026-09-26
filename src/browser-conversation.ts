import type { CustomerMessage } from "./types";

export type BrowserTranscriptTurn = {
  sender: CustomerMessage["sender"];
  text: string;
};

export type BrowserTranscriptImport = {
  messages: CustomerMessage[];
  latestCustomerText: string;
};

function isDateOrTimeLine(line: string): boolean {
  const value = line.trim().replace(/^[\[【(（]|[\]】)）]$/g, "");
  return /^(?:\d{4}\s*[年./-]\s*\d{1,2}\s*(?:月|[./-])\s*\d{1,2}\s*日?(?:\s+.*)?|\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s+.*)?|\d{1,2}:\d{2}(?::\d{2})?|(?:今天|昨天|前天|星期[一二三四五六日天])(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)$/.test(value);
}

function parseTranscript(input: string, assumePlainTextIsCustomer: boolean): BrowserTranscriptTurn[] {
  const turns: BrowserTranscriptTurn[] = [];
  let hasSpeakerLabel = false;

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || isDateOrTimeLine(line)) continue;

    const match = line.match(/^(客户|对方|我|销售|未确认)[：:](.*)$/);
    if (match) {
      hasSpeakerLabel = true;
      const sender: CustomerMessage["sender"] = match[1] === "客户" || match[1] === "对方"
        ? "customer"
        : match[1] === "我" || match[1] === "销售"
          ? "seller"
          : "transcript";
      const text = match[2].trim();
      if (text) turns.push({ sender, text });
      continue;
    }

    if (turns.length) turns[turns.length - 1].text += `\n${line}`;
  }

  if (hasSpeakerLabel || !assumePlainTextIsCustomer) return turns;

  const plainText = input.split(/\r?\n/).filter((line) => !isDateOrTimeLine(line)).join("\n").trim();
  return plainText ? [{ sender: "customer", text: plainText }] : [];
}

export function parseBrowserTranscript(input: string): BrowserTranscriptTurn[] {
  return parseTranscript(input, true);
}

export function parseLabeledWeChatTranscript(input: string): BrowserTranscriptTurn[] {
  return parseTranscript(input, false);
}

export function appendBrowserTranscript(
  existingMessages: CustomerMessage[],
  transcript: string,
  createdAt = new Date().toISOString(),
): BrowserTranscriptImport | null {
  const turns = parseBrowserTranscript(transcript);
  const latestCustomerText = [...turns].reverse().find((turn) => turn.sender === "customer")?.text.trim();
  if (!latestCustomerText) return null;

  const messages = turns.map((turn) => ({
    id: `browser-message-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)}`,
    sender: turn.sender,
    text: turn.text,
    createdAt,
  }));
  return {
    messages: [...existingMessages, ...messages],
    latestCustomerText,
  };
}
