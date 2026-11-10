// MOCKED tests: the save function is a fake. No real server or database.
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../services/api";
import { createSaveFlow } from "./pheeraSaveFlow";

const payload = { truckId: "t1", businessDate: "2026-11-01", rows: [{ clientRowId: "row-a", customerId: "c1" }] };
const ids = () => { let n = 0; return () => `sub-id-${String(++n).padStart(6, "0")}`; };
const network = () => new ApiError("Could not reach the server", { code: "NETWORK" });
const refusal = (status, errors = []) => new ApiError("Nothing was saved", { status, errors });

describe("Pheera save flow (mocked)", () => {
  it("12. an uncertain (network) failure keeps the SAME submissionId and the SAME payload for the retry", async () => {
    const save = vi.fn().mockRejectedValueOnce(network()).mockResolvedValueOnce({ records: [{}], duplicate: true });
    const flow = createSaveFlow({ save, newId: ids() });
    const first = flow.getState().submissionId;
    const a = await flow.submit(payload);
    expect(a.status).toBe("unknown");
    expect(a.info.nothingSaved).toBe(false);
    expect(flow.getState().pending).toMatchObject({ submissionId: first, payload });
    // the screen is locked: even if it calls submit with DIFFERENT rows, the original entry is what is re-sent
    const b = await flow.submit({ ...payload, rows: [{ clientRowId: "row-CHANGED" }] });
    expect(b.status).toBe("saved");
    expect(b.result.duplicate).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0][0].submissionId).toBe(first);
    expect(save.mock.calls[1][0]).toEqual({ submissionId: first, ...payload });
    expect(flow.getState().pending).toBeNull();
  });

  it("12b. timeouts, unreadable answers and 5xx are all 'unknown', never 'nothing saved'", async () => {
    for (const err of [new ApiError("Timed out", { code: "TIMEOUT" }), new ApiError("Bad", { code: "BAD_RESPONSE" }), new ApiError("Server error", { status: 503 })]) {
      const flow = createSaveFlow({ save: vi.fn().mockRejectedValue(err), newId: ids() });
      expect((await flow.submit(payload)).status).toBe("unknown");
    }
  });

  it("a new submissionId is made only AFTER a confirmed save", async () => {
    const save = vi.fn().mockResolvedValue({ records: [{}], duplicate: false });
    const flow = createSaveFlow({ save, newId: ids() });
    const first = flow.getState().submissionId;
    await flow.submit(payload);
    const second = flow.getState().submissionId;
    expect(second).not.toBe(first);
    await flow.submit(payload);
    expect(save.mock.calls.map((c) => c[0].submissionId)).toEqual([first, second]);
  });

  it("a definite refusal (400/409) is 'nothing saved': row errors are returned, the entry is not locked and the id is kept", async () => {
    const save = vi.fn().mockRejectedValue(refusal(409, [{ field: "trips.0.customerId", message: 'Customer "Ram" is archived' }, { field: "trips.1.customMaterialName", message: "Too long" }]));
    const flow = createSaveFlow({ save, newId: ids() });
    const id = flow.getState().submissionId;
    const out = await flow.submit(payload);
    expect(out.status).toBe("refused");
    expect(out.info).toMatchObject({ kind: "ARCHIVED_CUSTOMER", nothingSaved: true });
    expect(out.serverErrors.rows).toEqual({ 0: { customerId: 'Customer "Ram" is archived' }, 1: { customMaterialName: "Too long" } });
    expect(flow.getState()).toMatchObject({ pending: null, saving: false, submissionId: id });
  });

  it("a 400 for an unknown customer is a refusal with the row error", async () => {
    const flow = createSaveFlow({ save: vi.fn().mockRejectedValue(refusal(400, [{ field: "trips.2.customerId", message: "Customer not found" }])), newId: ids() });
    const out = await flow.submit(payload);
    expect(out).toMatchObject({ status: "refused", serverErrors: { rows: { 2: { customerId: "Customer not found" } } } });
  });

  it("13. a second submit while one is running is ignored (only ONE request is sent)", async () => {
    let release;
    const save = vi.fn(() => new Promise((r) => { release = r; }));
    const flow = createSaveFlow({ save, newId: ids() });
    const first = flow.submit(payload);
    expect(flow.getState().saving).toBe(true);
    expect(await flow.submit(payload)).toEqual({ status: "busy" });
    expect(save).toHaveBeenCalledTimes(1);
    release({ records: [{}], duplicate: false });
    expect((await first).status).toBe("saved");
    expect(flow.getState().saving).toBe(false);
  });

  it("an error thrown before anything is sent (not an ApiError) is 'invalid', not pending", async () => {
    const flow = createSaveFlow({ save: vi.fn().mockRejectedValue(new Error("Quantity must be a number")), newId: ids() });
    const out = await flow.submit(payload);
    expect(out.status).toBe("invalid");
    expect(flow.getState().pending).toBeNull();
  });

  it("only an explicit discard drops an unknown entry and makes a new id", async () => {
    const flow = createSaveFlow({ save: vi.fn().mockRejectedValue(network()), newId: ids() });
    const first = flow.getState().submissionId;
    await flow.submit(payload);
    expect(flow.getState().pending).not.toBeNull();
    flow.discard();
    expect(flow.getState().pending).toBeNull();
    expect(flow.getState().submissionId).not.toBe(first);
  });

  it("an unknown outcome can happen again on the retry and the SAME id is still kept", async () => {
    const save = vi.fn().mockRejectedValue(network());
    const flow = createSaveFlow({ save, newId: ids() });
    const first = flow.getState().submissionId;
    await flow.submit(payload);
    await flow.submit(payload);
    expect(save.mock.calls.map((c) => c[0].submissionId)).toEqual([first, first]);
    expect(flow.getState().pending.submissionId).toBe(first);
  });
});
