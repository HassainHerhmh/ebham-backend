import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* =========================
   GET /restaurants/:id/categories
========================= */
router.get("/:id/categories", async (req, res) => {
  try {
    const restaurantId = req.params.id;

    const [rows] = await db.query(
      `SELECT id, name 
       FROM categories 
       WHERE restaurant_id = ?
       ORDER BY id ASC`,
      [restaurantId]
    );

    res.json({ success: true, categories: rows });
  } catch (err) {
    console.error("GET RESTAURANT CATEGORIES ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   GET /restaurants/:id/products
========================= */
router.get("/:id/products", async (req, res) => {
  try {
    const restaurantId = req.params.id;

    const [rows] = await db.query(
      `SELECT 
         p.id,
         p.name,
         p.price,
         p.category_id
       FROM products p
       WHERE p.restaurant_id = ?
       ORDER BY p.id ASC`,
      [restaurantId]
    );

    res.json({ success: true, products: rows });
  } catch (err) {
    console.error("GET RESTAURANT PRODUCTS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
