import test from "node:test";
import assert from "node:assert/strict";
import {
  canSkipUnchangedAutomaticWeChatScan,
  collectNewWeChatCustomerNames,
  resolveWeChatCustomer,
} from "../src/wechat-customer-resolution.ts";

const customers = [
  { profile: { id: "customer-1", name: "林然" }, sourceConversationTitle: "林然" },
  { profile: { id: "customer-2", name: "旧备注名" }, sourceConversationTitle: "可可" },
];

test("high-confidence unknown direct-chat title is auto-added for confirmation", () => {
  assert.deepEqual(resolveWeChatCustomer("禾", 1, customers), { kind: "create", name: "禾" });
});

test("high-confidence existing contact maps to its stable customer id", () => {
  assert.deepEqual(resolveWeChatCustomer("可 可", 0.98, customers), { kind: "matched", customerId: "customer-2" });
});

test("an unchanged scan is reprocessed when the active customer changed", () => {
  assert.equal(canSkipUnchangedAutomaticWeChatScan("scan-1", "scan-1", "customer-2", "customer-2"), true);
  assert.equal(canSkipUnchangedAutomaticWeChatScan("scan-1", "scan-1", "customer-2", "customer-1"), false);
});

test("low-confidence and explicit group/system titles never auto-create a customer", () => {
  assert.deepEqual(resolveWeChatCustomer("新客户", 0.7, customers), { kind: "review" });
  assert.deepEqual(resolveWeChatCustomer("新客户", 0.89, customers), { kind: "review" });
  assert.deepEqual(resolveWeChatCustomer("摄影交流群", 1, customers), { kind: "review" });
  assert.deepEqual(resolveWeChatCustomer("文件传输助手", 1, customers), { kind: "review" });
  assert.deepEqual(resolveWeChatCustomer("12345", 1, customers), { kind: "review" });
});

test("visible-list refresh deduplicates existing names and keeps only the first ten candidates", () => {
  const candidates = ["林然", " 新联系人 ", "新联系人", ...Array.from({ length: 10 }, (_, i) => `候选${i}`)];
  assert.deepEqual(collectNewWeChatCustomerNames(candidates, customers, 10), ["新联系人", ...Array.from({ length: 9 }, (_, i) => `候选${i}`)]);
  assert.deepEqual(collectNewWeChatCustomerNames(["摄影交流群", "微信", "有效联系人"], customers, 10), ["有效联系人"]);
  assert.deepEqual(collectNewWeChatCustomerNames(["有效联系人"], customers, 0), []);
});
