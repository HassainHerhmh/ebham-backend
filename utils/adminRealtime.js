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

/** يصل لكل غرف الداشبورد المفتوحة (فرع محدد أو الكل)، حتى لو branch_id ناقص من العميل */
export function emitAdminNotificationAllDashboards(io, payload = {}) {
  if (!io) return;

  const branchId = parseBranchId(payload.branch_id);
  const data = {
    ...payload,
    branch_id: branchId,
  };

  const rooms = new Set(["branch_all"]);
  if (branchId) rooms.add("branch_" + branchId);

  try {
    const adapterRooms = io.sockets?.adapter?.rooms;
    if (adapterRooms?.keys) {
      for (const room of adapterRooms.keys()) {
        if (/^branch_\d+$/.test(room)) rooms.add(room);
      }
    }
  } catch {
    /* ignore */
  }

  for (const room of rooms) {
    io.to(room).emit("admin_notification", data);
    if (data.type) {
      io.to(room).emit(data.type, data);
    }
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

export function parseBranchId(value) {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function resolveRequestBranchId(req) {
  return parseBranchId(req?.user?.branch_id);
}

export function resolveScopedBranchId(req) {
  const fromUser = resolveRequestBranchId(req);
  if (fromUser) return fromUser;
  return parseBranchId(req?.headers?.["x-branch-id"] || req?.query?.branch_id);
}

export function isHqAdminUser(user) {
  return Boolean(user?.is_admin_branch);
}
