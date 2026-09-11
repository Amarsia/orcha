import { orcha } from "orchajs";

orcha.init({
  providers: {
    anthropic: process.env.ANTHROPIC_API_KEY ?? "",
    openai: process.env.OPENAI_API_KEY ?? "",
  },
  actions: {
    runtime: "sandbox",
  },
  agents: {
    invoiceBot: "./invoiceBot",
    supportBot: "./supportBot",
  },
});
