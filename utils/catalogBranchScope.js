import { resolveScopedBranchId } from "./adminRealtime.js";

export function catalogBranchId(req) {
  return resolveScopedBranchId(req);
}

export function branchEqualsSql(alias, branchId) {
  if (!branchId) return { sql: "1=0", params: [] };
  const col = alias ? `${alias}.branch_id` : "branch_id";
  return { sql: `${col} = ?`, params: [Number(branchId)] };
}
