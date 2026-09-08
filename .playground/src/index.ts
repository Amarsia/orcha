import { orcha } from "orchajs";
import "../orcha/index.js";

const execution = orcha.invoiceBot.run({
  input: "Create a short sample invoice for two hours of consulting at $100 per hour.",
});

const result = await execution.result;
console.log(JSON.stringify(result, null, 2));

if (result.status === "completed") {
  console.log(
    `\nSession log: .orcha/sessions/${result.sessionId}.jsonl`,
  );
}
