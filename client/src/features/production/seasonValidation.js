// Season form check (mirrors server/validators/season.validators.js: name 2-60 characters, start date required, end date optional and not before the start). The server re-checks, and also refuses overlapping seasons.
/** Checks the season form. endDate is optional (an ongoing season). */
export const validateSeason = ({ name, startDate, endDate }) => {
  const errors = {};
  const trimmed = String(name ?? "").trim();
  if (trimmed.length < 2) errors.name = "Season name is required";
  else if (trimmed.length > 60) errors.name = "Season name is too long";
  if (!startDate) errors.startDate = "Start date is required";
  if (endDate && startDate && endDate < startDate) errors.endDate = "End date must be on or after the start date";
  return errors;
};
