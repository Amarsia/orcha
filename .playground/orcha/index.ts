import { orcha } from "orchajs";

orcha.init({
  providers: {
    anthropic: process.env.ANTHROPIC_API_KEY ?? "",
    deepseek: process.env.DEEPSEEK_API_KEY ?? "",
    googlegenai: process.env.GOOGLE_API_KEY ?? "",
    openai: process.env.OPENAI_API_KEY ?? "",
    // Uses Google Application Default Credentials. For local JSON credentials,
    // set GOOGLE_APPLICATION_CREDENTIALS to the file's runtime path.
    vertexai: {
      project: process.env.GOOGLE_CLOUD_PROJECT ?? "",
      location: process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1",
    },
  },
  actions: {
    runtime: "sandbox",
  },
  agents: {
    invoiceBot: "./invoiceBot",
    fulfillmentBot: "./fulfillmentBot",
    incidentBot: "./incidentBot",
    riskBot: "./riskBot",
    supportBot: "./supportBot",
  },
});
