import express from "express";
import db from "../db.js";

const router = express.Router();


router.get("/", async (req,res)=>{

const [rows] = await db.query(`
SELECT *
FROM coupon_codes
ORDER BY id DESC
`);

res.json(rows);

});
/* =====================================
   إنشاء كود خصم
===================================== */

router.post("/", async (req,res)=>{

try{

const {
code,
discount_percent,
discount_amount,
apply_on,
start_date,
end_date,
max_uses,
users
} = req.body;

if(!code){
return res.status(400).json({
success:false,
message:"كود الخصم مطلوب"
});
}

const [result] = await db.query(`
INSERT INTO coupon_codes
(
code,
discount_percent,
discount_amount,
apply_on,
start_date,
end_date,
max_uses
)
VALUES (?,?,?,?,?,?,?)
`,[
code,
discount_percent || 0,
discount_amount || 0,
apply_on || "total",
start_date || null,
end_date || null,
max_uses || 100
]);

const couponId = result.insertId;

/* ربط العملاء */

if(users && users.length){

for(const userId of users){

await db.query(`
INSERT INTO coupon_users
(coupon_id,user_id)
VALUES (?,?)
`,[couponId,userId]);

}

}

res.json({
success:true,
coupon_id:couponId
});

}catch(err){

console.error(err);

res.status(500).json({
success:false,
message:"فشل إنشاء الكود"
});

}

});


/* =====================================
   التحقق من الكود
===================================== */

router.post("/check", async (req,res)=>{

try{

const { code, user_id } = req.body;

if(!code){
return res.json({
success:false,
message:"أدخل كود الخصم"
});
}

/* البحث عن الكود */

const [rows] = await db.query(`
SELECT *
FROM coupon_codes
WHERE code=?
AND (start_date IS NULL OR start_date <= NOW())
AND (end_date IS NULL OR end_date >= NOW())
`,[code]);

if(!rows.length){
return res.json({
success:false,
message:"الكود غير صالح"
});
}

const coupon = rows[0];

/* التحقق من عدد الاستخدام */

if(coupon.used_count >= coupon.max_uses){

return res.json({
success:false,
message:"انتهى عدد استخدام الكود"
});

}

/* التحقق من المستخدم */

const [users] = await db.query(`
SELECT *
FROM coupon_users
WHERE coupon_id=?
`,[coupon.id]);

if(users.length){

const allowed = users.find(u=>u.user_id === user_id);

if(!allowed){

return res.json({
success:false,
message:"الكود غير مخصص لك"
});

}

}

res.json({
success:true,
coupon
});

}catch(err){

console.error(err);

res.status(500).json({
success:false,
message:"خطأ في التحقق من الكود"
});

}

});


/* =====================================
   تسجيل استخدام الكود
===================================== */

router.post("/:id/use", async (req,res)=>{

try{

const { id } = req.params;

await db.query(`
UPDATE coupon_codes
SET used_count = used_count + 1
WHERE id=?
`,[id]);

res.json({
success:true
});

}catch(err){

console.error(err);

res.status(500).json({
success:false
});

}

});


/* =====================================
   جلب جميع الكوبونات للوحة التحكم
===================================== */

router.get("/admin", async (req,res)=>{

try{

const [rows] = await db.query(`
SELECT *
FROM coupon_codes
ORDER BY id DESC
`);

res.json(rows);

}catch(err){

console.error(err);

res.status(500).json({
error:"فشل تحميل الكوبونات"
});

}

});

export default router;
