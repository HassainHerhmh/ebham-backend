import admin from "firebase-admin";
import db from "../db.js";

/**
 * دالة إرسال إشعار للكابتن
 */
export async function notifyCaptain(captainId, title, body, data = {}) {
  try {
    // جلب التوكن من قاعدة البيانات
    const [rows] = await db.query("SELECT fcm_token FROM captains WHERE id=?", [captainId]);
    const cap = rows[0];

    if (cap?.fcm_token) {
      const message = {
        token: cap.fcm_token,
        notification: { title, body },
        data: { 
          ...data, 
          type: "order_update",
          click_action: "FLUTTER_NOTIFICATION_CLICK" 
        },
        android: {
          priority: "high",
          notification: {
            sound: "default",
            channelId: "orders_channel", // يجب أن يتطابق مع المعرف في كود الأندرويد
          },
        },
      };

      await admin.messaging().send(message);
      console.log(`✅ تم إرسال الإشعار للكابتن رقم: ${captainId}`);
    } else {
      console.log(`⚠️ لا يوجد fcm_token للكابتن رقم: ${captainId}`);
    }
  } catch (err) {
    console.error("❌ خطأ في إرسال FCM:", err.message);
  }
}
