import jwt from "jsonwebtoken";
import db from "../db.js";

export default async function auth(req, res, next) {
    const header = req.headers.authorization;

    // 1. التحقق من وجود الهيدر
    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "غير مصرح - التوكن مفقود",
        });
    }

    const token = header.split(" ")[1];

    try {
        // 2. فك تشفير التوكن
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        let userRecord = null;

        // 3. التوجيه الذكي بناءً على الدور (Role)
        if (decoded.role === "customer") {
            // البحث في جدول العملاء إذا كان المسجل "عميل"
            const [rows] = await db.query(
                "SELECT id, name, phone, 'customer' as role FROM customers WHERE id = ? LIMIT 1",
                [decoded.id]
            );
            userRecord = rows[0];
        } else {
            // البحث في جدول المستخدمين للإداريين والموظفين
            const [rows] = await db.query(
                "SELECT id, name, phone, role, branch_id FROM users WHERE id = ? LIMIT 1",
                [decoded.id]
            );
            userRecord = rows[0];
        }

        // 4. التحقق من وجود السجل في قاعدة البيانات
        if (!userRecord) {
            console.error(`❌ لم يتم العثور على سجل للدور ${decoded.role} بالمعرف ${decoded.id}`);
            return res.status(401).json({
                success: false,
                message: "مستخدم غير موجود في النظام المرفوع",
            });
        }

        // 5. بناء كائن المستخدم للطلبات اللاحقة (req.user)
        // نضمن وجود معرف العميل إذا كان الدور عميل
        req.user = {
            id: userRecord.id,
            role: userRecord.role,
            phone: userRecord.phone,
            customer_id: decoded.role === "customer" ? userRecord.id : null,
            branch_id: userRecord.branch_id || null,
        };

        // 6. السماح بتغيير الفرع عبر الهيدر (اختياري)
        const headerBranch = req.headers["x-branch-id"];
        if (headerBranch) {
            req.user.branch_id = Number(headerBranch);
        }

        console.log("✅ تم التوثيق بنجاح لـ:", req.user.phone);
        next();

    } catch (err) {
        console.error("AUTH ERROR:", err.message);
        return res.status(401).json({
            success: false,
            message: "توكن غير صالح أو منتهي الصلاحية",
        });
    }
}
