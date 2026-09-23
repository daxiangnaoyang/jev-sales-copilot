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
 * Offline strategy demo. It consumes the supplied structured decision;
 * live conversations use Bocha Jev, while seed data is labeled as a sample.
 */
export const demoStrategyProvider: AgentStrategyProvider = {
  id: "demo-agent",
  async generate({ decision, latestMessage }) {
    return buildStrategy(decision, latestMessage);
  },
};
