// Mirrors server/constants (to be added). One source of truth for the three worker types.
export const LABOUR_TYPES = {
  BIGARI: "BIGARI",
  MAAPVALI: "MAAPVALI",
  PATLAVALE: "PATLAVALE",
};

export const RATE_TYPES = {
  DAILY_RATE: "DAILY_RATE",
  RATE_PER_MAAP: "RATE_PER_MAAP",
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
    description: "Individual worker who transports bricks, paid for every maap carried.",
    nameLabel: "Name",
    mobileLabel: "Mobile",
    rateField: "ratePerMaap",
    rateType: RATE_TYPES.RATE_PER_MAAP,
    rateLabel: "Rate per maap",
    rateInputLabel: "Rate per Maap (₹/maap)",
    rateUnit: "per maap",
    rateUnitShort: "/ maap",
    ratePlaceholder: "e.g. 22",
    rateHint: "One maap is about 275 bricks. Each worker has their own rate.",
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
    rateLabel: "Rate per 1,000 payable bricks",
    rateInputLabel: "Team Rate per 1,000 Payable Bricks (₹)",
    rateUnit: "per 1,000 payable bricks",
    rateUnitShort: "/ 1,000 bricks",
    ratePlaceholder: "e.g. 650",
    rateHint: "Every 1,100 physical bricks pay for 1,000 payable bricks.",
    rateLockedHint: "Rate changes for Patlavale teams are not available yet",
  },
};

export const LABOUR_TYPE_OPTIONS = Object.entries(LABOUR_TYPE_META).map(([value, meta]) => ({ value, label: meta.label }));

// 1 maap is approximately 275 bricks; 4 maaps = 1,100 physical bricks.
export const BRICKS_PER_MAAP = 275;

// Patlavale: every completed group of 1,100 physical bricks pays for 1,000 bricks.
export const PHYSICAL_BRICKS_PER_GROUP = 1100;
export const PAYABLE_BRICKS_PER_GROUP = 1000;
