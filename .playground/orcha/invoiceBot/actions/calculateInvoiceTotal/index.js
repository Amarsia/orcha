export default function calculateInvoiceTotal(
  { hours, hourlyRate, taxRate, currency },
  ctx,
) {
  const subtotal = roundCurrency(hours * hourlyRate);
  const tax = roundCurrency(subtotal * taxRate);
  ctx.log("Calculated mocked invoice total", ctx.idempotencyKey);

  return {
    subtotal,
    tax,
    total: roundCurrency(subtotal + tax),
    currency,
  };
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
