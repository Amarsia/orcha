import {
  orcha,
  type Execution,
  type RunResult,
} from "orchajs";
import "../orcha/index.js";

let result = await observe(
  orcha.invoiceBot.run({
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
  }),
);

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
  result = await observe(
    orcha.invoiceBot.resume(result.sessionId, {
      toolResults,
    }),
  );
}

console.log(JSON.stringify(result, null, 2));
console.log(`\nSession log: .orcha/sessions/${result.sessionId}.jsonl`);

async function observe<TOutput>(
  execution: Execution<TOutput>,
): Promise<RunResult<TOutput>> {
  const streamCompleted = (async () => {
    for await (const snapshot of execution.stream) {
      console.log("Snapshot:", snapshot);
    }
  })();

  const finalResult = await execution.result;
  await streamCompleted;
  return finalResult;
}
