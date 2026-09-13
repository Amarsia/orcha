export default function lookupTransactionRisk({ transactionId }) {
  return {
    transactionId,
    amount: 1840,
    currency: "USD",
    velocityScore: 0.86,
    locationMismatch: true,
    devicePreviouslySeen: false,
  };
}
