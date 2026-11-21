// A worker's mobile number is optional and may be shared by several workers. "No number" is null (the server stores null, never "").
/** Form text or a stored value -> a trimmed number, or null when there is none. */
export const normalizeMobile = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text;
};
/** For display: the number, or a dash. */
export const mobileText = (value) => normalizeMobile(value) ?? "-";
