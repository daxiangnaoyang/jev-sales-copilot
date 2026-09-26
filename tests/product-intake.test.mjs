import test from "node:test";
import assert from "node:assert/strict";
import { applyAgentProductIntake, confirmAgentProductFacts, hasConfirmableProductFacts, localProductIntake, needsExplicitProductName, shouldUseLocalProductIntake } from "../src/product-intake.ts";
import { defaultProductWorkspace, buildProductOutputs, normalizeProductWorkspace } from "../src/product.ts";
import { buildVideoGenerationPrompt } from "../src/video-storyboard.ts";

const result = {
  productName: "便携咖啡机",
  category: "小家电",
  audience: "",
  scene: "",
  summary: "从文字中整理出品牌和电池规格，外观颜色来自图片。",
  missingInfo: ["售价"],
  facts: [
    { label: "电池", value: "2200mAh", evidence: "text" },
    { label: "颜色", value: "雾蓝色机身", evidence: "image" },
    { label: "续航", value: "可连续制作 20 杯", evidence: "uncertain" },
  ],
};

test("one intake turn stores multiple local images and maps evidence to fact review status", () => {
  const images = ["a.jpg", "b.jpg"].map((name, index) => ({
    id: `image-${index}`,
    name,
    previewUrl: `data:image/jpeg;base64,${index}`,
    source: "local-upload",
    note: "local",
  }));
  const workspace = applyAgentProductIntake(defaultProductWorkspace, "产品名：便携咖啡机\n电池：2200mAh", images, result, "2026-09-25T00:00:00.000Z");

  assert.equal(workspace.productName, "便携咖啡机");
  assert.deepEqual(workspace.facts.map((fact) => [fact.label, fact.status]), [
    ["电池", "pending"],
    ["颜色", "pending"],
    ["续航", "pending"],
  ]);
  assert.equal(workspace.images.length, 2);
  assert.deepEqual(workspace.intakeMessages.map((message) => message.role), ["user", "assistant"]);
  assert.deepEqual(workspace.intakeMessages[0].attachmentIds, ["image-0", "image-1"]);
  assert.match(workspace.intakeMessages[1].text, /售价/);
  assert.equal(hasConfirmableProductFacts(workspace), true);
  const confirmed = confirmAgentProductFacts(workspace);
  assert.deepEqual(confirmed.facts.map((fact) => fact.status), ["provided", "visible", "pending"]);
  assert.equal(confirmed.status, "READY_FOR_REVIEW");
  assert.ok(buildProductOutputs(confirmed).some((output) => output.cards?.some((card) => card.sourceImageId === "image-1")));
  assert.equal(hasConfirmableProductFacts(confirmed), false);
});

test("one-click confirmation keeps uncertain evidence pending", () => {
  const workspace = applyAgentProductIntake(defaultProductWorkspace, "", [], {
    ...result,
    facts: [{ label: "续航", value: "可连续制作 20 杯", evidence: "uncertain" }],
  }, "2026-09-25T00:00:00.000Z");
  assert.equal(hasConfirmableProductFacts(workspace), false);
  assert.equal(confirmAgentProductFacts(workspace).facts[0].status, "pending");
  assert.equal(confirmAgentProductFacts(workspace).status, "READY_FOR_REVIEW");
});

test("manually edited facts can be one-click confirmed with the user as the new evidence source", () => {
  const workspace = applyAgentProductIntake(defaultProductWorkspace, "产品名称：咖啡机", [], {
    ...result,
    productName: "咖啡机",
    facts: [{ label: "价格", value: "899 元", evidence: "text" }],
  });
  const edited = {
    ...workspace,
    facts: [{ ...workspace.facts[0], value: "999 元", source: "用户手动编辑 · 待核对" }],
  };
  assert.equal(hasConfirmableProductFacts(edited), true);
  assert.equal(confirmAgentProductFacts(edited).facts[0].status, "provided");
});

