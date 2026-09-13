export default function lookupSecurityControl({ controlId }) {
  return {
    controlId,
    owner: "Platform Security",
    lastReviewedAt: "2026-08-12",
    evidenceStatus: "incomplete",
    exceptions: [
      "Two production service accounts do not enforce key rotation.",
    ],
  };
}
