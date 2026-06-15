import { secureCompare } from "../utils/secureCompare.js";
import {
  clearGatewayAuthFailures,
  recordGatewayAuthFailure,
} from "./gatewayRateLimit.js";

const MIN_TOKEN_LENGTH = 32;
const UNAUTHORIZED = { message: "غير مصرح" };

function readBearerToken(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function readDeviceId(req) {
  const deviceId = req.headers["x-gateway-device"];
  if (typeof deviceId !== "string") return null;
  const trimmed = deviceId.trim();
  return trimmed || null;
}

export function requireGatewayAuth(req, res, next) {
  const token = readBearerToken(req);
  if (!token) {
    recordGatewayAuthFailure(req);
    return res.status(401).json(UNAUTHORIZED);
  }

  const gatewayToken = process.env.SMS_GATEWAY_TOKEN || "";
  if (!gatewayToken || gatewayToken.length < MIN_TOKEN_LENGTH) {
    console.error("[gateway] SMS_GATEWAY_TOKEN missing or too short");
    return res.status(503).json({ message: "الخدمة غير متاحة" });
  }

  if (token.length < MIN_TOKEN_LENGTH || !secureCompare(token, gatewayToken)) {
    recordGatewayAuthFailure(req);
    return res.status(401).json(UNAUTHORIZED);
  }

  const gatewayDeviceId = process.env.SMS_GATEWAY_DEVICE_ID || "";
  if (gatewayDeviceId) {
    const deviceId = readDeviceId(req);
    if (!deviceId || !secureCompare(deviceId, gatewayDeviceId)) {
      recordGatewayAuthFailure(req);
      return res.status(401).json(UNAUTHORIZED);
    }
  }

  clearGatewayAuthFailures(req);
  next();
}
