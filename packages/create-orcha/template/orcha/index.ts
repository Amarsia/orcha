import { orcha } from "orchajs";

orcha.init({
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
