// Roles (docs/BUSINESS_RULES.md section 8). Only OWNER exists in practice today: the frontend shows a single Owner and
// there is no user-management screen. MANAGER and STAFF are defined so the model and requireRole() need no change
// when the owner confirms them; nothing grants them access yet.
export const ROLES = Object.freeze({
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  STAFF: "STAFF",
});

export const ROLE_VALUES = Object.freeze(Object.values(ROLES));
