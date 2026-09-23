import type {
  CustomerMessage,
  CustomerStrategy,
  SalesDecision,
  SalesStage,
} from "./types";

const now = () => new Date().toISOString();

export const demoCustomer = {
  id: "customer-linran",
  name: "林然",
  company: "远山设计",
  role: "采购负责人",
  stage: "evaluation" as SalesStage,
  lastTouched: "今天 10:24",
  note: "正在比较两款旗舰手机，关注影像和预算",
};

export const demoMessages: CustomerMessage[] = [
  {
    id: "message-1",
    sender: "customer",
    text: "你们这款和普通版差别大吗？主要想拍产品图，预算先控制在一万左右",
    createdAt: now(),
  },
  {
    id: "message-2",
    sender: "seller",
    text: "明白，你主要是拿来拍产品图和日常使用，我先按影像、续航和预算帮你拆一下",
    createdAt: now(),
  },
];

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

export function judgeCustomerMessage(text: string): SalesDecision {
  const normalized = text.trim().toLowerCase();

  if (includesAny(normalized, ["投诉", "不满意", "退款", "退货", "坏了", "被骗"])) {
    return {
      intent: "complaint",
      stage: "after_sales",
      customerNeed: "risk",
      temperature: 8,
      commercialRisk: 8,
      decisionRole: "unknown",
      shouldReplyNow: true,
      nextAction: "escalate_human",
      missingFacts: ["订单号", "具体问题和处理时限"],
      confidence: 0.94,
    };
  }

  if (includesAny(normalized, ["价格", "多少钱", "预算", "报价", "优惠", "便宜"])) {
    return {
      intent: "price",
      stage: "negotiation",
      customerNeed: "price",
      temperature: 7,
      commercialRisk: 5,
      decisionRole: "unknown",
      shouldReplyNow: true,
      nextAction: "clarify_before_quote",
      missingFacts: ["购买数量", "配置偏好", "是否需要正式报价"],
      confidence: 0.9,
    };
  }

  if (includesAny(normalized, ["区别", "对比", "哪个好", "比较", "差别"])) {
    return {
      intent: "compare_product",
      stage: "evaluation",
      customerNeed: "fit",
      temperature: 6,
      commercialRisk: 2,
      decisionRole: "user",
      shouldReplyNow: true,
      nextAction: "send_asset_and_ask",
      missingFacts: ["最看重的决策维度"],
      confidence: 0.91,
    };
  }

  if (includesAny(normalized, ["资料", "图片", "视频", "发我", "参数", "介绍"])) {
    return {
      intent: "request_material",
      stage: "evaluation",
      customerNeed: "proof",
      temperature: 6,
      commercialRisk: 1,
      decisionRole: "user",
      shouldReplyNow: true,
      nextAction: "send_asset_and_ask",
      missingFacts: ["客户要转发给谁", "客户最关心的卖点"],
      confidence: 0.92,
    };
  }

  return {
    intent: "discover",
    stage: "discovery",
    customerNeed: "information",
    temperature: 5,
    commercialRisk: 2,
    decisionRole: "unknown",
    shouldReplyNow: true,
    nextAction: "answer_and_ask",
    missingFacts: ["使用场景", "决策标准", "时间安排"],
    confidence: 0.71,
  };
}

