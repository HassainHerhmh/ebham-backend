import admin from "../config/firebase.js";
import db from "../db.js";

export async function sendNotificationToCaptain(captainId, title, body) {

  try {

    const [[captain]] = await db.query(
      "SELECT fcm_token FROM captains WHERE id=?",
      [captainId]
    );

    if (!captain?.fcm_token) return;

    await admin.messaging().send({
      token: captain.fcm_token,
      notification: {
        title,
        body
      },
      android: {
        priority: "high"
      }
    });

    console.log("Notification sent");

  }
  catch(err){

    console.error(err);

  }

}
