import { describe, expect, it } from "vitest";
import {
  divideRoundHalfUp,
  earningsPaiseForMaaps,
  paiseToRupeeString,
  paiseToRupees,
  parseRupeesInput,
  payableBricksForMaaps,
  physicalBricksForMaaps,
  rupeesToPaise,
  sumPaise,
} from "../utils/money.js";

describe("rupeesToPaise", () => {
  it.each([
    ["250", 25000],
    [250, 25000],
    ["62.50", 6250],
    ["62.5", 6250],
    [62.5, 6250],
    ["2562.50", 256250],
    ["0.05", 5],
    ["0", 0],
    ["  88.5 ", 8850],
    ["1234567.89", 123456789],
  ])("%j -> %i paise", (input, expected) => {
    expect(rupeesToPaise(input)).toBe(expected);
  });

  it("is exact where float multiplication is not (19.99 * 100 = 1998.9999999999998)", () => {
    expect(19.99 * 100).not.toBe(1999);
    expect(rupeesToPaise("19.99")).toBe(1999);
    expect(rupeesToPaise(19.99)).toBe(1999);
    expect(rupeesToPaise(1.15)).toBe(115);
  });

  it.each([["0.30000000000000004"], [0.1 + 0.2], ["1.234"], ["abc"], [""], [null], [undefined], [NaN], [Infinity], ["1e3"], ["-5"], ["1,000"], ["₹5"]])(
    "rejects %j",
    (input) => {
      expect(() => rupeesToPaise(input)).toThrow(RangeError);
    }
  );

  it("accepts a negative amount only when asked (corrections)", () => {
    expect(rupeesToPaise("-5.50", { allowNegative: true })).toBe(-550);
  });

  it("rejects amounts beyond the exact integer range", () => {
    expect(() => rupeesToPaise("99999999999999999")).toThrow(RangeError);
  });
});

describe("parseRupeesInput", () => {
  it("throws a 400 ApiError with the field name", () => {
    try {
      parseRupeesInput("1.234", "amount");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err.statusCode).toBe(400);
      expect(err.errors[0].field).toBe("amount");
    }
  });
});

describe("paise output", () => {
  it("converts back to rupees and to exact text", () => {
    expect(paiseToRupees(256250)).toBe(2562.5);
    expect(paiseToRupeeString(256250)).toBe("2562.50");
    expect(paiseToRupeeString(5)).toBe("0.05");
    expect(paiseToRupeeString(0)).toBe("0.00");
    expect(paiseToRupeeString(-550)).toBe("-5.50");
  });

  it("refuses fractional paise", () => {
    expect(() => paiseToRupees(10.5)).toThrow(RangeError);
  });
});

describe("sumPaise", () => {
  it("adds exactly where rupee floats drift", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumPaise([rupeesToPaise("0.10"), rupeesToPaise("0.20")])).toBe(rupeesToPaise("0.30"));
    // 10,000 payments of ₹0.10 total exactly ₹1,000.00
    expect(sumPaise(Array(10000).fill(10))).toBe(100000);
    expect(Array(10000).fill(0.1).reduce((a, b) => a + b, 0)).not.toBe(1000);
  });
});

describe("divideRoundHalfUp", () => {
  it.each([
    [10, 4, 3],
    [9, 4, 2],
    [11, 4, 3],
    [8, 4, 2],
    [0, 4, 0],
    [2212, 1, 2212],
  ])("%i / %i -> %i", (n, d, expected) => {
    expect(divideRoundHalfUp(n, d)).toBe(expected);
  });
});

// The agreed examples: rate ₹250 per 4 maaps, every maap paid in proportion, nothing floored or carried forward.
describe("earningsPaiseForMaaps (rate per 4 maaps)", () => {
  const rate = rupeesToPaise("250");
  it.each([
    [1, "62.50"],
    [4, "250.00"],
    [5, "312.50"],
    [40, "2500.00"],
    [41, "2562.50"],
    [0, "0.00"],
  ])("%i maaps at ₹250 per 4 = ₹%s", (maaps, expected) => {
    expect(paiseToRupeeString(earningsPaiseForMaaps(maaps, rate))).toBe(expected);
  });

  it("pays the leftover maap on top of the 40", () => {
    expect(earningsPaiseForMaaps(41, rate) - earningsPaiseForMaaps(40, rate)).toBe(6250);
  });

  it("rounds half a paisa up, like the frontend (1 maap at ₹88.50 per 4 = ₹22.125 -> ₹22.13)", () => {
    expect(earningsPaiseForMaaps(1, rupeesToPaise("88.5"))).toBe(2213);
    expect(earningsPaiseForMaaps(3, rupeesToPaise("88.5"))).toBe(6638);
  });

  it("rejects fractional maaps, negatives and fractional-paise rates", () => {
    expect(() => earningsPaiseForMaaps(1.5, rate)).toThrow(RangeError);
    expect(() => earningsPaiseForMaaps(-1, rate)).toThrow(RangeError);
    expect(() => earningsPaiseForMaaps(1, 62.5)).toThrow(RangeError);
  });
});

describe("Patlavale bricks", () => {
  it.each([
    [1, 250],
    [3, 750],
    [4, 1000],
    [5, 1250],
    [7, 1750],
  ])("%i maaps = %i payable bricks", (maaps, expected) => {
    expect(payableBricksForMaaps(maaps)).toBe(expected);
  });

  it("4 maaps = 1,100 physical bricks (information only)", () => {
    expect(physicalBricksForMaaps(4)).toBe(1100);
  });
});

// Approved 1 Nov 2026: round half up once per saved entry; stored earnings are never recalculated by other entries.
describe("approved rounding policy", () => {
  const rate = rupeesToPaise("88.5"); // 22.125 rupees per maap: the case where rounding shows

  it("an entry's earnings depend only on its own maaps and rate", () => {
    const first = { maaps: 1, ratePaise: rate };
    const stored = earningsPaiseForMaaps(first.maaps, first.ratePaise); // saved once
    // later entries, a rate change, other workers: none of it can reach back into the stored value
    earningsPaiseForMaaps(7, rate);
    earningsPaiseForMaaps(1, rupeesToPaise("90"));
    expect(stored).toBe(2213);
    expect(earningsPaiseForMaaps(first.maaps, first.ratePaise)).toBe(stored);
  });

  it("totals are exact sums of the stored integers", () => {
    const entries = [1, 1, 1].map((maaps) => earningsPaiseForMaaps(maaps, rate));
    expect(sumPaise(entries)).toBe(6639); // ₹66.39
    expect(sumPaise([...entries, earningsPaiseForMaaps(2, rate)])).toBe(6639 + 4425); // earlier entries untouched
  });

  it("separate entries may differ from one combined entry by at most 1 paisa per entry (accepted)", () => {
    const separate = sumPaise([1, 1, 1].map((m) => earningsPaiseForMaaps(m, rate)));
    const combined = earningsPaiseForMaaps(3, rate);
    expect(separate).toBe(6639);
    expect(combined).toBe(6638);
    expect(Math.abs(separate - combined)).toBeLessThanOrEqual(1);
  });

  it("whole-paise-per-maap rates never differ, however the work is split", () => {
    const whole = rupeesToPaise("88");
    const separate = sumPaise([1, 1, 1, 1, 1].map((m) => earningsPaiseForMaaps(m, whole)));
    expect(separate).toBe(earningsPaiseForMaaps(5, whole));
  });
});
