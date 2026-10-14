import { LABOUR_TYPES } from "../../../utils/labourTypes";

/**
 * Tabs for each labour type. Tabs that do not apply are simply not listed:
 *  - only a Bigari has an Attendance tab (attendance is not the earnings source for Maapvali or Patlavale)
 *  - Maapvali show "Maap Work", Patlavale teams show "Production"
 * The id "work" holds the type's own work history; "attendance" exists for Bigari only.
 */
export const PROFILE_TABS = {
  [LABOUR_TYPES.BIGARI]: [
    { id: "overview", label: "Overview" },
    { id: "attendance", label: "Attendance" },
    { id: "payments", label: "Payments" },
    { id: "rate-history", label: "Rate History" },
  ],
  [LABOUR_TYPES.MAAPVALI]: [
    { id: "overview", label: "Overview" },
    { id: "work", label: "Maap Work" },
    { id: "payments", label: "Payments" },
    { id: "rate-history", label: "Rate" },
  ],
  [LABOUR_TYPES.PATLAVALE]: [
    { id: "overview", label: "Overview" },
    { id: "work", label: "Production" },
    { id: "payments", label: "Payments" },
    { id: "rate-history", label: "Team Rate" },
  ],
};

export const getProfileTabs = (labourType) => PROFILE_TABS[labourType] ?? PROFILE_TABS[LABOUR_TYPES.BIGARI];
