import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBrowserScreenTranscript,
  classifyBrowserScreenOcrLines,
  detectBrowserConversationTitle,
  findBrowserCustomerTitleMatch,
  formatBrowserScreenNameCandidates,
  isLikelyGroupConversationTitle,
} from "../src/browser-screen-reader-utils.ts";
import { describeDisplayCaptureError } from "../src/browser-screen-capture.ts";

const line = (text, x0, x1, confidence = 90, y0 = 20) => ({
  text,
  confidence,
  bbox: { x0, y0, x1, y1: y0 + 18 },
});

test("screen OCR proposes sides from bubble position and ignores date/time metadata", () => {
  const result = classifyBrowserScreenOcrLines([
    line("昨天 09:12", 300, 430, 90, 20),
    line("请问这款产品有现货吗？", 60, 250, 90, 50),
    line("我先帮您确认库存。", 620, 790, 90, 80),
    line("模糊文字", 40, 120, 42, 110),
  ], 800);

  assert.deepEqual(result.map(({ text, speaker }) => [text, speaker]), [
    ["昨天 09:12", "ignore"],
    ["请问这款产品有现货吗？", "customer"],
    ["我先帮您确认库存。", "seller"],
    ["模糊文字", "unknown"],
  ]);
});

test("browser OCR transcript preserves user-reviewed speaker labels and excludes ignored rows", () => {
  const lines = classifyBrowserScreenOcrLines([
    line("2026-09-26", 200, 350),
    line("客户问候", 20, 100),
    line("销售回复", 300, 390),
  ], 400);

  assert.equal(buildBrowserScreenTranscript(lines), "客户：客户问候\n我：销售回复");
  assert.equal(formatBrowserScreenNameCandidates(lines), "客户问候\n销售回复");
});

test("screen OCR keeps empty and line metadata out of customer-name candidates", () => {
  const lines = classifyBrowserScreenOcrLines([
    line("", 10, 20),
    line("10:30", 10, 20),
    line("沈宁", 10, 60),
  ], 200);

  assert.equal(formatBrowserScreenNameCandidates(lines), "沈宁");
});

test("conversation mode separates the top header from messages and suggests a unique exact customer match", () => {
  const recognized = [
    line("企业微信", 8, 95, 97, 4),
    line("林然", 120, 180, 93, 32),
    line("今天 10:10", 180, 250, 98, 72),
    line("你好，想问下产品价格", 20, 280, 96, 190),
    line("我先确认你的配置", 540, 780, 95, 270),
  ];
  const title = detectBrowserConversationTitle(recognized, 800);
  const classified = classifyBrowserScreenOcrLines(recognized, 800, 800);

  assert.equal(title?.text, "林然");
  assert.equal(classified.find(({ text }) => text === "林然")?.speaker, "unknown");
  assert.equal(classified.find(({ text }) => text === "今天 10:10")?.speaker, "ignore");
  assert.equal(findBrowserCustomerTitleMatch(title.text, [
    { profile: { id: "customer-1", name: "林然" }, sourceConversationTitle: "林然" },
  ]), "customer-1");
  assert.equal(findBrowserCustomerTitleMatch(title.text, [
    { profile: { id: "customer-1", name: "林然" } },
    { profile: { id: "customer-2", name: "林然" } },
  ]), undefined);
  assert.equal(isLikelyGroupConversationTitle("产品交流群"), true);
  assert.equal(isLikelyGroupConversationTitle("项目讨论组 (12)"), true);
  assert.equal(isLikelyGroupConversationTitle("林然"), false);
});

test("screen sharing errors explain browser user-gesture and permission requirements", () => {
  assert.match(describeDisplayCaptureError(new Error("Invalid state")), /鼠标直接点击/);
  assert.match(describeDisplayCaptureError(new Error("Permission denied")), /取消了浏览器选择器/);
});
