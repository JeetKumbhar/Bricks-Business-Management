// Mirrors client/src/utils/truckStatus.js and truckTrips.js. Same values, so the frontend needs no mapping.
export const TRUCK_STATUS = Object.freeze({ WORKING: "WORKING", STOPPED: "STOPPED", MAINTENANCE: "MAINTENANCE" });
export const TRUCK_STATUS_VALUES = Object.freeze(Object.values(TRUCK_STATUS));

export const STOP_REASONS = Object.freeze({ BREAKDOWN: "BREAKDOWN", TYRE_PUNCTURE: "TYRE_PUNCTURE", DRIVER_ABSENT: "DRIVER_ABSENT", OTHER: "OTHER" }); // OTHER needs a note
export const STOP_REASON_VALUES = Object.freeze(Object.values(STOP_REASONS));

export const HISTORY_KINDS = Object.freeze({ CREATED: "CREATED", STATUS: "STATUS", DRIVER: "DRIVER" });
export const HISTORY_KIND_VALUES = Object.freeze(Object.values(HISTORY_KINDS));

// Material choices for NEW Pheera entries: exactly three. Bricks and Soil have a fixed name; Other carries the real name.
export const MATERIAL_CATEGORY = Object.freeze({ BRICKS: "BRICKS", SOIL: "SOIL", OTHER: "OTHER" });
export const MATERIAL_CATEGORY_VALUES = Object.freeze(Object.values(MATERIAL_CATEGORY));

export const UNITS = Object.freeze({ BRICKS: "bricks", TONNES: "tonnes" });
export const UNIT_VALUES = Object.freeze(Object.values(UNITS));

// The material decides the label and the unit; the unit is still stored on every record.
export const MATERIAL_RULES = Object.freeze({
  BRICKS: Object.freeze({ name: "Bricks", unit: UNITS.BRICKS, quantityLabel: "Number of Bricks" }),
  SOIL: Object.freeze({ name: "Soil", unit: UNITS.TONNES, quantityLabel: "Weight (Tonnes)" }),
  OTHER: Object.freeze({ name: null, unit: UNITS.TONNES, quantityLabel: "Weight (Tonnes)" }),
});
// A custom material may not reuse a standard name, or "Bricks" could be saved in tonnes.
export const RESERVED_MATERIAL_KEYS = Object.freeze(["bricks", "soil"]);

// [OPEN with the client] sanity limits, same as the frontend's.
export const MAX_BRICKS_PER_PHEERA = 100000;
export const MAX_TONNES_PER_PHEERA = 100;
export const MAX_TONNE_DECIMALS = 3;

export const MIN_MATERIAL_NAME = 2;
export const MAX_MATERIAL_NAME = 40;
export const MIN_DESTINATION = 2;
export const MAX_DESTINATION = 60;
export const MAX_REMARKS = 200;
export const MAX_TRIPS_PER_BATCH = 50;
export const MAX_TRUCK_NUMBER = 20;
export const MAX_NICKNAME = 30;
export const MAX_MODEL = 60;
export const MAX_NOTE = 200;
export const MAX_CAPACITY_TONNES = 1000;