test("a later intake updates a matching fact without duplicating the label", () => {
  const first = applyAgentProductIntake(defaultProductWorkspace, "售价 100 元", [], result, "2026-09-25T00:00:00.000Z");
  const second = applyAgentProductIntake(first, "售价改为 120 元", [], {
    ...result,
    productName: "",
    category: "",
    summary: "更新价格信息",
    facts: [{ label: "电池", value: "2400mAh", evidence: "text" }],
  }, "2026-09-25T00:01:00.000Z");

  assert.equal(second.facts.filter((fact) => fact.label === "电池").length, 1);
  assert.equal(second.facts.find((fact) => fact.label === "电池")?.value, "2400mAh");
  assert.equal(second.productName, "便携咖啡机");
  assert.equal(second.intakeMessages.length, 4);
});

test("Demo intake is local while browser cloud intake can call the selected Agent API", () => {
  assert.equal(shouldUseLocalProductIntake(false, "demo"), true);
  assert.equal(shouldUseLocalProductIntake(false, "openai"), false);
  assert.equal(shouldUseLocalProductIntake(true, "demo"), true);
  assert.equal(shouldUseLocalProductIntake(true, "openai"), false);
});

test("legacy horizontal video directions migrate to the supported exact 15-second option", () => {
  assert.equal(normalizeProductWorkspace({ ...defaultProductWorkspace, videoDirection: "横版 16:9 · 5—10 秒" }).videoDirection, "横版 16:9 · 15 秒");
});

test("legacy fixed phone storyboard is marked stale and cannot be mistaken for a generic product script", () => {
  const legacy = {
    ...defaultProductWorkspace,
    outputs: [{
      id: "legacy-video", type: "video-script", title: "15 秒卖点视频脚本", status: "READY_FOR_REVIEW",
      factIds: [], scenes: [{ id: "old", time: "0—2 秒", task: "钩子", visual: "展示摄像头模组", voiceover: "拍产品图，真正难的是把细节拍清楚", caption: "拍产品图", source: "旧模板" }],
    }],
  };
  assert.equal(normalizeProductWorkspace(legacy).outputs[0].stale, true);
});

test("new video storyboard is generic and only describes confirmed product facts", () => {
  const workspace = {
    ...defaultProductWorkspace,
    productName: "便携咖啡机",
    scene: "差旅途中",
    facts: [
      { id: "capacity", label: "容量", value: "120ml", status: "provided", source: "用户文字整理" },
      { id: "weight", label: "重量", value: "480 克", status: "pending", source: "待确认" },
    ],
  };
  const output = buildProductOutputs(workspace).find((item) => item.type === "video-script");
  assert.equal(output.scenes.length, 6);
  assert.match(output.scenes[2].voiceover, /容量：120ml/);
  assert.doesNotMatch(JSON.stringify(output.scenes), /拍产品图|摄像头模组|设备回到桌面|480 克/);
  assert.deepEqual(output.factIds, ["capacity"]);
});

test("local intake preserves only explicitly supplied text and does not invent image facts", () => {
  const result = localProductIntake("产品名称：便携咖啡机\n价格：999 元\n续航：未确认", 2);
  assert.equal(result.productName, "便携咖啡机");
  assert.deepEqual(result.facts.map((fact) => [fact.label, fact.value, fact.evidence]), [
    ["价格", "999 元", "text"],
    ["续航", "未确认", "text"],
  ]);
  assert.match(result.summary, /未做语义或图片识别/);
  assert.ok(result.missingInfo.some((item) => item.includes("图片")));
});

test("local Demo does not turn unstructured prose into product facts", () => {
  const text = Array.from({ length: 45 }, (_, index) => `第 ${index + 1} 段是一段需要 Agent 理解的产品介绍。`).join("\n");
  const result = localProductIntake(text, 1);
  assert.deepEqual(result.facts, []);
  assert.match(result.summary, /未调用 Agent/);
  assert.ok(result.missingInfo.some((item) => item.includes("自由文本未做语义整理")));
  assert.ok(result.missingInfo.some((item) => item.includes("图片内容尚未识别")));
});

