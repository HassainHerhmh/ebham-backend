import crypto from "crypto";

/** مدة صلاحية رمز التحقق — دقيقة واحدة */
export const OTP_TTL_MS = 60 * 1000;

function getOtpPepper() {
  const pepper = process.env.OTP_PEPPER || process.env.JWT_SECRET;
  if (!pepper) {
    throw new Error("OTP_PEPPER or JWT_SECRET is required for OTP hashing");
  }
  return pepper;
}

export function generateOtpCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

/** تخزين مشفّر (HMAC) — لا يُحفظ الرمز كنص صريح في قاعدة البيانات */
export function hashOtpCode(code, phone) {
  const normalizedPhone = String(phone || "").replace(/\s+/g, "").trim();
  const normalizedCode = String(code || "").trim();
  return crypto
    .createHmac("sha256", getOtpPepper())
    .update(`${normalizedPhone}:${normalizedCode}`)
    .digest("hex");
}

export function getOtpExpiresAt() {
  return new Date(Date.now() + OTP_TTL_MS);
}
