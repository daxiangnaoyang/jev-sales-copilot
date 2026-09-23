export type Intent =
  | "discover"
  | "product_info"
  | "compare_product"
  | "price"
  | "request_material"
  | "objection"
  | "complaint"
  | "follow_up"
  | "unknown";

export type SalesStage =
  | "new_lead"
  | "discovery"
  | "evaluation"
  | "negotiation"
  | "decision"
  | "after_sales"
  | "paused";

export type CustomerNeed =
  | "information"
  | "fit"
  | "proof"
  | "price"
  | "risk"
  | "timeline"
  | "next_step"
  | "unknown";

export type NextAction =
  | "answer_and_ask"
  | "send_asset_and_ask"
  | "clarify_before_quote"
  | "address_objection"
  | "escalate_human"
  | "confirm_next_step"
  | "wait_and_follow_up";

export interface CustomerMessage {
  id: string;
  sender: "customer" | "seller" | "transcript";
  text: string;
  createdAt: string;
}

export interface CustomerProfile {
  id: string;
  name: string;
  company: string;
  role: string;
  stage: SalesStage;
  lastTouched: string;
  note: string;
}

export interface CustomerConversation {
  profile: CustomerProfile;
  messages: CustomerMessage[];
  decision: SalesDecision;
  strategy: CustomerStrategy;
  sourceConversationTitle?: string;
}

export interface SalesDecision {
  source?: "bocha-jev" | "demo";
  intent: Intent;
  stage: SalesStage;
  customerNeed: CustomerNeed;
  temperature: number;
  commercialRisk: number;
  decisionRole: "user" | "champion" | "buyer" | "blocker" | "unknown";
  shouldReplyNow: boolean;
  nextAction: NextAction;
  missingFacts: string[];
  confidence: number;
}

export interface StrategyReply {
  id: string;
  label: string;
  text: string;
  purpose: string;
  risk: "低" | "中" | "高";
}

export interface AssetRequest {
  skill: "product-showcase";
  type: "comparison_card" | "product_copy" | "social_post" | "short_video";
  title: string;
  reason: string;
  status: "recommended" | "queued";
}

export interface CustomerStrategy {
  objective: string;
  singleNextMove: string;
  question: string;
  questionPurpose: string;
  replies: StrategyReply[];
  asset?: AssetRequest;
  followUp: string;
  stopCondition: string;
  humanConfirmationRequired: boolean;
  unsupportedClaims: string[];
}

export type ProductFactStatus = "provided" | "visible" | "pending" | "missing";

export interface ProductFact {
  id: string;
  label: string;
  value: string;
  status: ProductFactStatus;
  source: string;
}

export interface ProductImage {
  id: string;
  name: string;
  previewUrl?: string;
  source: "local-upload" | "not-uploaded";
  note: string;
}

export interface ProductStoryboardScene {
  id: string;
  time: string;
  task: string;
  visual: string;
  voiceover: string;
  caption: string;
  source: string;
}

export interface ProductDiagramCard {
  id: string;
  title: string;
  body: string;
  allowedText: string;
  sourceFactId?: string;
  sourceImageId?: string;
}

export type ProductOutputType = "recommendation" | "social-post" | "diagram" | "video-script";

export interface ProductOutput {
  id: string;
  type: ProductOutputType;
  title: string;
  status: "DRAFT" | "READY_FOR_REVIEW";
  text?: string;
  cards?: ProductDiagramCard[];
  scenes?: ProductStoryboardScene[];
  factIds: string[];
}

export interface ProductWorkspace {
  productName: string;
  category: string;
  audience: string;
  scene: string;
  platform: "朋友圈" | "小红书" | "视频号";
  tone: "专业种草" | "亲切日常" | "活泼有趣";
  ratio: "3:4" | "4:5" | "9:16";
  videoDirection: "竖版 9:16 · 15 秒" | "横版 16:9 · 5—10 秒";
  facts: ProductFact[];
  images: ProductImage[];
  outputs: ProductOutput[];
  selectedOutputId?: string;
  status: "COLLECTING" | "READY_FOR_REVIEW";
}

export interface ReviewRecord {
  id: string;
  customer: CustomerProfile;
  messages: CustomerMessage[];
  decision: SalesDecision;
  strategy: CustomerStrategy;
  createdAt: string;
  status: "待复盘" | "已复盘";
  insight: string;
  reusableRule: string;
}
