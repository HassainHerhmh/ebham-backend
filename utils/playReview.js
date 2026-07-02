export function normalizePhone(phone) {
  return String(phone || "").replace(/\s+/g, "").trim();
}

export function getPlayReviewConfig() {
  const phone = normalizePhone(process.env.PLAY_REVIEW_PHONE);
  const otp = String(process.env.PLAY_REVIEW_OTP || "").trim();
  if (!phone || !otp) return null;
  return { phone, otp };
}

export function isPlayReviewPhone(phone) {
  const config = getPlayReviewConfig();
  if (!config) return false;
  return normalizePhone(phone) === config.phone;
}

export function isPlayReviewLogin(phone, code) {
  const config = getPlayReviewConfig();
  if (!config) return false;
  return (
    normalizePhone(phone) === config.phone &&
    String(code || "").trim() === config.otp
  );
}