test("local Demo only extracts explicit label-value lines", () => {
  const result = localProductIntake("产品名称：便携咖啡机\n这是一段介绍，不能被拆成卖点。\n价格：999 元", 0);
  assert.equal(result.productName, "便携咖啡机");
  assert.deepEqual(result.facts.map(({ label, value }) => [label, value]), [["价格", "999 元"]]);
});

test("local image-only intake saves pictures without claiming visual analysis or upload", () => {
  const result = localProductIntake("", 1);
  const workspace = applyAgentProductIntake(defaultProductWorkspace, "", [{
    id: "image-local", name: "phone.jpg", previewUrl: "data:image/jpeg;base64,abc", source: "local-upload", note: "pending",
  }], result, "2026-09-25T00:00:00.000Z", true);
  assert.equal(workspace.images.length, 1);
  assert.match(workspace.images[0].note, /未上传或识别/);
  assert.equal(workspace.facts.length, 0);
  assert.match(workspace.intakeMessages[1].text, /图片内容未识别/);
});

test("a named new product starts a fresh fact card instead of mixing old product claims", () => {
  const old = {
    ...defaultProductWorkspace,
    productName: "iPhone 旗舰",
    category: "手机",
    facts: [{ id: "old", label: "屏幕", value: "6.9 英寸", status: "provided", source: "旧素材" }],
    outputs: [{ id: "old-output", type: "recommendation", title: "旧推荐", status: "DRAFT", text: "旧文案", factIds: ["old"] }],
  };
  const result = localProductIntake("产品名称：便携咖啡机\n价格：999 元", 0);
  const next = applyAgentProductIntake(old, "产品名称：便携咖啡机\n价格：999 元", [], result);
  assert.equal(next.productName, "便携咖啡机");
  assert.equal(next.category, "");
  assert.deepEqual(next.facts.map((fact) => fact.label), ["价格"]);
  assert.equal(next.outputs.length, 0);
});

test("local freeform text cannot silently merge into an existing named product", () => {
  const workspace = { ...defaultProductWorkspace, productName: "iPhone 旗舰", facts: [{ id: "old", label: "影像", value: "三摄", status: "provided", source: "旧素材" }] };
  assert.equal(needsExplicitProductName(workspace, "这是一款新的咖啡机。", localProductIntake("这是一款新的咖啡机。", 0)), true);
  assert.equal(needsExplicitProductName(workspace, "产品名称：iPhone 旗舰", localProductIntake("产品名称：iPhone 旗舰", 0)), false);
});

test("storyboard conversion preserves shot order, exact timings, narration and captions", () => {
  const prompt = buildVideoGenerationPrompt({
    ...defaultProductWorkspace,
    productName: "便携咖啡机",
    videoDirection: "竖版 9:16 · 15 秒",
  }, {
    id: "video-script",
    type: "video-script",
    title: "15 秒卖点视频脚本",
    status: "READY_FOR_REVIEW",
    factIds: ["battery"],
    scenes: [
      { id: "s1", time: "0—2 秒", task: "钩子", visual: "产品由暗到亮出现", voiceover: "出差也能喝一杯好咖啡", caption: "随时来一杯", source: "已确认" },
      { id: "s2", time: "2—5 秒", task: "卖点", visual: "展示机身大小", voiceover: "小巧便携", caption: "轻巧随行", source: "已确认" },
    ],
  });
  assert.ok(prompt.indexOf("0—2 秒") < prompt.indexOf("2—5 秒"));
  assert.match(prompt, /出差也能喝一杯好咖啡/);
  assert.match(prompt, /字幕文案：轻巧随行/);
  assert.match(prompt, /不要虚构未在分镜或参考图中提供的产品功能/);
});

test("storyboard conversion refuses non-video outputs and empty scene lists", () => {
  assert.throws(() => buildVideoGenerationPrompt(defaultProductWorkspace, {
    id: "copy", type: "recommendation", title: "推荐语", status: "DRAFT", text: "介绍", factIds: [],
  }), /视频脚本/);
  assert.throws(() => buildVideoGenerationPrompt(defaultProductWorkspace, {
    id: "video-empty", type: "video-script", title: "视频", status: "DRAFT", scenes: [], factIds: [],
  }), /至少要有一个分镜/);
});
