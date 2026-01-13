router.get("/", async (req, res) => {
  try {
    const { is_admin_branch, branch_id } = req.user;
    const selectedBranch = req.headers["x-branch-id"];

    let rows;

    if (is_admin_branch) {
      // المستخدم من الإدارة العامة

      // إذا الهيدر مختار فرع غير الإدارة العامة
      if (selectedBranch && Number(selectedBranch) !== branch_id) {
        [rows] = await db.query(
          `
          SELECT c.*, b.name AS branch_name
          FROM captains c
          LEFT JOIN branches b ON b.id = c.branch_id
          WHERE c.branch_id = ?
          ORDER BY c.id DESC
          `,
          [selectedBranch]
        );
      } else {
        // داخل الإدارة العامة → كل الكباتن من كل الفروع
        [rows] = await db.query(`
          SELECT c.*, b.name AS branch_name
          FROM captains c
          LEFT JOIN branches b ON b.id = c.branch_id
          ORDER BY c.id DESC
        `);
      }
    } else {
      // مستخدم فرع عادي → يرى فرعه فقط
      [rows] = await db.query(
        `
        SELECT c.*, b.name AS branch_name
        FROM captains c
        LEFT JOIN branches b ON b.id = c.branch_id
        WHERE c.branch_id = ?
        ORDER BY c.id DESC
        `,
        [branch_id]
      );
    }

    res.json({ success: true, captains: rows });
  } catch (err) {
    console.error("GET CAPTAINS ERROR:", err);
    res.status(500).json({ success: false });
  }
});
