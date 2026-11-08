// Amount in words in the Indian system (thousand, lakh, crore). Input is whole paise.
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const below1000 = (n) => {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? below100(r) : ""].filter(Boolean).join(" ");
};

/** Whole number -> words, e.g. 123456 -> "One Lakh Twenty Three Thousand Four Hundred Fifty Six" ("" for 0) */
export const numberToIndianWords = (n) => {
  let rest = Math.floor(n);
  const parts = [];
  for (const [size, name] of [[1e7, "Crore"], [1e5, "Lakh"], [1e3, "Thousand"]]) {
    const count = Math.floor(rest / size);
    if (count > 0) parts.push(`${numberToIndianWords(count)} ${name}`);
    rest %= size;
  }
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(" ");
};

/** 4500000 paise -> "Rupees Forty Five Thousand Only." ; 1250 -> "Rupees Twelve and Fifty Paise Only." ; 0 -> "Rupees Zero Only." */
export const amountInWords = (paise) => {
  const total = Math.max(0, Math.round(Number(paise) || 0));
  const rupees = Math.floor(total / 100);
  const ps = total % 100;
  const rupeeWords = rupees === 0 ? "Zero" : numberToIndianWords(rupees);
  if (ps === 0) return `Rupees ${rupeeWords} Only.`;
  return `Rupees ${rupeeWords} and ${below100(ps)} Paise Only.`;
};
