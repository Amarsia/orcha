import { orcha } from "orchajs";

orcha.init({
  telemetry: {
    otel: {
      endpoint: "https://api.honeycomb.io",
      headers: {
        "x-honeycomb-team": process.env.HONEYCOMB_API_KEY ?? "",
      },
    },
  },
  providers: {
    anthropic: process.env.ANTHROPIC_API_KEY ?? "",
    bedrock: {
      region: process.env.AWS_REGION ?? "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
        sessionToken: process.env.AWS_SESSION_TOKEN ?? "",
      },
    },
    deepseek: process.env.DEEPSEEK_API_KEY ?? "",
    googlegenai: process.env.GOOGLE_API_KEY ?? "",
    openai: process.env.OPENAI_API_KEY ?? "",
    vertexai: {
      project: process.env.GOOGLE_CLOUD_PROJECT ?? "",
      location: process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1",
    },
  },
  agents: {
    invoiceBot: "./invoiceBot",
    // complianceBot: "./complianceBot",
    fulfillmentBot: "./fulfillmentBot",
    incidentBot: "./incidentBot",
    operationsCoordinator: {
      path: "./operationsCoordinator",
      subagents: {
        customerContextSpecialist: "./customerContextBot",
        incidentAnalyst: "./incidentBot",
        fulfillmentSpecialist: "./fulfillmentBot",
        riskAnalyst: "./riskBot",
      },
    },
    executiveDirector: {
      path: "./executiveDirector",
      subagents: {
        operationsCoordinator: "./operationsCoordinator",
      },
    },
    riskBot: "./riskBot",
    supportBot: "./supportBot",
    visualInspector: "./visualInspector",
    mcpTester: {
      path: "./mcpTester",
      mcp: {
        memory: "./mcp/memory",
      },
    },
  },
});
