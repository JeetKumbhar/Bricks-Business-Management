import { LABOUR_STATUS } from "./labourStatus";
import { LABOUR_TYPES } from "./labourTypes";

export const TRUCK_STATUS = { WORKING: "WORKING", STOPPED: "STOPPED", MAINTENANCE: "MAINTENANCE" };

export const TRUCK_STATUS_META = {
  WORKING: { label: "Working", variant: "success" },
  STOPPED: { label: "Stopped", variant: "danger" },
  MAINTENANCE: { label: "Maintenance", variant: "warning" },
};

export const STOP_REASONS = {
  BREAKDOWN: "BREAKDOWN",
  TYRE_PUNCTURE: "TYRE_PUNCTURE",
  DRIVER_ABSENT: "DRIVER_ABSENT",
  OTHER: "OTHER", // needs a note
};

export const STOP_REASON_LABELS = {
  BREAKDOWN: "Breakdown",
  TYRE_PUNCTURE: "Tyre puncture",
  DRIVER_ABSENT: "Driver absent",
  OTHER: "Other",
};

/**
 * [OPEN - confirm with the client] Do drivers still need to be linked to labour records?
 * While this is true the driver is chosen from eligible labour records. Set it to false to remove the link
 * (the driver field then becomes free text elsewhere). Trucks never affect labour earnings either way.
 */
export const DRIVERS_LINKED_TO_LABOUR = true;

/** Eligible drivers: active individual workers (a Patlavale team is a family, not a person). */
export const isEligibleDriver = (labour) =>
  labour.status === LABOUR_STATUS.ACTIVE &&
  (labour.labourType === LABOUR_TYPES.BIGARI || labour.labourType === LABOUR_TYPES.MAAPVALI);
