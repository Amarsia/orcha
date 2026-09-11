export default function lookupSubscriptionStatus({ accountId }) {
  return {
    accountId,
    currentPlan: "Starter",
    requestedPlan: "Pro",
    activationStatus: "processing",
    expectedActivationMinutes: 30,
  };
}
