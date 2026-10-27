// Mirrors server/constants (to be added). One source of truth for the three worker types.
export const LABOUR_TYPES = {
  BIGARI: "BIGARI",
  MAAPVALI: "MAAPVALI",
  PATLAVALE: "PATLAVALE",
};

export const RATE_TYPES = {
  DAILY_RATE: "DAILY_RATE",
  RATE_PER_FOUR_MAAPS: "RATE_PER_FOUR_MAAPS",
  RATE_PER_1000_PAYABLE_BRICKS: "RATE_PER_1000_PAYABLE_BRICKS",
};

// `rateField` is the property on the labour record that holds this type's rate.
export const LABOUR_TYPE_META = {
  BIGARI: {
    label: "Bigari",
    earningsLabel: "Earned from attendance",
    noun: "worker",
    plural: "workers",
    badgeVariant: "info",
    description: "Individual worker paid by attendance and a daily rate.",
    nameLabel: "Name",
    mobileLabel: "Mobile",
    rateField: "dailyRate",
    rateType: RATE_TYPES.DAILY_RATE,
    rateLabel: "Daily rate",
    rateInputLabel: "Daily Rate (₹/day)",
    rateUnit: "per day",
    rateUnitShort: "/ day",
    ratePlaceholder: "e.g. 650",
    rateHint: undefined,
    rateLockedHint: "Change it from Rate History in the profile",
  },
  MAAPVALI: {
    label: "Maapvali",
    earningsLabel: "Earned from maaps",
    noun: "worker",
    plural: "workers",
    badgeVariant: "purple",
    description: "Individual worker who transports bricks, paid for every maap carried (rate set per 4 maaps).",
    nameLabel: "Name",
    mobileLabel: "Mobile",
    rateField: "ratePerFourMaaps",
    rateType: RATE_TYPES.RATE_PER_FOUR_MAAPS,
    rateLabel: "Rate per 4 maaps",
    rateInputLabel: "Rate per 4 Maaps (₹)",
    rateUnit: "per 4 maaps",
    rateUnitShort: "/ 4 maaps",
    ratePlaceholder: "e.g. 88",
    rateHint: "Rate for 4 maaps (1,000 bricks). Every maap is paid in proportion, e.g. 5 maaps = 1.25 x the rate.",
    rateLockedHint: "Rate changes for Maapvali are not available yet",
  },
  PATLAVALE: {
    label: "Patlavale",
    earningsLabel: "Earned from production",
    noun: "team",
    plural: "teams",
    badgeVariant: "warning",
    description: "Family / team that makes raw bricks. One salary account for the whole team.",
    nameLabel: "Team / Family Name",
    mobileLabel: "Contact Mobile",
    rateField: "ratePer1000PayableBricks",
    rateType: RATE_TYPES.RATE_PER_1000_PAYABLE_BRICKS,
    rateLabel: "Rate per 4 maaps / 1,000 payable bricks",
    rateInputLabel: "Team Rate per 4 Maaps / 1,000 Payable Bricks (₹)",
    rateUnit: "per 4 maaps (1,000 payable bricks)",
    rateUnitShort: "/ 4 maaps",
    ratePlaceholder: "e.g. 650",
    rateHint: "Rate for 4 maaps = 1,000 payable bricks. Every maap is paid in proportion (250 payable bricks each).",
    rateLockedHint: "Rate changes for Patlavale teams are not available yet",
  },
};

export const LABOUR_TYPE_OPTIONS = Object.entries(LABOUR_TYPE_META).map(([value, meta]) => ({ value, label: meta.label }));

// 4 maaps = 1,100 physical bricks (275 per maap), of which 1,000 are payable (250 per maap).
export const BRICKS_PER_MAAP = 275;
export const PAYABLE_BRICKS_PER_MAAP = 250;

// The rate is configured per 4 maaps (= 1,000 payable bricks); every maap is paid in proportion (maaps / 4 x rate).
export const MAAPS_PER_RATE_UNIT = 4;
