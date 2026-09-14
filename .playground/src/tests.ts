import { orcha } from "orchajs";
import { runTests } from "orchajs/testing";
import "../orcha/index.js";

const report = await runTests(orcha);

console.log(`Agent tests: ${report.passed}/${report.total} passed`);
for (const testCase of report.cases) {
  const sessionLink = testCase.sessionPath
    ? `${testCase.sessionPath}:1`
    : testCase.sessionId ?? "";
  console.log(
    `${testCase.status === "passed" ? "PASS" : "FAIL"} ${testCase.agent}/${testCase.name} (${testCase.durationMs}ms) ${sessionLink}`.trim(),
  );
  for (const assertion of testCase.assertions) {
    if (!assertion.passed) {
      console.error(`  ${assertion.message}`);
    }
  }
}
if (report.status === "failed") {
  process.exitCode = 1;
}
