import express from "express"
import db from "../db.js"

const router = express.Router()


// جلب كل الحملات
router.get("/", async (req,res) => {

  try {

    const [rows] = await db.query(`
      SELECT 
      id,
      name,
      type,
      status,
      reach,
      conversions,
      budget,
      start_date as startDate
      FROM campaigns
      ORDER BY id DESC
    `)

    res.json(rows)

  } catch(err){
    console.error(err)
    res.status(500).json({error:"server error"})
  }

})



// إنشاء حملة
router.post("/", async (req,res) => {

  const {
    name,
    type,
    status,
    budget,
    startDate
  } = req.body

  try {

    const [result] = await db.query(`
      INSERT INTO campaigns
      (name,type,status,budget,start_date)
      VALUES (?,?,?,?,?)
    `,[name,type,status,budget,startDate])

    res.json({
      success:true,
      id:result.insertId
    })

  } catch(err){
    console.error(err)
    res.status(500).json({error:"server error"})
  }

})



// تعديل حملة
router.put("/:id", async (req,res)=>{

  const {name,type,status,budget,startDate} = req.body

  try{

    await db.query(`
      UPDATE campaigns
      SET
      name=?,
      type=?,
      status=?,
      budget=?,
      start_date=?
      WHERE id=?
    `,[name,type,status,budget,startDate,req.params.id])

    res.json({success:true})

  }catch(err){
    console.error(err)
    res.status(500).json({error:"server error"})
  }

})



// حذف حملة
router.delete("/:id", async (req,res)=>{

  try{

    await db.query(
      "DELETE FROM campaigns WHERE id=?",
      [req.params.id]
    )

    res.json({success:true})

  }catch(err){
    console.error(err)
    res.status(500).json({error:"server error"})
  }

})

export default router
