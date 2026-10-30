import { orcha } from "orchajs";

orcha.init({
  amarsia: {
    key: process.env.AMARSIA_PROJECT_KEY ?? "",
    endpoint: "http://0.0.0.0:8000",
    inference: true,
  },
  storage: {
    strategy: "cloud",
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
    riskBot: "./riskBot",
    supportBot: "./supportBot",
    mcpTester: {
      path: "./mcpTester",
      mcp: {
        memory: "./mcp/memory",
      },
    },
  },
});
