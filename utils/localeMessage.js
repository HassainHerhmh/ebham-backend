/** @param {import("express").Request} req */
export function tx(req, ar, en) {
  return req.locale === "en" ? en : ar;
}
