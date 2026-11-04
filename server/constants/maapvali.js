// Mirrors client/src/utils/workCalculations.js (MAX_MAAPS_PER_ENTRY). A technical limit that guards typing mistakes
// such as an extra digit; it is not a business rule.
export const MAX_MAAPS_PER_ENTRY = 9999;
export const MAX_NOTE_LENGTH = 200;
// Most workers one "save the day" request may carry.
export const MAX_ROWS_PER_SAVE = 500;
// Used when a save changes an existing entry and no reason was sent (today's entries need none).
export const DEFAULT_CORRECTION_REASON = "Daily entry updated";
