import express from "express";
import db from "../db.js";

const router = express.Router();

/* =========================
   GET /customer-addresses
========================= */

router.get("/", async (req, res) => {
  const { customer_id } = req.query;

  if (!customer_id) {
    return res.status(400).json({
      success: false,
      message: "customer_id is required",
    });
  }

  try {
    const [rows] = await db.query(
      `
      SELECT
        ca.id,
        ca.customer_id,
        ci.name AS city_name,
        n.name AS neighborhood_name,
        ca.location_type,
        ca.address,
        ca.latitude,
        ca.longitude
      FROM customer_addresses ca
      JOIN cities ci ON ci.id = ca.province
      JOIN neighborhoods n ON n.id = ca.district
      WHERE ca.customer_id = ?
      ORDER BY ca.id DESC
    `,
      [customer_id]
    );

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
