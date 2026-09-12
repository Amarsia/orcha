export default function lookupServiceHealth({ service }) {
  return {
    service,
    status: "degraded",
    p95LatencyMs: 1840,
    errorRate: 0.073,
    lastDeployment: "2026-09-12T16:20:00Z",
  };
}
