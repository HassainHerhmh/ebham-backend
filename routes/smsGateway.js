import express from "express";
import { requireGatewayAuth } from "../middlewares/gatewayAuth.js";
import { gatewayRequestRateLimit } from "../middlewares/gatewayRateLimit.js";
import { gatewaySecurityHeaders } from "../middlewares/gatewaySecurityHeaders.js";
import * as smsGatewayService from "../services/smsGateway.service.js";

const router = express.Router();

router.use(gatewaySecurityHeaders);
router.use(gatewayRequestRateLimit);
router.use(requireGatewayAuth);

function parsePositiveInt(value) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

router.get("/stats", async (_req, res) => {
  try {
    await smsGatewayService.touchGatewayHeartbeat();
    const stats = await smsGatewayService.getGatewayStats();
    res.json({ stats });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "تعذر جلب الإحصائيات" });
  }
});

router.get("/pending", async (req, res) => {
  try {
    await smsGatewayService.touchGatewayHeartbeat();
    const messages = await smsGatewayService.getPendingSms(req.query.limit);
    res.json({ messages });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "تعذر جلب الرسائل" });
  }
});

router.post("/:id/sent", async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) return res.status(400).json({ message: "معرّف غير صالح" });

  try {
    const row = await smsGatewayService.markSmsSent(id);
    if (!row) return res.status(404).json({ message: "الرسالة غير موجودة" });
    res.json({ ok: true, message: row });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "تعذر تحديث الحالة" });
  }
});

router.post("/:id/failed", async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) return res.status(400).json({ message: "معرّف غير صالح" });

  try {
    const row = await smsGatewayService.markSmsFailed(id, req.body?.error);
    if (!row) return res.status(404).json({ message: "الرسالة غير موجودة" });
    res.json({ ok: true, message: row });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "تعذر تحديث الحالة" });
  }
});

export default router;
