export function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `***${digits.slice(-4)}`;
}

export function maskToken(token) {
  const value = String(token || "");
  if (value.length <= 8) return "[redacted]";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function safeError(context, err) {
  const message = err?.message || String(err);
  console.error(`[${context}]`, message);
}
