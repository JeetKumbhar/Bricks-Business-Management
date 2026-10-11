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
    description: "Individual worker paid by attendance and a daily rate",
    rateField: "dailyRate",
    rateType: RATE_TYPES.DAILY_RATE,
    rateLabel: "Daily rate",
    rateUnit: "per day",
  },
  MAAPVALI: {
    label: "Maapvali",
    description: "Individual worker who transports bricks, paid per maap",
    rateField: "ratePerMaap",
    rateType: RATE_TYPES.RATE_PER_MAAP,
    rateLabel: "Rate per maap",
    rateUnit: "per maap",
  },
  PATLAVALE: {
    label: "Patlavale",
    description: "Family / team that makes raw bricks, paid per 1,000 payable bricks",
    rateField: "ratePer1000PayableBricks",
    rateType: RATE_TYPES.RATE_PER_1000_PAYABLE_BRICKS,
    rateLabel: "Rate per 1,000 payable bricks",
    rateUnit: "per 1,000 payable bricks",
  },
};

// 1 maap is approximately 275 bricks; 4 maaps = 1,100 physical bricks.
export const BRICKS_PER_MAAP = 275;

// Patlavale: every completed group of 1,100 physical bricks pays for 1,000 bricks.
export const PHYSICAL_BRICKS_PER_GROUP = 1100;
export const PAYABLE_BRICKS_PER_GROUP = 1000;
