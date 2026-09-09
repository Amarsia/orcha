import { orcha } from "orchajs";

orcha.init({
  providers: {
    anthropic: process.env.ANTHROPIC_API_KEY ?? "",
  },
  actions: {
    runtime: "sandbox",
  },
  agents: {
    invoiceBot: "./invoiceBot",
  },
});
