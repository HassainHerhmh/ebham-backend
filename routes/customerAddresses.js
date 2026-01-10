import express from "express";
import db from "../db.js";

const router = express.Router();

/* =========================
   GET /customer-addresses
========================= */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        ca.id,
        ca.customer_id,
        c.name AS customer_name,

        ca.province,
        ca.district,

        ci.name AS city_name,
        n.name AS neighborhood_name,

        ca.location_type,
        ca.address,
        ca.gps_link,
        ca.latitude,
        ca.longitude,
        ca.created_at
      FROM customer_addresses ca
      JOIN customers c ON c.id = ca.customer_id
      JOIN cities ci ON ci.id = ca.province
      JOIN neighborhoods n ON n.id = ca.district
      ORDER BY ca.id DESC
    `);

    res.json({ success: true, addresses: rows });
  } catch (err) {
    console.error("GET ADDRESSES ERROR:", err);
    res.status(500).json({ success: false });
  }
});


/* =========================
   POST /customer-addresses
========================= */
router.post("/", async (req, res) => {
  const {
    customer_id,
    province,
    district,
    location_type,
    address,
    gps_link,
    latitude,
    longitude
  } = req.body;

  try {
    await db.query(`
      INSERT INTO customer_addresses
      (customer_id, province, district, location_type, address, gps_link, latitude, longitude)
      VALUES (?,?,?,?,?,?,?,?)
    `, [
      customer_id,
      province,
      district,
      location_type,
      address,
      gps_link,
      latitude,
      longitude
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error("ADD ADDRESS ERROR:", err);
    res.status(500).json({ success: false });
  }
});


/* =========================
   DELETE /customer-addresses/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query(
      "DELETE FROM customer_addresses WHERE id=?",
      [req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE ADDRESS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;


