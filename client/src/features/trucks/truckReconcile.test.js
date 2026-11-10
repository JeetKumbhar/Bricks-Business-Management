// MOCKED tests: the save action and the list reload are fakes. No real server or database.
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../services/api";
import { performTruckOperation, reconcile, recheck } from "./truckReconcile";
import { createTruckStore } from "./truckStore";

const truck = (o = {}) => ({ id: "t1", truckNumber: "MH12AB1234", nickname: "", model: "Tata", capacity: 4, driverId: null, status: "WORKING", statusSince: "2026-11-01T08:00:00Z", stopReason: null, statusNote: "", ...o });
const network = () => new ApiError("Could not reach the server", { code: "NETWORK" });
const timeout = () => new ApiError("Timed out", { code: "TIMEOUT" });
const serverDown = () => new ApiError("Server error", { status: 503 });
const reloadWith = (trucks) => vi.fn().mockResolvedValue({ ok: true, trucks });
const reloadFails = () => vi.fn().mockResolvedValue({ ok: false, trucks: [] });
const run = (op, action, reload) => performTruckOperation({ op, action, reload });

describe("uncertain CREATE (mocked)", () => {
  const op = { kind: "create", before: { ids: ["t1"] }, intended: { truckNumber: "MH12CD5678", model: "Eicher" } };
  it("saved on the server: confirmed (the new truck is returned for the confirmation message)", async () => {
    const out = await run(op, vi.fn().mockRejectedValue(network()), reloadWith([truck(), truck({ id: "t9", truckNumber: "MH12CD5678" })]));
    expect(out).toMatchObject({ status: "confirmed", truck: { id: "t9" } });
  });
  it("matches the number ignoring case, spaces and hyphens", () => {
    expect(reconcile(op, [truck(), truck({ id: "t9", truckNumber: "mh-12 cd 5678" })]).status).toBe("confirmed");
  });
  it("not on the server: not_applied, so saving again is safe", async () => {
    expect((await run(op, vi.fn().mockRejectedValue(timeout()), reloadWith([truck()]))).status).toBe("not_applied");
  });
  it("the list cannot be read: unconfirmed (saving again stays blocked)", async () => {
    const out = await run(op, vi.fn().mockRejectedValue(serverDown()), reloadFails());
    expect(out).toMatchObject({ status: "unconfirmed" });
    expect(out.why).toMatch(/could not be read/);
  });
  it("a number that already existed before the save cannot be called confirmed", () => {
    expect(reconcile({ ...op, before: { ids: ["t1", "t9"] } }, [truck(), truck({ id: "t9", truckNumber: "MH12CD5678" })]).status).toBe("unconfirmed");
  });
});

describe("uncertain UPDATE (mocked)", () => {
  const before = truck();
  const op = { kind: "update", before, intended: { truckNumber: "MH12AB1234", nickname: "", model: "Eicher", capacity: "6", driverId: "" } };
  it("the server shows the new values: confirmed (unchanged form fields do not matter; '6' equals 6)", async () => {
    const out = await run(op, vi.fn().mockRejectedValue(network()), reloadWith([truck({ model: "Eicher", capacity: 6 })]));
    expect(out).toMatchObject({ status: "confirmed", truck: { model: "Eicher" } });
  });
  it("the server still shows the old values: not_applied", async () => {
    expect((await run(op, vi.fn().mockRejectedValue(network()), reloadWith([truck()]))).status).toBe("not_applied");
  });
  it("a mix of old and new, or a truck that disappeared: unconfirmed", () => {
    expect(reconcile(op, [truck({ model: "Eicher", capacity: 9 })]).status).toBe("unconfirmed");
    expect(reconcile(op, [truck({ model: "Other", capacity: 4 })]).status).toBe("unconfirmed");
    expect(reconcile(op, []).status).toBe("unconfirmed");
  });
  it("a driver change is compared too (null and empty are the same)", () => {
    const o = { kind: "update", before: truck({ driverId: "d1" }), intended: { driverId: "" } };
    expect(reconcile(o, [truck({ driverId: null })]).status).toBe("confirmed");
    expect(reconcile(o, [truck({ driverId: "d1" })]).status).toBe("not_applied");
  });
});

