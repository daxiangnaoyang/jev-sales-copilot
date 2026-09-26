import type { ProductFact, ProductImage, ProductWorkspace } from "./types";

export interface AgentProductIntakeFact {
  label: string;
  value: string;
  evidence: "text" | "image" | "uncertain";
}

export interface AgentProductIntakeResult {
  productName: string;
  category: string;
  audience: string;
  scene: string;
  summary: string;
  missingInfo: string[];
  facts: AgentProductIntakeFact[];
}

export function shouldUseLocalProductIntake(isDesktopApp: boolean, agentMode: string): boolean {
  void isDesktopApp;
  return agentMode === "demo";
}

export function needsExplicitProductName(workspace: ProductWorkspace, text: string, result: AgentProductIntakeResult): boolean {
  return Boolean(workspace.productName.trim() && workspace.facts.length > 0 && text.trim() && !result.productName.trim());
}

export function localProductIntake(text: string, imageCount: number): AgentProductIntakeResult {
  const missingInfo = ["当前未调用 Agent；自由文本未做语义整理，只有明确的「标签：内容」会进入事实卡。"];
  if (imageCount > 0) missingInfo.push("图片内容尚未识别；请配置支持图片输入的多模态 Agent 后重新提交");
  const result: AgentProductIntakeResult = {
    productName: "", category: "", audience: "", scene: "",
    summary: imageCount > 0
      ? `本机 Demo 已收集 ${imageCount} 张图片和本轮原文，但未调用 Agent，也未做语义或图片识别。`
      : "本机 Demo 已保留本轮原文；未调用 Agent，也未做语义识别。",
    missingInfo,
    facts: [],
  };
  const fieldNames: Record<string, "productName" | "category" | "audience" | "scene"> = {
    "产品名称": "productName", "产品名": "productName", "品类": "category", "目标人群": "audience", "目标客户": "audience", "使用场景": "scene",
  };
  const lines = text.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const rawLine of lines) {
    const line = rawLine.replace(/^(?:[•*\-]\s*|\d+[.、]\s*)/, "").trim();
    const match = line.match(/^([^：:]{1,20})[：:]\s*(.+)$/);
    if (!match) continue;
    const label = match[1].trim();
    const value = match[2].trim();
    const field = fieldNames[label];
    if (field) result[field] = value.slice(0, 1200);
    else if (result.facts.length < 40) result.facts.push({ label, value: value.slice(0, 1200), evidence: "text" });
  }
  if (lines.length > 40 && result.facts.length >= 40) result.missingInfo.push("本机 Demo 最多提取 40 条明确标签；完整原文仍保留在对话记录");
  return result;
}

function intakeId(prefix: string): string {
  const randomId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomId}`;
}

export function applyAgentProductIntake(
  workspace: ProductWorkspace,
  text: string,
  images: ProductImage[],
  result: AgentProductIntakeResult,
  now = new Date().toISOString(),
  localMode = false,
): ProductWorkspace {
  const changedProduct = Boolean(result.productName.trim() && workspace.productName.trim()
    && result.productName.trim().toLocaleLowerCase() !== workspace.productName.trim().toLocaleLowerCase());
  const base = changedProduct ? {
    ...workspace,
    productName: "", category: "", audience: "", scene: "",
    facts: [], images: [], intakeMessages: [], outputs: [], selectedOutputId: undefined,
  } : workspace;
  const incomingFacts: ProductFact[] = result.facts
    .filter((fact) => fact.label.trim() && fact.value.trim())
    .map((fact, index) => ({
      id: intakeId(`fact-${index}`),
      label: fact.label.trim(),
      value: fact.value.trim(),
      status: "pending",
      source: fact.evidence === "text" ? "从本轮用户文字整理 · 待核对" : fact.evidence === "image" ? "从本轮图片识别 · 待核对" : "证据不明确，待补充",
    }));

  const facts = [...base.facts];
  for (const fact of incomingFacts) {
    const existingIndex = facts.findIndex((item) => item.label.trim().toLocaleLowerCase() === fact.label.toLocaleLowerCase());
    if (existingIndex < 0) facts.push(fact);
    else facts[existingIndex] = fact;
  }

  const addedImages = images.map((image) => ({ ...image, note: localMode ? "本机压缩保存；未上传或识别图片内容" : "本机压缩保存；本轮已按用户操作发送到当前 Agent 服务整理" }));
  const attachmentIds = addedImages.map((image) => image.id);
  const missingInfo = result.missingInfo.filter(Boolean);
  const filledFieldLabels = [
    [result.productName, "产品名称"],
    [result.category, "品类"],
    [result.audience, "目标人群"],
    [result.scene, "使用场景"],
  ].filter(([value]) => Boolean(value.trim())).map(([, label]) => label);
  const assistantText = [
    result.summary.trim() || "已整理本轮产品素材。",
    filledFieldLabels.length
      ? `${localMode ? "本机按明确标签回填" : "Agent 自动回填"}${filledFieldLabels.join("、")}。`
      : localMode ? "完整原文保留在本轮对话；未匹配的自由文本不会写入事实卡。" : "已把本轮可识别信息整理到事实卡；没有证据的字段留空。",
    missingInfo.length ? `待补充：${missingInfo.join("、")}` : "",
    localMode ? "图片内容未识别；配置多模态 Agent 后才能提取图中信息。" : "图片可见信息与文字事实已分开标记；生成前请核对事实卡。",
  ].filter(Boolean).join("\n");

  return {
    ...base,
    productName: result.productName.trim() || base.productName,
    category: result.category.trim() || base.category,
    audience: result.audience.trim() || base.audience,
    scene: result.scene.trim() || base.scene,
    facts,
    images: [...base.images.filter((image) => image.source === "local-upload"), ...addedImages],
    intakeMessages: [
      ...(base.intakeMessages ?? []),
      { id: intakeId("intake-user"), role: "user", text: text.trim(), attachmentIds, createdAt: now },
      { id: intakeId("intake-agent"), role: "assistant", text: assistantText, createdAt: now },
    ],
    outputs: [],
    selectedOutputId: undefined,
    status: "COLLECTING",
  };
}

export function confirmAgentProductFacts(workspace: ProductWorkspace): ProductWorkspace {
  return {
    ...workspace,
    facts: workspace.facts.map((fact) => {
      if (fact.status !== "pending") return fact;
      if (fact.source.includes("用户文字整理")) return { ...fact, status: "provided" };
      if (fact.source.includes("用户批量编辑")) return { ...fact, status: "provided" };
      if (fact.source.includes("用户手动编辑")) return { ...fact, status: "provided" };
      if (fact.source.includes("图片识别")) return { ...fact, status: "visible" };
      return fact;
    }),
    status: "READY_FOR_REVIEW",
  };
}

export function hasConfirmableProductFacts(workspace: ProductWorkspace): boolean {
  return workspace.facts.some((fact) => fact.status === "pending" && (
    fact.source.includes("用户文字整理")
    || fact.source.includes("用户批量编辑")
    || fact.source.includes("用户手动编辑")
    || fact.source.includes("图片识别")
  ));
}
