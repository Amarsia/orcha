import type { AgentSkillRegistrations } from "./types.js";

export function defineSkills<
  const Registrations extends AgentSkillRegistrations,
>(registrations: Registrations): Registrations {
  return registrations;
}
