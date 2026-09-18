import { orcha, type SessionHistory } from "orchajs";
import "../orcha/index.js";

// let result = await orcha.invoiceBot.run({
//   content: [
//     {
//       type: "text",
//       text: [
//         "Process invoice INV-1001.",
//         "Bill 2 hours at $100/hour with 10% tax.",
//         "After approval, email it to billing@example.com.",
//       ].join(" "),
//     },
//   ],
//   name: "Invoice INV-1001",
//   metadata: {
//     invoiceId: "INV-1001",
//     customerId: "cus_playground",
//   },
//   clientCapabilities: orcha.invoiceBot.clientTools,
// }).result;

// while (result.status === "waiting_for_client_action") {
//   const toolResults = result.clientToolCalls.map((call) => {
//     if (call.name !== "request_invoice_approval") {
//       throw new Error(`No playground handler for "${call.name}".`);
//     }
//     console.log("Mock client approval requested:", call.arguments);
//     return {
//       callId: call.callId,
//       output: { approved: true },
//     };
//   });
//   result = await orcha.invoiceBot.resume(result.sessionId, {
//     toolResults,
//   }).result;
// }

// logHistory(
//   "invoiceBot",
//   await orcha.invoiceBot.history(result.sessionId, {
//     page: 1,
//     pageSize: 100,
//   }),
// );
// console.log("[invoiceBot] Result:", JSON.stringify(result, null, 2));
// console.log(`\nSession log: .orcha/sessions/${result.sessionId}.jsonl`);

// const supportResult = await orcha.supportBot.run({
//   content:
//     "Account cus_playground upgraded its subscription this morning, but the dashboard still shows the old plan. What should I do?",
//   name: "Subscription upgrade not reflected",
//   metadata: {
//     customerId: "cus_playground",
//     category: "billing",
//   },
// }).result;

// logHistory(
//   "supportBot",
//   await orcha.supportBot.history(supportResult.sessionId, {
//     page: 1,
//     pageSize: 100,
//   }),
// );
// console.log("[supportBot] Result:", JSON.stringify(supportResult, null, 2));
// console.log(
//   `\nSession log: .orcha/sessions/${supportResult.sessionId}.jsonl`,
// );

// const fulfillmentResult = await orcha.fulfillmentBot.run({
//   content:
//     "Order ORD-4821 was due today, but it has not arrived. Find out what happened and tell me the next step.",
//   name: "Delayed order ORD-4821",
//   metadata: {
//     orderId: "ORD-4821",
//     category: "shipping",
//   },
// }).result;

// logHistory(
//   "fulfillmentBot",
//   await orcha.fulfillmentBot.history(fulfillmentResult.sessionId, {
//     page: 1,
//     pageSize: 100,
//   }),
// );
// console.log(
//   "[fulfillmentBot] Result:",
//   JSON.stringify(fulfillmentResult, null, 2),
// );
// console.log(
//   `\nSession log: .orcha/sessions/${fulfillmentResult.sessionId}.jsonl`,
// );

// const incidentResult = await orcha.incidentBot.run({
//   content:
//     "Customers report that checkout requests are timing out. Inspect checkout-api and provide an initial incident assessment.",
//   name: "Checkout latency incident",
//   metadata: {
//     service: "checkout-api",
//     severity: "investigating",
//   },
// }).result;

// logHistory(
//   "incidentBot",
//   await orcha.incidentBot.history(incidentResult.sessionId, {
//     page: 1,
//     pageSize: 100,
//   }),
// );
// console.log(
//   "[incidentBot] Result:",
//   JSON.stringify(incidentResult, null, 2),
// );
// console.log(
//   `\nSession log: .orcha/sessions/${incidentResult.sessionId}.jsonl`,
// );

/* const complianceResult = await orcha.complianceBot.run({
  content:
    "Assess security control IAM-07 and recommend the next remediation action.",
  name: "Security control IAM-07",
  metadata: {
    controlId: "IAM-07",
    framework: "SOC 2",
  },
}).result;

logHistory(
  "complianceBot",
  await orcha.complianceBot.history(complianceResult.sessionId, {
    page: 1,
    pageSize: 100,
  }),
);
console.log(
  "[complianceBot] Result:",
  JSON.stringify(complianceResult, null, 2),
);
console.log(
  `\nSession log: .orcha/sessions/${complianceResult.sessionId}.jsonl`,
); */

// const riskResult = await orcha.riskBot.run({
//   content:
//     "Assess transaction TXN-90210 and recommend whether it needs manual review.",
//   name: "Transaction risk TXN-90210",
//   metadata: {
//     transactionId: "TXN-90210",
//     category: "payment-risk",
//   },
// }).result;

// logHistory(
//   "riskBot",
//   await orcha.riskBot.history(riskResult.sessionId, {
//     page: 1,
//     pageSize: 100,
//   }),
// );
// console.log("[riskBot] Result:", JSON.stringify(riskResult, null, 2));
// console.log(
//   `\nSession log: .orcha/sessions/${riskResult.sessionId}.jsonl`,
// );

let operationsResult = await orcha.operationsCoordinator.run({
  content: [
    "A customer says checkout-api timed out while placing order ORD-4821",
    "with transaction TXN-90210, and the order has not arrived.",
    "Their email address is missing. Run the incident, fulfillment, risk,",
    "and customer-context specialists. Obtain the missing email through",
    "the customer-context specialist's pause flow, then provide one grounded",
    "operational assessment with owners and immediate next steps.",
  ].join(" "),
  name: "Cross-functional checkout assessment",
  metadata: {
    service: "checkout-api",
    orderId: "ORD-4821",
    transactionId: "TXN-90210",
  },
  clientCapabilities: orcha.operationsCoordinator.clientTools,
}).result;

while (operationsResult.status === "waiting_for_client_action") {
  const toolResults = operationsResult.clientToolCalls.map((call) => {
    if (call.name !== "request_customer_identity") {
      throw new Error(`No playground handler for "${call.name}".`);
    }
    console.log(
      "[operationsCoordinator] Customer identity requested:",
      call.arguments,
    );
    return {
      callId: call.callId,
      output: { email: "customer@example.com" },
    };
  });
  operationsResult = await orcha.operationsCoordinator.resume(
    operationsResult.sessionId,
    { toolResults },
  ).result;
}

const operationsHistory = await orcha.operationsCoordinator.history(
  operationsResult.sessionId,
  {
    page: 1,
    pageSize: 100,
  },
);
logHistory("operationsCoordinator", operationsHistory);
console.log(
  "[operationsCoordinator] Result:",
  JSON.stringify(operationsResult, null, 2),
);
console.log(
  `\nSession log: .orcha/sessions/${operationsResult.sessionId}.jsonl`,
);

for (const item of operationsHistory.items) {
  if (item.type !== "subagent" || !item.childSessionId) {
    continue;
  }
  logHistory(
    `operationsCoordinator → ${item.name}`,
    await orcha.operationsCoordinator.subagentHistory(
      item.childSessionId,
      {
        page: 1,
        pageSize: 100,
      },
    ),
  );
  console.log(
    `Child session log: .orcha/sessions/${item.childSessionId}.jsonl`,
  );
}

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
    } else if (item.type === "skill") {
      console.log(`SKILL: ${item.summary}`);
    } else if (item.type === "subagent") {
      console.log(
        `SUBAGENT: ${item.name} — ${item.status} (${item.childSessionId})`,
      );
    }
  }
}
