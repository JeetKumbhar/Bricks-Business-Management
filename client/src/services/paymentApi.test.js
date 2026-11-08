import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { correctPaymentRequest, createPaymentRequest, getPaymentDetail, getSalary, makeRequestId, voidPaymentRequest } from "./paymentApi";

const ok = (data, status = 200, meta) => new Response(JSON.stringify({ success: true, message: "ok", data, ...(meta ? { meta } : {}) }), { status, headers: { "content-type": "application/json" } });
let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("makeRequestId", () => {
  it("is accepted by the server's pattern and is different every time", () => {
    const a = makeRequestId();
    const b = makeRequestId();
    expect(/^[A-Za-z0-9_-]{8,64}$/.test(a)).toBe(true);
    expect(a === b).toBe(false);
  });
});

describe("payment requests", () => {
  it("create: recipientId (not labourId), amount as a number, requestId, and no fields the server rejects", async () => {
    fetchMock.mockResolvedValue(ok({ id: "p1" }, 201));
    await createPaymentRequest({ labourId: "L-001", type: "SALARY_PAYMENT", amount: "1500", date: "2026-11-07", note: "", reason: "ignored", extra: 1 }, "req-12345678");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/payments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ recipientId: "L-001", type: "SALARY_PAYMENT", amount: 1500, date: "2026-11-07", note: "", requestId: "req-12345678" });
  });

  it("correct: PATCH with the changed fields and the reason; the recipient is never sent", async () => {
    fetchMock.mockResolvedValue(ok({ id: "p1" }));
    await correctPaymentRequest("665f1c2e9b1e8a0012345678", { type: "BOOKING_ADVANCE", amount: "2000", date: "2026-11-06", note: "x", labourId: "L-009" }, "Typed wrong amount");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/payments/665f1c2e9b1e8a0012345678");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ type: "BOOKING_ADVANCE", amount: 2000, date: "2026-11-06", note: "x", reason: "Typed wrong amount" });
  });

  it("void: DELETE with the reason in the body", async () => {
    fetchMock.mockResolvedValue(ok({ id: "p1", isDeleted: true }));
    await voidPaymentRequest("665f1c2e9b1e8a0012345678", "Wrong person");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/payments/665f1c2e9b1e8a0012345678");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body)).toEqual({ reason: "Wrong person" });
  });

  it("detail: GET /payments/:id", async () => {
    fetchMock.mockResolvedValue(ok({ id: "p1", revisions: [] }));
    expect((await getPaymentDetail("665f1c2e9b1e8a0012345678")).revisions).toEqual([]);
  });
});

describe("getSalary", () => {
  it("sends from/to for a range, and leaves 'from' out for season to date", async () => {
    fetchMock.mockImplementation(async () => ok([], 200, { range: { from: "2026-11-01", to: "2026-11-07" }, summary: { byType: [], total: {} } }));
    await getSalary({ from: "2026-11-01", to: "2026-11-07" });
    const u1 = new URL(fetchMock.mock.calls[0][0], "http://x");
    expect(u1.pathname).toBe("/api/salary");
    expect(u1.searchParams.get("from")).toBe("2026-11-01");
    expect(u1.searchParams.get("to")).toBe("2026-11-07");
    await getSalary({ from: "0000-01-01", to: "2026-11-07" });
    const u2 = new URL(fetchMock.mock.calls[1][0], "http://x");
    expect(u2.searchParams.has("from")).toBe(false);
    expect(u2.searchParams.get("to")).toBe("2026-11-07");
  });

  it("returns { range, items, summary } built from the server's data array and meta", async () => {
    const row = { id: "L-001", name: "A", season: { earned: 100, received: 0, balance: 100 } };
    fetchMock.mockImplementation(async () => ok([row], 200, { range: { from: "2026-11-01", to: "2026-11-07" }, summary: { byType: [{ type: "BIGARI" }], total: { earned: 100 } } }));
    const out = await getSalary({ from: "2026-11-01", to: "2026-11-07" });
    expect(out.items).toEqual([row]);
    expect(out.range).toEqual({ from: "2026-11-01", to: "2026-11-07" });
    expect(out.summary.total.earned).toBe(100);
  });

  it("refuses an answer that is not in that form instead of showing wrong figures", async () => {
    fetchMock.mockImplementation(async () => ok({ items: [] }));
    const err = await getSalary({}).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/not in the expected form/);
  });
});
