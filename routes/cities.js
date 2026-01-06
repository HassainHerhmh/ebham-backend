import express from "express";
import db from "../db.js";

const router = express.Router();

/* =========================
   GET /cities
   + عدد الأحياء
========================= */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        c.id,
        c.name,
        c.delivery_fee,
        COUNT(n.id) AS neighborhoods
      FROM cities c
      LEFT JOIN neighborhoods n ON n.city_id = c.id
      GROUP BY c.id
      ORDER BY c.id DESC
    `);

    res.json({ success: true, cities: rows });
  } catch (err) {
    console.error("GET CITIES ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /cities
========================= */
router.post("/", async (req, res) => {
  const { name, delivery_fee } = req.body;

  if (!name) {
    return res.json({ success: false, message: "اسم المدينة مطلوب" });
  }

  try {
    await db.query(
      "INSERT INTO cities (name, delivery_fee) VALUES (?, ?)",
      [name, delivery_fee || 0]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD CITY ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /cities/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM cities WHERE id=?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE CITY ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   GET /cities/neighborhoods
   (بحث)
========================= */
router.get("/neighborhoods/search", async (req, res) => {
  const q = req.query.q || "";

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
      [`%${q}%`]
    );

    res.json({ success: true, neighborhoods: rows });
  } catch (err) {
    console.error("SEARCH NEIGHBORHOODS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /cities/neighborhoods
========================= */
router.post("/neighborhoods", async (req, res) => {
  const { city_id, name, delivery_fee } = req.body;

  if (!city_id || !name) {
    return res.json({ success: false, message: "بيانات ناقصة" });
  }

  try {
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
   PUT /cities/neighborhoods/:id
========================= */
router.put("/neighborhoods/:id", async (req, res) => {
  const { name, delivery_fee, city_id } = req.body;

  try {
    await db.query(
      `
      UPDATE neighborhoods
      SET name=?, delivery_fee=?, city_id=?
      WHERE id=?
      `,
      [name, delivery_fee || 0, city_id, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE NEIGHBORHOOD ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /cities/neighborhoods/:id
========================= */
router.delete("/neighborhoods/:id", async (req, res) => {
  try {
    await db.query(
      "DELETE FROM neighborhoods WHERE id=?",
      [req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE NEIGHBORHOOD ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
