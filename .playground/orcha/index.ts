import { orcha } from "orchajs";

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
if (!anthropicApiKey) {
  throw new Error("ANTHROPIC_API_KEY is required to run the playground.");
}

orcha.init({
  providers: {
    anthropic: anthropicApiKey,
  },
  agents: {
    invoiceBot: "./invoiceBot",
  },
});
