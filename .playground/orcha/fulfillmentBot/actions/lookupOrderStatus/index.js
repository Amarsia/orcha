export default function lookupOrderStatus({ orderId }) {
  return {
    orderId,
    status: "carrier_delay",
    carrier: "Northstar Parcel",
    lastEvent: "Shipment reached the regional sorting facility.",
    nextStep: "Carrier review is scheduled for the next business morning.",
  };
}
