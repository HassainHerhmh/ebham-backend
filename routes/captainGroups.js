import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* GET /captain-groups */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name FROM captain_groups ORDER BY id DESC"
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
});

/* POST /captain-groups */
router.post("/", async (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.json({ success: false, message: "بيانات ناقصة" });
  }

  const [result] = await db.query(
    "INSERT INTO captain_groups (name) VALUES (?)",
    [name]
  );

  res.json({
    success: true,
    id: result.insertId,
    name,
  });
});

/* DELETE /captain-groups/:id */
router.delete("/:id", async (req, res) => {
  await db.query("DELETE FROM captain_groups WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

export default router;
