import type { ProductFact, ProductWorkspace } from "./types";

const cardFields = [
  ["产品名称", "productName"],
  ["品类", "category"],
  ["目标人群", "audience"],
  ["使用场景", "scene"],
] as const;

function oneLine(value: string): string {
  return value.replace(/\s*\r?\n\s*/g, " ").trim();
}

export function formatProductFactsForBulkEdit(workspace: ProductWorkspace): string {
  return [
    ...cardFields.map(([label, key]) => `${label}：${oneLine(workspace[key])}`),
    "",
    ...workspace.facts.map((fact) => `${oneLine(fact.label)}：${oneLine(fact.value)}`),
  ].join("\n").trimEnd();
}

export function applyProductFactsBulkEdit(workspace: ProductWorkspace, text: string): ProductWorkspace {
  if (!text.trim() || text.length > 12_000) throw new Error("批量内容须为 1—12,000 字。");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 60) throw new Error("批量内容最多 60 行，请分次整理。");

  const fields = { productName: "", category: "", audience: "", scene: "" };
  const factLines: Array<{ label: string; value: string }> = [];
  const labels = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^([^：:]{1,80})[：:]\s*(.*)$/);
    if (!match) throw new Error(`第 ${index + 1} 行缺少「标签：内容」，请修改后再应用。`);
    const label = match[1].trim();
    const value = match[2].trim();
    if (!label) throw new Error(`第 ${index + 1} 行缺少标签。`);
    if (value.length > 1200) throw new Error(`第 ${index + 1} 行超过 1,200 字，请缩短。`);
    const field = cardFields.find(([name]) => name === label)?.[1]
      ?? (label === "产品名" ? "productName" : label === "目标客户" ? "audience" : undefined);
    const normalizedLabel = field ?? label.toLocaleLowerCase();
    if (labels.has(normalizedLabel)) throw new Error(`第 ${index + 1} 行「${label}」重复，请只保留一条。`);
    labels.add(normalizedLabel);
    if (field) fields[field] = value;
    else if (value) factLines.push({ label, value });
  }
  if (factLines.length > 40) throw new Error("卖点事实最多 40 条，请精简后再应用。");

  const changedProduct = Boolean(workspace.productName.trim() && fields.productName
    && workspace.productName.trim().toLocaleLowerCase() !== fields.productName.toLocaleLowerCase());
  const oldFacts = changedProduct ? [] : workspace.facts;
  const facts: ProductFact[] = factLines.map(({ label, value }, index) => {
    const old = oldFacts.find((fact) => fact.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase());
    if (old && old.value.trim() === value) return old;
    return {
      id: old?.id ?? `bulk-fact-${index}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
      label,
      value,
      status: "pending",
      source: "用户批量编辑 · 待核对",
    };
  });

  return {
    ...workspace,
    ...fields,
    facts,
    images: changedProduct ? [] : workspace.images,
    intakeMessages: changedProduct ? [] : workspace.intakeMessages,
    outputs: [],
    selectedOutputId: undefined,
    status: "COLLECTING",
  };
}
