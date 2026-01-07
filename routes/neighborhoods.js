import express from "express";
import db from "../db.js";

const router = express.Router();

/* =========================
   SEARCH Neighborhoods
========================= */
router.get("/", async (req, res) => {
  const search = req.query.search || "";

  try {
    const [rows] = await db.query(
      `
      SELECT 
        n.id,
        n.name,
        n.delivery_fee,
        c.name AS city_name
      FROM neighborhoods n
      JOIN cities c ON c.id = n.city_id
      WHERE n.name LIKE ?
      ORDER BY n.id DESC
      `,
      [`%${search}%`]
    );

    res.json({
      success: true,
      neighborhoods: rows,
    });
  } catch (err) {
    console.error("GET NEIGHBORHOODS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   ADD Neighborhood
========================= */
router.post("/", async (req, res) => {
  try {
    const { city_id, name, delivery_fee } = req.body;

    if (!city_id || !name) {
      return res.json({ success: false, message: "البيانات ناقصة" });
    }

    await db.query(
      `
      INSERT INTO neighborhoods (city_id, name, delivery_fee)
      VALUES (?, ?, ?)
      `,
      [city_id, name, delivery_fee || 0]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD NEIGHBORHOOD ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   UPDATE Neighborhood
========================= */
router.put("/:id", async (req, res) => {
  const { city_id, name, delivery_fee } = req.body;

  if (!city_id || !name) {
    return res.status(400).json({
      success: false,
      message: "بيانات ناقصة",
    });
  }

  try {
    await db.query(
      `
      UPDATE neighborhoods
      SET city_id = ?, name = ?, delivery_fee = ?
      WHERE id = ?
      `,
      [city_id, name, delivery_fee || 0, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE NEIGHBORHOOD ERROR:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/* =========================
   DELETE Neighborhood
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM neighborhoods WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE NEIGHBORHOOD ERROR:", err);
    res.status(500).json({ success: false });
  }
});
/* =========================
   GET /neighborhoods/by-city/:cityId
========================= */
router.get("/by-city/:cityId", async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT id, name, delivery_fee, city_id
      FROM neighborhoods
      WHERE city_id = ?
      ORDER BY id DESC
      `,
      [req.params.cityId]
    );

    res.json({ success: true, neighborhoods: rows });
  } catch (err) {
    console.error("GET NEIGHBORHOODS BY CITY ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
