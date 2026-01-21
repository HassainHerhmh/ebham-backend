import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

// GET
router.get("/", async (req, res) => {
  const [rows] = await db.query(
    "SELECT id, name, code FROM agent_groups ORDER BY id DESC"
  );
  res.json(rows);
});

// POST
router.post("/", async (req, res) => {
  const { name, code } = req.body;

  if (!name || !code)
    return res.status(400).json({ message: "name & code required" });

  try {
    await db.query(
      "INSERT INTO agent_groups (name, code) VALUES (?, ?)",
      [name, code]
    );
    res.json({ success: true });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "code exists" });
    }
    throw err;
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  await db.query("DELETE FROM agent_groups WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

export default router;
