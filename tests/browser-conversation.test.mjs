import test from "node:test";
import assert from "node:assert/strict";
import { appendBrowserTranscript, parseBrowserTranscript, parseLabeledWeChatTranscript } from "../src/browser-conversation.ts";

test("browser transcript import ignores standalone dates and times and preserves customer and seller turns", () => {
  assert.deepEqual(parseBrowserTranscript(`2026年9月26日\n9月26日\n10:20\n客户：想了解这款产品，价格是多少？\n10:21\n我：我先确认你的使用场景，再给你准确介绍。\n今天 10:22\n客户：主要拍产品图，预算一万元左右。`), [
    { sender: "customer", text: "想了解这款产品，价格是多少？" },
    { sender: "seller", text: "我先确认你的使用场景，再给你准确介绍。" },
    { sender: "customer", text: "主要拍产品图，预算一万元左右。" },
  ]);
});

test("browser transcript import appends distinct turns to the selected customer's conversation", () => {
  const result = appendBrowserTranscript([], "客户：你们有产品介绍图吗？\n我：有，我整理一份给你。\n客户：也请发下价格。", "2026-09-26T10:00:00.000Z");

  assert.ok(result);
  assert.deepEqual(result.messages.map(({ sender, text }) => [sender, text]), [
    ["customer", "你们有产品介绍图吗？"],
    ["seller", "有，我整理一份给你。"],
    ["customer", "也请发下价格。"],
  ]);
  assert.equal(new Set(result.messages.map(({ id }) => id)).size, 3);
  assert.equal(result.latestCustomerText, "也请发下价格。");
});

test("unlabeled browser paste is treated as customer text, while seller-only transcript is not analyzed", () => {
  assert.deepEqual(parseBrowserTranscript("客户问我什么时候可以发货？"), [
    { sender: "customer", text: "客户问我什么时候可以发货？" },
  ]);
  assert.equal(appendBrowserTranscript([], "我：我稍后给你回复。", "2026-09-26T10:00:00.000Z"), null);
});

test("unlabeled native OCR text is not promoted to a customer message", () => {
  assert.deepEqual(parseLabeledWeChatTranscript("2026年9月26日\n10:20\n一段无法确认发言人的 OCR 文本"), []);
});
