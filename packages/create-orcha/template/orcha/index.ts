import { orcha } from "orchajs";

orcha.init({
  providers: {
    openai: process.env.OPENAI_API_KEY ?? "",
  },
  actions: {
    runtime: "sandbox",
  },
  agents: {
    approvalAgent: "./approvalAgent",
    assistant: "./assistant",
    orderSupport: "./orderSupport",
  },
});
