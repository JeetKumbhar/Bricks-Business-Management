// Customers (shared by Bills and Pheeras).
export const CUSTOMER_KIND = Object.freeze({ NORMAL: "NORMAL", INTERNAL: "INTERNAL" });
export const CUSTOMER_KIND_VALUES = Object.freeze(Object.values(CUSTOMER_KIND));
export const INTERNAL_CUSTOMER_NAME = "Internal / No Bill"; // built-in; own-use and wastage trips; never billable
export const CUSTOMER_HISTORY = Object.freeze({ CREATE: "CREATE", UPDATE: "UPDATE", ARCHIVE: "ARCHIVE", RESTORE: "RESTORE" });
export const CUSTOMER_LIMITS = Object.freeze({ nameMin: 2, nameMax: 120, address: 300, reason: 200 });
