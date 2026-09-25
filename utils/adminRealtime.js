/**
 * إشعارات ولوحة الداشبورد حسب الفرع فقط.
 * الغرف: branch_<id>  |  branch_all (الإدارة العامة عند عرض الكل)
 */
export function emitAdminNotification(io, payload = {}) {
  if (!io) return;

  const branchId =
    payload.branch_id != null && payload.branch_id !== ""
      ? Number(payload.branch_id)
      : null;

  const data = {
    ...payload,
    branch_id: Number.isFinite(branchId) ? branchId : null,
  };

  if (Number.isFinite(branchId) && branchId > 0) {
    io.to("branch_" + branchId).emit("admin_notification", data);
    if (data.type) {
      io.to("branch_" + branchId).emit(data.type, data);
    }
  }

  io.to("branch_all").emit("admin_notification", data);
  if (data.type) {
    io.to("branch_all").emit(data.type, data);
  }
}

export function joinDashboardBranchRooms(socket, branchId) {
  for (const room of socket.rooms) {
    if (room.startsWith("branch_")) {
      socket.leave(room);
    }
  }

  if (branchId === "all" || branchId === "" || branchId == null) {
    socket.join("branch_all");
    return;
  }

  const id = Number(branchId);
  if (Number.isFinite(id) && id > 0) {
    socket.join("branch_" + id);
  }
}

export function resolveRequestBranchId(req) {
  const n = Number(req?.user?.branch_id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function isHqAdminUser(user) {
  return Boolean(user?.is_admin_branch);
}
