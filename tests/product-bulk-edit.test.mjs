import test from "node:test";
import assert from "node:assert/strict";
import { applyProductFactsBulkEdit, formatProductFactsForBulkEdit } from "../src/product-bulk-edit.ts";
import { defaultProductWorkspace } from "../src/product.ts";

const old = {
  ...defaultProductWorkspace,
  productName: "iPhone 旗舰",
  category: "手机",
  audience: "数码用户",
  facts: [
    { id: "camera", label: "影像", value: "三摄", status: "provided", source: "用户文字" },
    { id: "price", label: "价格", value: "9999 元", status: "pending", source: "待核对" },
  ],
  images: [{ id: "old-image", name: "iphone.jpg", source: "local-upload", previewUrl: "data:image/jpeg;base64,a" }],
  intakeMessages: [{ id: "old-message", role: "user", text: "旧产品", createdAt: "2026-09-25T00:00:00Z" }],
  outputs: [{ id: "old-output", type: "recommendation", title: "旧文案", status: "DRAFT", text: "旧文案", factIds: ["camera"] }],
};

test("bulk editor formats a whole fact card into one editable block", () => {
  assert.match(formatProductFactsForBulkEdit(old), /产品名称：iPhone 旗舰/);
  assert.match(formatProductFactsForBulkEdit(old), /影像：三摄/);
  assert.match(formatProductFactsForBulkEdit(old), /价格：9999 元/);
});

test("one bulk apply replaces old product facts, media and output after confirmation", () => {
  const next = applyProductFactsBulkEdit(old, "产品名称：便携咖啡机\n品类：小家电\n价格：999 元\n卖点：轻巧便携");
  assert.equal(next.productName, "便携咖啡机");
  assert.equal(next.category, "小家电");
  assert.equal(next.audience, "");
  assert.deepEqual(next.facts.map((fact) => fact.label), ["价格", "卖点"]);
  assert.deepEqual(next.facts.map((fact) => fact.status), ["pending", "pending"]);
  assert.equal(next.images.length, 0);
  assert.equal(next.intakeMessages.length, 0);
  assert.equal(next.outputs.length, 0);
});

test("same-product batch edit retains unchanged fact review status and invalidates changed facts", () => {
  const next = applyProductFactsBulkEdit(old, "产品名称：iPhone 旗舰\n品类：手机\n目标人群：数码用户\n影像：三摄\n价格：8999 元");
  assert.deepEqual(next.facts.map((fact) => [fact.id, fact.status]), [["camera", "provided"], ["price", "pending"]]);
  assert.equal(next.facts[1].value, "8999 元");
  assert.equal(next.images.length, 1);
  assert.equal(next.outputs.length, 0);
});

test("invalid bulk text is rejected rather than silently deleting existing facts", () => {
  assert.throws(() => applyProductFactsBulkEdit(old, "新卖点没有冒号"), /第 1 行/);
  assert.equal(old.facts.length, 2);
});
