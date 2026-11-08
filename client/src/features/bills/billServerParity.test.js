// Proves the frontend invoice arithmetic gives the SAME paise as the backend (server/services/billCalculations.js) for thousands of
// random bills, in both tax types. The backend is the authority: if this test fails, the frontend is wrong, not the server.
// Run: npx vitest run src/features/bills/billServerParity.test.js
import { describe, expect, it } from "vitest";
import { calculateBill } from "../../../../server/services/billCalculations.js";
import { computeInvoice } from "./billCalculations";

// small deterministic random generator so a failure can be repeated
const rng = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const randomBill = (next) => {
  const count = 1 + Math.floor(next() * 8);
  return Array.from({ length: count }, () => {
    const quantityMilli = 1 + Math.floor(next() * 5_000_000);
    const ratePaise = Math.floor(next() * 500_000);
    const taxRateBp = [0, 100, 250, 500, 1200, 1800, 2800, 333, 1234][Math.floor(next() * 9)];
    return { quantityMilli, ratePaise, taxRateBp };
  });
};

// the typed values the frontend works with (text from the form, numbers from a saved bill both give the same result)
const asFrontend = (items) => items.map((i) => ({ quantity: String(i.quantityMilli / 1000), rate: String(i.ratePaise / 100), taxRate: String(i.taxRateBp / 100) }));

describe("frontend GST arithmetic equals the backend", () => {
  for (const [taxType, taxMode] of [["INTRA", "GST"], ["INTER", "GST"], [null, "NON_GST"]]) {
    it(`2000 random bills: ${taxMode} ${taxType ?? ""}`, () => {
      const next = rng(taxType === "INTRA" ? 11 : taxType === "INTER" ? 22 : 33);
      for (let n = 0; n < 2000; n += 1) {
        const items = randomBill(next);
        const server = calculateBill({ items, taxMode, taxType });
        const client = computeInvoice(asFrontend(items), taxMode, taxType);
        expect(client.taxablePaise).toBe(server.totals.taxableTotalPaise);
        expect(client.cgstPaise).toBe(server.totals.cgstPaise);
        expect(client.sgstPaise).toBe(server.totals.sgstPaise);
        expect(client.igstPaise).toBe(server.totals.igstPaise);
        expect(client.grandPaise).toBe(server.totals.grandTotalPaise);
        client.lines.forEach((line, i) => {
          expect(line.amountPaise).toBe(server.lines[i].taxablePaise);
          expect(line.cgstPaise).toBe(server.lines[i].cgstPaise);
          expect(line.igstPaise).toBe(server.lines[i].igstPaise);
          expect(line.totalPaise).toBe(server.lines[i].totalPaise);
        });
      }
    });
  }
  it("pending tax (state code missing) matches the backend", () => {
    const items = randomBill(rng(5));
    const server = calculateBill({ items, taxMode: "GST", taxType: null });
    const client = computeInvoice(asFrontend(items), "GST", null);
    expect([client.taxPending, client.taxPaise, client.grandPaise]).toEqual([server.taxPending, 0, server.totals.grandTotalPaise]);
  });
});
