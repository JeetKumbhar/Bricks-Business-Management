// Mirrors client/src/utils/labourTypes.js and labourStatus.js. Same values, so the frontend needs no mapping.
export const LABOUR_TYPES = Object.freeze({ BIGARI: "BIGARI", MAAPVALI: "MAAPVALI", PATLAVALE: "PATLAVALE" });
export const LABOUR_TYPE_VALUES = Object.freeze(Object.values(LABOUR_TYPES));

export const LABOUR_STATUS = Object.freeze({ ACTIVE: "ACTIVE", INACTIVE: "INACTIVE" });
export const LABOUR_STATUS_VALUES = Object.freeze(Object.values(LABOUR_STATUS));

export const RATE_TYPES = Object.freeze({
  DAILY_RATE: "DAILY_RATE",
  RATE_PER_FOUR_MAAPS: "RATE_PER_FOUR_MAAPS",
  RATE_PER_1000_PAYABLE_BRICKS: "RATE_PER_1000_PAYABLE_BRICKS",
});
export const RATE_TYPE_VALUES = Object.freeze(Object.values(RATE_TYPES));

// Each type has exactly ONE rate, and its rate type and API field name are fixed by the type:
//   BIGARI    daily rate                          -> dailyRate
//   MAAPVALI  rate for 4 maaps                    -> ratePerFourMaaps
//   PATLAVALE rate for 4 maaps = 1,000 payable    -> ratePer1000PayableBricks   (a team / family, one salary account)
export const LABOUR_TYPE_META = Object.freeze({
  BIGARI: Object.freeze({ label: "Bigari", rateType: RATE_TYPES.DAILY_RATE, rateField: "dailyRate", isTeam: false }),
  MAAPVALI: Object.freeze({ label: "Maapvali", rateType: RATE_TYPES.RATE_PER_FOUR_MAAPS, rateField: "ratePerFourMaaps", isTeam: false }),
  PATLAVALE: Object.freeze({
    label: "Patlavale",
    rateType: RATE_TYPES.RATE_PER_1000_PAYABLE_BRICKS,
    rateField: "ratePer1000PayableBricks",
    isTeam: true,
  }),
});

export const LABOUR_ID_PATTERN = /^L-\d{3,}$/;
export const MOBILE_PATTERN = /^[6-9]\d{9}$/;
export const MAX_RATE_RUPEES = 100000;
export const MAX_TEAM_MEMBERS = 30;
