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
