export function emitCustomerOrderUpdate(io, payload = {}) {
  const customerId = Number(payload.customerId);
  if (!io || !customerId) return;

  const data = {
    type: "order_status",
    order_id: Number(payload.orderId),
    order_number: payload.orderNumber || payload.orderId,
    status: payload.status,
    status_label: payload.statusLabel || payload.status,
    title: payload.title || "تحديث في طلبك 📦",
    body: payload.body || payload.message || "",
    order_kind: payload.orderKind || "delivery",
  };

  io.to("user_" + customerId).emit("order_status_updated", data);
}
