export default async function fetchReceiptDocument({ receiptId }, ctx) {
  ctx.log("Fetching multimodal receipt PDF for", receiptId);

  return {
    output: {
      receiptId,
      status: "archived",
      attachmentName: "sample-receipt.pdf",
    },
    contents: [
      {
        type: "text",
        text: "Attached is the scanned PDF receipt document for inspection.",
      },
      {
        filePath: "./orcha/visualInspector/sample-receipt.pdf",
        mimeType: "application/pdf",
      },
    ],
  };
}
