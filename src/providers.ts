import type { CustomerStrategy, SalesDecision } from "./types";
import { buildStrategy } from "./strategy";

export interface AgentStrategyProvider {
  id: string;
  generate(input: {
    decision: SalesDecision;
    latestMessage: string;
  }): Promise<CustomerStrategy>;
}

/**
 * Offline strategy provider. Customer judgment stays deterministic and local;
 * this adapter only builds the next-step strategy from that judgment.
 */
export const demoStrategyProvider: AgentStrategyProvider = {
  id: "demo-agent",
  async generate({ decision, latestMessage }) {
    return buildStrategy(decision, latestMessage);
  },
};
