import { orcha, type SessionHistory } from "orchajs";
import "../orcha/index.js";

let result = await orcha.invoiceBot.run({
  content: [
    {
      type: "text",
      text: [
        "Process invoice INV-1001.",
        "Bill 2 hours at $100/hour with 10% tax.",
        "After approval, email it to billing@example.com.",
      ].join(" "),
    },
  ],
  name: "Invoice INV-1001",
  metadata: {
    invoiceId: "INV-1001",
    customerId: "cus_playground",
  },
  clientCapabilities: orcha.invoiceBot.clientTools,
}).result;

while (result.status === "waiting_for_client_action") {
  const toolResults = result.clientToolCalls.map((call) => {
    if (call.name !== "request_invoice_approval") {
      throw new Error(`No playground handler for "${call.name}".`);
    }
    console.log("Mock client approval requested:", call.arguments);
    return {
      callId: call.callId,
      output: { approved: true },
    };
  });
  result = await orcha.invoiceBot.resume(result.sessionId, {
    toolResults,
  }).result;
}

logHistory(
  "invoiceBot",
  await orcha.invoiceBot.history(result.sessionId, {
    page: 1,
    pageSize: 100,
  }),
);
console.log("[invoiceBot] Result:", JSON.stringify(result, null, 2));
console.log(`\nSession log: .orcha/sessions/${result.sessionId}.jsonl`);

const supportResult = await orcha.supportBot.run({
  content:
    "Account cus_playground upgraded its subscription this morning, but the dashboard still shows the old plan. What should I do?",
  name: "Subscription upgrade not reflected",
  metadata: {
    customerId: "cus_playground",
    category: "billing",
  },
}).result;

logHistory(
  "supportBot",
  await orcha.supportBot.history(supportResult.sessionId, {
    page: 1,
    pageSize: 100,
  }),
);
console.log("[supportBot] Result:", JSON.stringify(supportResult, null, 2));
console.log(
  `\nSession log: .orcha/sessions/${supportResult.sessionId}.jsonl`,
);

const fulfillmentResult = await orcha.fulfillmentBot.run({
  content:
    "Order ORD-4821 was due today, but it has not arrived. Find out what happened and tell me the next step.",
  name: "Delayed order ORD-4821",
  metadata: {
    orderId: "ORD-4821",
    category: "shipping",
  },
}).result;

logHistory(
  "fulfillmentBot",
  await orcha.fulfillmentBot.history(fulfillmentResult.sessionId, {
    page: 1,
    pageSize: 100,
  }),
);
console.log(
  "[fulfillmentBot] Result:",
  JSON.stringify(fulfillmentResult, null, 2),
);
console.log(
  `\nSession log: .orcha/sessions/${fulfillmentResult.sessionId}.jsonl`,
);

const incidentResult = await orcha.incidentBot.run({
  content:
    "Customers report that checkout requests are timing out. Inspect checkout-api and provide an initial incident assessment.",
  name: "Checkout latency incident",
  metadata: {
    service: "checkout-api",
    severity: "investigating",
  },
}).result;

logHistory(
  "incidentBot",
  await orcha.incidentBot.history(incidentResult.sessionId, {
    page: 1,
    pageSize: 100,
  }),
);
console.log(
  "[incidentBot] Result:",
  JSON.stringify(incidentResult, null, 2),
);
console.log(
  `\nSession log: .orcha/sessions/${incidentResult.sessionId}.jsonl`,
);

function logHistory(
  agentName: string,
  history: SessionHistory,
): void {
  console.log(`\n[${agentName}] Session timeline`);
  for (const item of history.items) {
    if (item.type === "message") {
      console.log(
        `${item.role?.toUpperCase()}:`,
        item.content
          ?.map((content) =>
            content.type === "text"
              ? content.text
              : `[${content.type}: ${content.fileUri}]`,
          )
          .join("\n"),
      );
    } else if (
      item.type === "action" ||
      item.type === "client_action"
    ) {
      const duration =
        item.durationMs === undefined ? "" : ` (${item.durationMs}ms)`;
      console.log(
        `TOOL: ${item.name} — ${item.status}${duration}`,
      );
    }
  }
}
