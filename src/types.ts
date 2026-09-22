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
  sender: "customer" | "seller";
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

export interface JevDecision {
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
