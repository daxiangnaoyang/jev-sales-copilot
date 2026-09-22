import type { CustomerMessage, CustomerStrategy, JevDecision } from "./types";
import { buildStrategy, judgeCustomerMessage } from "./strategy";

export interface JevDecisionProvider {
  id: string;
  judge(messages: CustomerMessage[]): Promise<JevDecision>;
}

export interface AgentStrategyProvider {
  id: string;
  generate(input: {
    decision: JevDecision;
    latestMessage: string;
  }): Promise<CustomerStrategy>;
}

/**
 * Offline provider used by the first App milestone.
 * Replace these two providers with real Jev/Agent adapters without changing
 * the customer-facing workflow or its manual-send boundary.
 */
export const demoJevProvider: JevDecisionProvider = {
  id: "demo-jev",
  async judge(messages) {
    const latest = [...messages].reverse().find((message) => message.sender === "customer");
    return judgeCustomerMessage(latest?.text ?? "");
  },
};

export const demoStrategyProvider: AgentStrategyProvider = {
  id: "demo-agent",
  async generate({ decision, latestMessage }) {
    return buildStrategy(decision, latestMessage);
  },
};
