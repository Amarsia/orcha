import { orcha } from "orchajs";

orcha.init({
  amarsia: process.env.AMARSIA_PROJECT_KEY
    ? { key: process.env.AMARSIA_PROJECT_KEY }
    : undefined,
  providers: {
    openai: process.env.OPENAI_API_KEY ?? "",
  },
  agents: {
    approvalAgent: "./approvalAgent",
    assistant: {
      path: "./assistant",
      subagents: {
        orderSupport: "./orderSupport",
      },
    },
    orderSupport: "./orderSupport",
  },
});
