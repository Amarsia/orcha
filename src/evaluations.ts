import type { AgentEvaluationRegistrations } from "./types.js";

export function defineEvaluations<
  const Registrations extends AgentEvaluationRegistrations,
>(registrations: Registrations): Registrations {
  return registrations;
}
