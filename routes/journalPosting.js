import express from "express";
import auth from "../middlewares/auth.js";
import {
  listJournalJobs,
  processOpenJournalJobs,
} from "../utils/orderJournals.js";

const router = express.Router();
router.use(auth);

function emitPosted(req, processed) {
  if (!processed?.posted) return;
  req.app.get("io")?.emit("admin_notification", {
    type: "journal_posted",
    message: `تم ترحيل ${processed.posted} قيد محاسبي تلقائياً بعد حل سبب الفشل`,
  });
}

router.get("/", async (req, res) => {
  try {
    const processed = await processOpenJournalJobs(req);
    const data = await listJournalJobs();
    emitPosted(req, processed);
    res.json({
      success: true,
      list: data.list,
      counts: data.counts,
      processed,
    });
  } catch (err) {
    console.error("JOURNAL POSTING LIST ERROR:", err?.message || err);
    res.status(500).json({ success: false, list: [], counts: {} });
  }
});

router.post("/retry", async (req, res) => {
  try {
    const processed = await processOpenJournalJobs(req);
    const data = await listJournalJobs();
    emitPosted(req, processed);
    res.json({
      success: true,
      list: data.list,
      counts: data.counts,
      processed,
    });
  } catch (err) {
    console.error("JOURNAL POSTING RETRY ERROR:", err?.message || err);
    res.status(500).json({
      success: false,
      message: err?.message || "فشل إعادة معالجة القيود",
    });
  }
});

export default router;
