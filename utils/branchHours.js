import db from "../db.js";

export function getYemenNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Aden" }));
}

export function getBranchWorkDayIndex(date = getYemenNow()) {
  return (date.getDay() + 1) % 7;
}

function parseTimeMinutes(value) {
  if (!value || !String(value).includes(":")) return null;
  const [hours, minutes] = String(value).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

export function isOpenAtRange(from, to, closed, date = getYemenNow()) {
  if (Number(closed) === 1) return false;
  const openMinutes = parseTimeMinutes(from);
  const closeMinutesRaw = parseTimeMinutes(to);
  if (openMinutes === null || closeMinutesRaw === null) return false;
  if (openMinutes === closeMinutesRaw) return true;
  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  if (closeMinutesRaw > openMinutes) {
    return currentMinutes >= openMinutes && currentMinutes <= closeMinutesRaw;
  }
  return currentMinutes >= openMinutes || currentMinutes <= closeMinutesRaw;
}

export async function isBranchOpenNow(branchId, date = getYemenNow()) {
  const id = Number(branchId);
  if (!id) return true;

  const [[row]] = await db.query(
    `
    SELECT open_time, close_time, is_closed
    FROM branch_work_times
    WHERE branch_id = ?
      AND day_of_week = ?
    LIMIT 1
    `,
    [id, getBranchWorkDayIndex(date)]
  );

  if (!row) return true;
  return isOpenAtRange(row.open_time, row.close_time, row.is_closed, date);
}
