export default async function sendInvoiceEmail(
  { invoiceId, recipient, total, currency },
  ctx,
) {
  ctx.log("Mock email delivery", {
    invoiceId,
    recipient,
    total,
    currency,
  });

  return {
    sent: true,
    messageId: `mock_email_${invoiceId}_${ctx.idempotencyKey.slice(-8)}`,
    recipient,
  };
}
