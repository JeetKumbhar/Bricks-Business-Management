// Indian-system words for an amount given in PAISE: "Rupees Forty Five Thousand Only", "Rupees One Hundred and Fifty Paise Only".
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const below1000 = (n) => {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? below100(rest) : ""].filter(Boolean).join(" ");
};

/** A whole number (BigInt-safe up to the safe-integer limit) in Indian words; 0 gives "Zero". */
export const numberToIndianWords = (value) => {
  let n = BigInt(value);
  if (n === 0n) return "Zero";
  const parts = [];
  const take = (divisor, label) => {
    const q = n / divisor;
    n %= divisor;
    if (q > 0n) parts.push(`${numberToIndianWords(q)} ${label}`);
  };
  take(10_000_000_000_000n, "Lakh Crore"); // only reached for huge totals; keeps the output readable
  take(10_000_000n, "Crore");
  take(100_000n, "Lakh");
  take(1000n, "Thousand");
  if (n > 0n) parts.push(below1000(Number(n)));
  return parts.join(" ");
};

export const amountInWords = (paise) => {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new RangeError("amount must be a non-negative whole number of paise");
  const rupees = Math.floor(paise / 100);
  const ps = paise % 100;
  const rupeeText = `Rupees ${numberToIndianWords(rupees)}`;
  return ps ? `${rupeeText} and ${numberToIndianWords(ps)} Paise Only` : `${rupeeText} Only`;
};