export function buildStrategy(
  decision: SalesDecision,
  latestMessage: string,
): CustomerStrategy {
  const isPrice = decision.intent === "price";
  const isComplaint = decision.intent === "complaint";
  const isCompare = decision.intent === "compare_product";

  if (isComplaint) {
    return {
      objective: "先降低沟通风险，再确认事实和处理责任",
      singleNextMove: "先承接问题，不在事实未核对前解释或承诺结果",
      question: "方便把订单号和目前遇到的具体情况发我吗？",
      questionPurpose: "拿到可核对的事实，避免空泛道歉或错误承诺",
      replies: [
        {
          id: "reply-complaint-1",
          label: "先承接",
          text: "我先把这个问题接下来，订单号和具体情况发我一下，我核对后给你明确处理路径",
          purpose: "承接情绪并建立处理动作",
          risk: "低",
        },
        {
          id: "reply-complaint-2",
          label: "谨慎升级",
          text: "这个情况我不先凭猜测下结论，我先核对订单和问题记录，再给你准确回复",
          purpose: "避免未经核验的承诺",
          risk: "低",
        },
        {
          id: "reply-complaint-3",
          label: "简短确认",
          text: "收到，我现在先核对这件事，稍后带着具体处理方案回复你",
          purpose: "争取核查时间",
          risk: "中",
        },
      ],
      followUp: "核对完成后，给出事实、责任人和下一次更新时间",
      stopCondition: "未拿到订单或问题事实前，不承诺退款、补偿或完成时限",
      humanConfirmationRequired: true,
      unsupportedClaims: ["退款结果", "补偿金额", "处理完成时间"],
    };
  }

  const question = isPrice
    ? "你这次大概需要几台、偏向哪个配置？我再按实际需求给你准确报价"
    : isCompare
      ? "你现在更看重影像、性能，还是续航？我按你最在意的维度做对比"
      : "你主要准备在哪个场景使用？我先帮你判断最匹配的方案";

  const asset = isPrice || isCompare || decision.intent === "request_material"
    ? {
        skill: "product-showcase" as const,
        type: isCompare ? "comparison_card" as const : "product_copy" as const,
        title: isCompare ? "产品差异对比图解" : "产品卖点发送素材包",
        reason: isCompare
          ? "客户正在比较，需要一张一眼看懂的卖点对比图"
          : "客户需要可转发的产品信息，先用事实卡生成发送素材",
        status: "recommended" as const,
      }
    : undefined;

  return {
    objective: isPrice
      ? "在报价前补齐购买条件，避免无依据承诺价格"
      : isCompare
        ? "帮助客户建立自己的比较标准，而不是堆参数"
        : "先确认客户场景，再决定发送哪一组产品信息",
    singleNextMove: isPrice
      ? "先问清数量和配置，再进入正式报价"
      : "用一张对应卖点的素材承接兴趣，同时只问一个关键问题",
    question,
    questionPurpose: isPrice
      ? "补齐报价前的关键事实"
      : "确认客户的购买判断标准",
    replies: [
      {
        id: "reply-1",
        label: "专业简洁",
        text: isPrice
          ? "可以，我先确认一下数量和配置，再按实际需求给你准确报价"
          : "可以，我先按你最关心的维度把差异整理出来，你更看重影像、性能还是续航？",
        purpose: "先承接需求，再推进一个问题",
        risk: isPrice ? "中" : "低",
      },
      {
        id: "reply-2",
        label: "场景导向",
        text: isPrice
          ? "如果主要是拍产品图，我建议先看影像和存储配置，数量和配置确定后报价会更准"
          : "如果你主要拍产品图，先看影像、细节表现和续航这几个点，我给你做一张直观对比",
        purpose: "把产品特征翻译成使用场景",
        risk: "低",
      },
      {
        id: "reply-3",
        label: "资料承接",
        text: "我先发你一张重点对比图，里面只放已经确认的信息，看完你告诉我最在意哪一项",
        purpose: "用可转发素材降低理解成本",
        risk: "低",
      },
    ],
    asset,
    followUp: "客户回复关注维度后，发送对应卖点素材，并约定下一次确认时间",
    stopCondition: isPrice
      ? "数量、配置和价格权限未确认前，不发最终报价或折扣承诺"
      : "产品事实未确认前，不生成具体参数、评价或效果承诺",
    humanConfirmationRequired: isPrice,
    unsupportedClaims: isPrice ? ["最终价格", "折扣", "交付时间"] : [],
  };
}

export function createCustomerMessage(text: string, sender: CustomerMessage["sender"] = "customer"): CustomerMessage {
  return {
    id: `message-${Date.now()}`,
    sender,
    text,
    createdAt: now(),
  };
}
