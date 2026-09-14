import { orcha } from "orchajs";
import { runTests } from "orchajs/testing";
import "../orcha/index.js";

const report = await runTests(orcha);

console.log(JSON.stringify(report, null, 2));
if (report.status === "failed") {
  process.exitCode = 1;
}
