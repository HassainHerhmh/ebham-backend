/** Notify customer apps that catalog/home data changed. */
export function emitCatalogUpdate(appOrIo, payload = {}) {
  try {
    const io =
      appOrIo && typeof appOrIo.emit === "function"
        ? appOrIo
        : appOrIo?.get?.("io");

    if (!io || typeof io.emit !== "function") return;

    io.emit("catalog_update", {
      at: Date.now(),
      ...payload,
    });
  } catch (err) {
    console.error("emitCatalogUpdate:", err?.message || err);
  }
}
