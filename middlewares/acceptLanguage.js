/**
 * Reads Accept-Language (sent by the mobile app as ar | en) and sets req.locale.
 * Defaults to "ar" when missing or unrecognized.
 */
export default function acceptLanguage(req, _res, next) {
  const raw = String(req.headers["accept-language"] || "").trim();
  const first = raw.split(",")[0].trim().toLowerCase();
  req.locale = first.startsWith("en") ? "en" : "ar";
  next();
}
