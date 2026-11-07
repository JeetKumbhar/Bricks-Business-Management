import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAllPages, loadAllData, mapLimit, saveAttendanceDay, saveMaapDayRequest, toCreateLabourBody, toUpdateLabourBody, removeMaapEntry, postRateChange, createSeasonRequest } from "./labourApi";

const ok = (data, meta) => new Response(JSON.stringify({ success: true, message: "ok", data, ...(meta ? { meta } : {}) }), { status: 200, headers: { "content-type": "application/json" } });
let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const urlOf = (call) => new URL(call[0], "http://x");

describe("mapLimit", () => {
  it("keeps result order and never runs more than `limit` at once", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe("fetchAllPages", () => {
  it("reads every page and returns each record once", async () => {
    const rows = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ id: `r${from + i}` }));
    fetchMock.mockImplementation(async (url) => {
      const page = Number(new URL(url, "http://x").searchParams.get("page"));
      return ok(page === 1 ? rows(1, 500) : page === 2 ? rows(501, 1000) : rows(1001, 1100), { page, limit: 500, total: 1100 });
    });
    const all = await fetchAllPages("/attendance", { from: "2000-01-01" });
    expect(all.length).toBe(1100);
    expect(new Set(all.map((r) => r.id)).size).toBe(1100);
    expect(fetchMock.mock.calls.length).toBe(3);
    const u = urlOf(fetchMock.mock.calls[0]);
    expect(u.pathname).toBe("/api/attendance");
    expect(u.searchParams.get("from")).toBe("2000-01-01");
    expect(u.searchParams.get("limit")).toBe("500");
  });

  it("fails instead of returning a list that does not add up to the server's total", async () => {
    fetchMock.mockImplementation(async () => ok([{ id: "a" }], { page: 1, limit: 500, total: 3 }));
    const err = await fetchAllPages("/labours", {}, { attempts: 2 }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/changed while it was loading/);
  });

  it("an empty list is fine", async () => {
    fetchMock.mockResolvedValue(ok([], { page: 1, limit: 500, total: 0 }));
    expect(await fetchAllPages("/labours")).toEqual([]);
  });
});

describe("loadAllData", () => {
  it("reads every collection, the seasons, and the rate history of Bigari workers only", async () => {
    const labours = [
      { id: "L-001", labourType: "BIGARI" },
      { id: "L-002", labourType: "MAAPVALI" },
      { id: "L-003", labourType: "BIGARI" },
    ];
    fetchMock.mockImplementation(async (url) => {
      const u = new URL(url, "http://x");
      const p = u.pathname;
      if (p === "/api/labours") return ok(labours, { page: 1, limit: 500, total: 3 });
      if (p === "/api/seasons") return ok([{ id: "s1" }]);
      if (/^\/api\/labours\/(L-\d+)\/rates$/.test(p)) return ok([{ id: `rate-${p.split("/")[3]}`, labourId: p.split("/")[3], rate: 600, effectiveFrom: "2026-01-01" }]);
      return ok([], { page: 1, limit: 500, total: 0 });
    });
    const data = await loadAllData();
    expect(data.labours.length).toBe(3);
    expect(data.seasons).toEqual([{ id: "s1" }]);
    expect(data.rateChanges.map((r) => r.labourId).sort()).toEqual(["L-001", "L-003"]);
    const paths = fetchMock.mock.calls.map((c) => urlOf(c).pathname);
    expect(paths).toContain("/api/maap-entries");
    expect(paths).toContain("/api/production-entries");
    expect(paths).toContain("/api/payments");
    expect(paths).not.toContain("/api/labours/L-002/rates");
    const pay = fetchMock.mock.calls.map(urlOf).find((u) => u.pathname === "/api/payments");
    expect(pay.searchParams.get("includeDeleted")).toBe("true");
  });

  it("fails as a whole when any part fails (never half the records)", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (new URL(url, "http://x").pathname === "/api/maap-entries") return new Response(JSON.stringify({ success: false, message: "Something went wrong on the server" }), { status: 500, headers: { "content-type": "application/json" } });
      return ok([], { page: 1, limit: 500, total: 0 });
    });
    const err = await loadAllData().catch((e) => e);
    expect(err.status).toBe(500);
  });
});

