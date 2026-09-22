import type {
  ProductFact,
  ProductOutput,
  ProductWorkspace,
  ProductStoryboardScene,
} from "./types";

const confirmedFacts = (facts: ProductFact[]) => facts.filter((fact) => fact.status === "provided" || fact.status === "visible");

export const defaultProductWorkspace: ProductWorkspace = {
  productName: "iPhone 旗舰（演示案例）",
  category: "旗舰手机",
  audience: "需要拍产品图、重视影像和性能的用户",
  scene: "产品拍摄、日常使用、转发给决策人",
  platform: "朋友圈",
  tone: "专业种草",
  ratio: "4:5",
  videoDirection: "竖版 9:16 · 15 秒",
  facts: [
    { id: "fact-camera", label: "影像", value: "4800 万像素融合式主摄，带可变光圈", status: "provided", source: "用户提供的产品说明" },
    { id: "fact-video", label: "视频", value: "支持 4K 120fps 杜比视界视频", status: "provided", source: "用户提供的产品说明" },
    { id: "fact-battery", label: "续航", value: "视频播放最长 43 小时", status: "provided", source: "用户提供的产品说明" },
    { id: "fact-price", label: "价格", value: "RMB 9999 起", status: "provided", source: "用户提供的产品说明" },
    { id: "fact-material", label: "机身", value: "铝金属一体成型，配有操作按钮和相机控制", status: "visible", source: "产品图中可见" },
  ],
  images: [{ id: "image-empty", name: "尚未导入产品图", source: "not-uploaded", note: "导入后用于图解草稿预览；当前不调用图像生成服务" }],
  outputs: [],
  status: "COLLECTING",
};

function factText(facts: ProductFact[], fallback: string) {
  const values = confirmedFacts(facts).slice(0, 3).map((fact) => fact.value);
  return values.length > 0 ? values : [fallback];
}

function buildScenes(workspace: ProductWorkspace, facts: ProductFact[]): ProductStoryboardScene[] {
  const fallback = "请先补充并确认核心卖点";
  const [camera = fallback, video = fallback, battery = fallback] = factText(facts, fallback);
  return [
    { id: "scene-1", time: "0—2 秒", task: "钩子", visual: `${workspace.productName} 主视觉快速出现`, voiceover: "拍产品图，真正难的是把细节拍清楚", caption: "拍产品图，细节要清楚", source: "产品主图；待导入" },
    { id: "scene-2", time: "2—5 秒", task: "使用处境", visual: `${workspace.scene} 的简洁场景切入`, voiceover: "从产品拍摄到日常记录，都要一台能稳定承接的设备", caption: "产品拍摄 / 日常记录", source: "使用场景图；待补充" },
    { id: "scene-3", time: "5—8 秒", task: "卖点证明", visual: "镜头推进后展示摄像头模组和画面细节", voiceover: camera, caption: camera, source: "产品细节图 + 已确认事实" },
    { id: "scene-4", time: "8—10 秒", task: "卖点证明", visual: "连续切换视频录制和屏幕画面", voiceover: video, caption: video, source: "产品图/视频素材；已确认事实" },
    { id: "scene-5", time: "10—13 秒", task: "使用利益", visual: "设备回到桌面工作流，画面保持干净", voiceover: battery, caption: battery, source: "产品说明；已确认事实" },
    { id: "scene-6", time: "13—15 秒", task: "收束", visual: "产品正反面定格，保留文字安全区", voiceover: `${workspace.productName}，从你最在意的卖点开始了解`, caption: `${workspace.productName}｜${workspace.platform}`, source: "产品主图；待导入" },
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
  const cards = (facts.length > 0 ? facts.slice(0, 5) : [{ id: "missing", label: "待补充卖点", value: "请先在事实卡中确认可公开信息", status: "missing" as const, source: "未获取" }]).map((fact, index) => ({
    id: `diagram-${fact.id}`,
    title: fact.label || `卖点 ${index + 1}`,
    body: fact.value,
    allowedText: fact.value,
    sourceFactId: fact.id === "missing" ? undefined : fact.id,
    sourceImageId: workspace.images.find((image) => image.source === "local-upload")?.id,
  }));

  return [
    { id: "output-recommendation", type: "recommendation", title: "产品推荐语", status: "READY_FOR_REVIEW", text: recommendation, factIds },
    { id: "output-social", type: "social-post", title: "朋友圈分享短文", status: "READY_FOR_REVIEW", text: socialPost, factIds },
    { id: "output-diagram", type: "diagram", title: "电商卖点图解草稿", status: "DRAFT", cards, factIds },
    { id: "output-video", type: "video-script", title: "15 秒卖点视频脚本", status: "READY_FOR_REVIEW", scenes: buildScenes(workspace, facts), factIds },
  ];
}
