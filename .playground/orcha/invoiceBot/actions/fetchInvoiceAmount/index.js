export default async function fetchInvoiceAmount({ invoiceId }, ctx) {
  ctx.log("Returning mocked invoice amount", invoiceId);

  return {
    invoiceId,
    amount: 125,
    currency: "USD",
  };
}