describe("request bodies", () => {
  it("create: sends only the rate field of the chosen type, as a number", () => {
    const base = { name: "A B", mobile: "9876543210", village: "V", joiningDate: "2026-11-01", status: "ACTIVE" };
    expect(toCreateLabourBody({ ...base, labourType: "BIGARI", dailyRate: "650", ratePerFourMaaps: 1 })).toEqual({ ...base, labourType: "BIGARI", dailyRate: 650 });
    expect(toCreateLabourBody({ ...base, labourType: "MAAPVALI", ratePerFourMaaps: 400 })).toEqual({ ...base, labourType: "MAAPVALI", ratePerFourMaaps: 400 });
    expect(toCreateLabourBody({ ...base, labourType: "PATLAVALE", ratePer1000PayableBricks: 700 })).toEqual({ ...base, labourType: "PATLAVALE", ratePer1000PayableBricks: 700 });
    expect(() => toCreateLabourBody({ ...base, labourType: "X" })).toThrow();
  });

  it("update: only editable fields that really changed", () => {
    const current = { id: "L-001", name: "A", mobile: "9876543210", village: "V", joiningDate: "2026-01-01", status: "ACTIVE", dailyRate: 600, labourType: "BIGARI" };
    expect(toUpdateLabourBody(current, { name: "A", status: "INACTIVE", dailyRate: 999, labourType: "MAAPVALI", id: "L-9" })).toEqual({ status: "INACTIVE" });
    expect(toUpdateLabourBody(current, { name: "A", mobile: "9876543210" })).toEqual({});
  });
});

describe("requests", () => {
  it("save attendance: PUT /attendance/:date with entries, reason only when given", async () => {
    fetchMock.mockResolvedValue(ok({ date: "2026-11-07", items: [], summary: {}, saved: { created: 1, updated: 0, unchanged: 0 } }));
    await saveAttendanceDay("2026-11-07", [{ labourId: "L-001", status: "PRESENT" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/attendance/2026-11-07");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ entries: [{ labourId: "L-001", status: "PRESENT" }] });
  });

  it("save maap day: PUT /maap-entries/day/:date with rows and the reason", async () => {
    fetchMock.mockResolvedValue(ok({ date: "2026-11-01", items: [], saved: {} }));
    await saveMaapDayRequest("2026-11-01", [{ labourId: "L-002", maaps: 7, note: "" }], "Late entry");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/maap-entries/day/2026-11-01");
    expect(JSON.parse(init.body)).toEqual({ rows: [{ labourId: "L-002", maaps: 7, note: "" }], reason: "Late entry" });
  });

  it("delete: DELETE with the reason in the body", async () => {
    fetchMock.mockResolvedValue(ok({ id: "x", isDeleted: true }));
    await removeMaapEntry("665f1c2e9b1e8a0012345678", "Typed twice");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/maap-entries/665f1c2e9b1e8a0012345678");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body)).toEqual({ reason: "Typed twice" });
  });

  it("rate change: POST /labours/:id/rates with the server's field names", async () => {
    fetchMock.mockResolvedValue(ok({ rate: {}, labour: {} }));
    await postRateChange("L-001", { rate: "700", effectiveFrom: "2026-12-01", reason: "Yearly increase" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ newRate: 700, effectiveFrom: "2026-12-01", reason: "Yearly increase" });
  });

  it("create season: endDate is left out when empty", async () => {
    fetchMock.mockResolvedValue(ok({ id: "s" }));
    await createSeasonRequest({ name: "Season 2026-27", startDate: "2026-10-01", endDate: "" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "Season 2026-27", startDate: "2026-10-01" });
  });
});
