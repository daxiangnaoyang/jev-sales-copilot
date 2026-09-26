import type {
  ProductFact,
  ProductOutput,
  ProductWorkspace,
  ProductStoryboardScene,
} from "./types";

const confirmedFacts = (facts: ProductFact[]) => facts.filter((fact) => fact.status === "provided" || fact.status === "visible");

export const defaultProductWorkspace: ProductWorkspace = {
  productName: "",
  category: "",
  audience: "",
  scene: "",
  platform: "朋友圈",
  tone: "专业种草",
  ratio: "4:5",
  videoDirection: "竖版 9:16 · 15 秒",
  facts: [],
  images: [],
  intakeMessages: [],
  outputs: [],
  status: "COLLECTING",
};

export function normalizeProductWorkspace(workspace: ProductWorkspace): ProductWorkspace {
  const legacyDirection = (workspace as unknown as { videoDirection?: string }).videoDirection;
  const withDirection: ProductWorkspace = legacyDirection === "横版 16:9 · 5—10 秒"
    ? { ...workspace, videoDirection: "横版 16:9 · 15 秒" }
    : workspace;
  const existingOutputs = Array.isArray(withDirection.outputs) ? withDirection.outputs : [];
  const outputs = existingOutputs.map((output) => {
    if (output.type !== "video-script" || !output.scenes?.some((scene) =>
      /拍产品图|摄像头模组|视频录制和屏幕画面|设备回到桌面工作流/.test(`${scene.visual} ${scene.voiceover} ${scene.caption}`))) return output;
    return { ...output, stale: true };
  });
  return existingOutputs.length !== withDirection.outputs?.length || outputs.some((output, index) => output !== existingOutputs[index])
    ? { ...withDirection, outputs }
    : withDirection;
}

function factText(facts: ProductFact[], fallback: string) {
  const values = confirmedFacts(facts).slice(0, 3).map((fact) => fact.value);
  return values.length > 0 ? values : [fallback];
}

function buildScenes(workspace: ProductWorkspace, facts: ProductFact[]): ProductStoryboardScene[] {
  const product = workspace.productName.trim() || "这款产品";
  const [first, second, third] = confirmedFacts(facts);
  const context = workspace.scene.trim() || workspace.audience.trim() || "你的实际需求";
  const factScene = (fact: ProductFact | undefined, fallback: string) => fact
    ? { voiceover: `看${fact.label}：${fact.value}`, caption: `${fact.label}｜${fact.value}`, source: `已确认事实：${fact.id}` }
    : { voiceover: fallback, caption: "以已确认资料为准", source: "未增加产品参数" };
  const firstScene = factScene(first, "先从已确认的信息开始了解。");
  const secondScene = factScene(second, "更多信息以核实后的产品资料为准。");
  const thirdScene = factScene(third, "结合自己的需求，再判断是否适合。");
  return [
    { id: "scene-1", time: "0—2 秒", task: "需求钩子", visual: `${product} 外观主视觉出现，按已上传图片呈现`, voiceover: "选产品，先看信息是否对得上需求。", caption: "先看需求，再看事实", source: "产品图片；不补造外观" },
    { id: "scene-2", time: "2—5 秒", task: "使用场景", visual: `围绕「${context}」呈现产品与使用情境`, voiceover: `从${context}出发，逐项看清产品信息。`, caption: context, source: "用户填写的使用场景或人群" },
    { id: "scene-3", time: "5—8 秒", task: "已确认卖点", visual: `突出事实卡中的「${first?.label ?? "核心信息"}」，不添加额外参数`, voiceover: firstScene.voiceover, caption: firstScene.caption, source: firstScene.source },
    { id: "scene-4", time: "8—10 秒", task: "补充事实", visual: second ? `切换到「${second.label}」对应的产品细节` : "保持产品画面，使用简洁转场", voiceover: secondScene.voiceover, caption: secondScene.caption, source: secondScene.source },
    { id: "scene-5", time: "10—13 秒", task: "需求匹配", visual: third ? `展示「${third.label}」对应的产品细节` : "回到产品主视觉，不生成未提供的功能画面", voiceover: thirdScene.voiceover, caption: thirdScene.caption, source: thirdScene.source },
    { id: "scene-6", time: "13—15 秒", task: "收束", visual: `${product} 主视觉定格，保留字幕安全区`, voiceover: "先核实关键信息，再判断是否适合自己。", caption: `${product}｜了解已确认信息`, source: "产品图片与已确认事实" },
  ];
}

export function buildProductOutputs(workspace: ProductWorkspace): ProductOutput[] {
  const facts = confirmedFacts(workspace.facts);
  const factIds = facts.map((fact) => fact.id);
  const values = factText(workspace.facts, "已确认卖点待补充");
  const [first, second, third] = values;
  const product = workspace.productName || "这款产品";

  const recommendation = `如果你${workspace.scene || "有明确使用场景"}，先别急着堆参数。${product}可以从${first}看起，再结合${second || "已确认的核心卖点"}判断是否适合你。`;
  const socialPost = `最近在整理${product}的产品资料。\n\n如果你的场景是${workspace.scene || "日常使用"}，我会优先看这几个已确认信息：${first}；${second || "核心卖点待补充"}；${third || "更多信息待确认"}。\n\n先把事实看清楚，再决定要不要入手。`;
  const productImages = workspace.images.filter((image) => image.source === "local-upload");
  const cards = (facts.length > 0 ? facts.slice(0, 5) : [{ id: "missing", label: "待补充卖点", value: "请先在事实卡中确认可公开信息", status: "missing" as const, source: "未获取" }]).map((fact, index) => ({
    id: `diagram-${fact.id}`,
    title: fact.label || `卖点 ${index + 1}`,
    body: fact.value,
    allowedText: fact.value,
    sourceFactId: fact.id === "missing" ? undefined : fact.id,
    sourceImageId: productImages.length ? productImages[index % productImages.length].id : undefined,
  }));

  return [
    { id: "output-recommendation", type: "recommendation", title: "产品推荐语", status: "READY_FOR_REVIEW", text: recommendation, factIds },
    { id: "output-social", type: "social-post", title: "朋友圈分享短文", status: "READY_FOR_REVIEW", text: socialPost, factIds },
    { id: "output-diagram", type: "diagram", title: "电商卖点图解草稿", status: "DRAFT", cards, factIds },
    { id: "output-video", type: "video-script", title: "15 秒卖点视频脚本", status: "READY_FOR_REVIEW", scenes: buildScenes(workspace, facts), factIds },
  ];
}
