const orders = {
  ord_1001: {
    status: "in_transit",
    lastEvent: "Package departed the regional sorting facility.",
    nextStep: "The carrier will scan the package at the destination facility.",
  },
  ord_1002: {
    status: "delayed",
    lastEvent: "Weather interrupted the scheduled carrier route.",
    nextStep: "The carrier will publish a revised route after conditions clear.",
  },
};

export default function lookupOrder({ orderId }) {
  const order = orders[orderId];
  if (!order) {
    return {
      orderId,
      status: "not_found",
      lastEvent: "No order matched the supplied identifier.",
      nextStep: "Confirm the order identifier with the customer.",
    };
  }
  return { orderId, ...order };
}
