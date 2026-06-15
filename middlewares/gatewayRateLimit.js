const AUTH_FAIL_WINDOW_MS = 15 * 60 * 1000;
const AUTH_FAIL_MAX = 10;
const AUTH_LOCK_MS = 30 * 60 * 1000;
const REQUEST_WINDOW_MS = 60 * 1000;
const REQUEST_MAX = 120;

const authFailures = new Map();
const authLocks = new Map();
const requestBuckets = new Map();

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function prune(map, key) {
  if (map.has(key)) map.delete(key);
}

export function gatewayRequestRateLimit(req, res, next) {
  const ip = clientIp(req);
  const lockUntil = authLocks.get(ip);
  if (lockUntil && Date.now() < lockUntil) {
    return res.status(429).json({ message: "محاولات كثيرة — حاول لاحقاً" });
  }
  if (lockUntil) prune(authLocks, ip);

  const now = Date.now();
  let bucket = requestBuckets.get(ip);
  if (!bucket || now > bucket.reset) {
    bucket = { count: 0, reset: now + REQUEST_WINDOW_MS };
    requestBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > REQUEST_MAX) {
    return res.status(429).json({ message: "طلبات كثيرة — حاول لاحقاً" });
  }
  next();
}

export function recordGatewayAuthFailure(req) {
  const ip = clientIp(req);
  const now = Date.now();
  let bucket = authFailures.get(ip);
  if (!bucket || now > bucket.reset) {
    bucket = { count: 0, reset: now + AUTH_FAIL_WINDOW_MS };
    authFailures.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count >= AUTH_FAIL_MAX) {
    authLocks.set(ip, now + AUTH_LOCK_MS);
    authFailures.delete(ip);
  }
}

export function clearGatewayAuthFailures(req) {
  const ip = clientIp(req);
  prune(authFailures, ip);
  prune(authLocks, ip);
}
