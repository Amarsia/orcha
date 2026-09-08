import { orcha } from "orchajs";

orcha.init({
  providers: {
    anthropic: process.env.ANTHROPIC_API_KEY ?? "",
  },
  agents: {
    invoiceBot: "./invoiceBot",
  },
});
