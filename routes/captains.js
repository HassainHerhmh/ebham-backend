import express from "express";
import db from "../db.js";

const router = express.Router();

/* =========================
   GET /captains
========================= */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT *
      FROM captains
      ORDER BY id DESC
    `);

    res.json({ success: true, captains: rows });
  } catch (err) {
    console.error("GET CAPTAINS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /captains
========================= */
router.post("/", async (req, res) => {
  const {
    name,
    email,
    phone,
    password,
    vehicle_type,
    vehicle_number,
    status
  } = req.body;

  if (!name || !phone || !password) {
    return res.json({
      success: false,
      message: "الاسم، الجوال، وكلمة المرور مطلوبة"
    });
  }

  try {
    await db.query(
      `
      INSERT INTO captains
      (name, email, phone, password, vehicle_type, vehicle_number, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        name,
        email || null,
        phone,
        password,
        vehicle_type || "دراجة",
        vehicle_number || null,
        status || "available"
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD CAPTAIN ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   PUT /captains/:id
========================= */
router.put("/:id", async (req, res) => {
  const {
    name,
    email,
    phone,
    password,
    vehicle_type,
    vehicle_number,
    status
  } = req.body;

  const fields = [];
  const values = [];

  if (name) { fields.push("name=?"); values.push(name); }
  if (email) { fields.push("email=?"); values.push(email); }
  if (phone) { fields.push("phone=?"); values.push(phone); }
  if (password) { fields.push("password=?"); values.push(password); }
  if (vehicle_type) { fields.push("vehicle_type=?"); values.push(vehicle_type); }
  if (vehicle_number) { fields.push("vehicle_number=?"); values.push(vehicle_number); }
  if (status) { fields.push("status=?"); values.push(status); }

  if (!fields.length) {
    return res.json({
      success: false,
      message: "لا توجد بيانات للتحديث"
    });
  }

  try {
    await db.query(
      `
      UPDATE captains
      SET ${fields.join(", ")}
      WHERE id=?
      `,
      [...values, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE CAPTAIN ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /captains/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM captains WHERE id=?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE CAPTAIN ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   PUT /captains/:id/status
========================= */
router.put("/:id/status", async (req, res) => {
  const { status } = req.body;
  const valid = ["available", "busy", "offline", "inactive"];

  if (!valid.includes(status)) {
    return res.json({
      success: false,
      message: "حالة غير صحيحة"
    });
  }

  try {
    await db.query(
      "UPDATE captains SET status=? WHERE id=?",
      [status, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE CAPTAIN STATUS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