describe("uncertain STATUS CHANGE (mocked)", () => {
  const before = truck();
  const op = { kind: "status", before, intended: { status: "STOPPED", reason: "BREAKDOWN" } };
  const stopped = (o = {}) => truck({ status: "STOPPED", stopReason: "BREAKDOWN", statusSince: "2026-11-05T09:00:00Z", ...o });
  it("the server shows the requested status (and reason): confirmed - the retry is NOT offered, so no duplicate history entry", async () => {
    const action = vi.fn().mockRejectedValue(serverDown());
    const out = await run(op, action, reloadWith([stopped()]));
    expect(out.status).toBe("confirmed");
    expect(action).toHaveBeenCalledTimes(1);
  });
  it("the server shows the truck unchanged (same status, same statusSince): not_applied", async () => {
    expect((await run(op, vi.fn().mockRejectedValue(network()), reloadWith([truck()]))).status).toBe("not_applied");
  });
  it("the same status with a different reason is not called confirmed", () => {
    expect(reconcile(op, [stopped({ stopReason: "TYRE_PUNCTURE" })]).status).toBe("unconfirmed");
  });
  it("a third status (someone else changed it) is unconfirmed, not confirmed and not safe to retry", () => {
    expect(reconcile(op, [truck({ status: "MAINTENANCE", statusSince: "2026-11-05T09:00:00Z" })]).status).toBe("unconfirmed");
  });
  it("working again or maintenance need no reason to be confirmed", () => {
    const stoppedBefore = truck({ status: "STOPPED", stopReason: "BREAKDOWN" });
    expect(reconcile({ kind: "status", before: stoppedBefore, intended: { status: "WORKING", reason: "" } }, [truck({ statusSince: "2026-11-06T09:00:00Z" })]).status).toBe("confirmed");
    expect(reconcile({ kind: "status", before, intended: { status: "MAINTENANCE" } }, [truck({ status: "MAINTENANCE", statusSince: "2026-11-06T09:00:00Z" })]).status).toBe("confirmed");
  });
  it("the list cannot be read: unconfirmed", async () => {
    expect((await run(op, vi.fn().mockRejectedValue(timeout()), reloadFails())).status).toBe("unconfirmed");
  });
});

describe("what is NOT reconciled (mocked)", () => {
  const op = { kind: "create", before: { ids: [] }, intended: { truckNumber: "MH12CD5678" } };
  it("a definite refusal (400 / 409) is 'refused': the list is NOT re-read and the server's error is passed on", async () => {
    for (const err of [new ApiError("Invalid", { status: 400, errors: [{ field: "truckNumber", message: "Bad" }] }), new ApiError("Already exists", { status: 409 }), new ApiError("Owner only", { status: 403 })]) {
      const reload = reloadWith([]);
      const out = await run(op, vi.fn().mockRejectedValue(err), reload);
      expect(out).toMatchObject({ status: "refused", error: err });
      expect(reload).not.toHaveBeenCalled();
    }
  });
  it("an error thrown before anything was sent is 'refused' too", async () => {
    const out = await run(op, vi.fn().mockRejectedValue(new Error("Nothing was changed")), reloadWith([]));
    expect(out.status).toBe("refused");
  });
  it("a success is 'done' and the list is not re-read", async () => {
    const reload = reloadWith([]);
    expect(await run(op, vi.fn().mockResolvedValue({ id: "x" }), reload)).toEqual({ status: "done", value: { id: "x" } });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("Check again (mocked)", () => {
  const op = { kind: "status", before: truck(), intended: { status: "STOPPED", reason: "BREAKDOWN" } };
  it("settles the SAME operation later without saving anything: unconfirmed, then confirmed once the server shows it", async () => {
    const reload = vi.fn().mockResolvedValueOnce({ ok: false, trucks: [] }).mockResolvedValueOnce({ ok: true, trucks: [truck({ status: "STOPPED", stopReason: "BREAKDOWN", statusSince: "2026-11-05T09:00:00Z" })] });
    expect((await recheck({ op, reload })).status).toBe("unconfirmed");
    expect((await recheck({ op, reload })).status).toBe("confirmed");
  });
});

describe("the truck store's reload (mocked API)", () => {
  it("resolves { ok, trucks } and does not blank a list that is already shown", async () => {
    const listTrucks = vi.fn().mockResolvedValueOnce({ items: [truck()], counts: null }).mockResolvedValueOnce({ items: [truck(), truck({ id: "t2", truckNumber: "X 2" })], counts: null });
    const store = createTruckStore({ listTrucks });
    expect(await store.load()).toMatchObject({ ok: true });
    const seen = [];
    store.subscribe(() => seen.push(store.getState().status));
    const again = await store.load();
    expect(again.trucks).toHaveLength(2);
    expect(seen).not.toContain("loading");
  });
  it("a failed re-read resolves { ok: false } (never throws) and keeps the shown list", async () => {
    const listTrucks = vi.fn().mockResolvedValueOnce({ items: [truck()], counts: null }).mockRejectedValueOnce(network());
    const store = createTruckStore({ listTrucks });
    await store.load();
    expect(await store.load()).toMatchObject({ ok: false });
    expect(store.getState().trucks).toHaveLength(1);
  });
});
