// Mirrors the labour status values used by the server.
export const LABOUR_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
};

export const LABOUR_STATUS_META = {
  ACTIVE: { label: "Active", variant: "success" },
  INACTIVE: { label: "Inactive", variant: "danger" },
};

export const LABOUR_STATUS_OPTIONS = [
  { value: LABOUR_STATUS.ACTIVE, label: "Active" },
  { value: LABOUR_STATUS.INACTIVE, label: "Inactive" },
];
