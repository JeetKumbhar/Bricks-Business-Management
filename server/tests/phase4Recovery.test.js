import { describe, expect, it, vi } from "vitest";
import { judgeBillState } from "../scripts/lib/billStateVerdict.js";
import { NetworkError, recoverUncertainWrite } from "../scripts/lib/phase4Http.js";

const lost = () => new NetworkError({ method: "POST", path: "/bills/1/cancel", code: "ECONNRESET", detail: "", attempts: 1, timedOut: false, uncertain: true });
const base = { sleep: async () => {}, probe: async () => ({ reachable: true, status: 200 }) };
const state = (status) => ({ status: 200, data: { status } });
const applied = (r) => (r.data.status === "CANCELLED" ? true : r.data.status === "FINALIZED" ? false : null);

describe("a write whose answer was lost is never blindly repeated", () => {
  it("passes a normal answer straight through", async () => {
    const request = vi.fn().mockResolvedValue(state("CANCELLED"));
    const r = await recoverUncertainWrite({ ...base, request, reread: vi.fn(), applied });
    expect(r).toMatchObject({ recovered: null, lost: null });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("re-reads the state and does NOT resend when the change had been applied", async () => {
    const request = vi.fn().mockRejectedValue(lost());
    const reread = vi.fn().mockResolvedValue(state("CANCELLED"));
    const r = await recoverUncertainWrite({ ...base, request, reread, applied });
    expect(r.recovered).toBe("applied");
    expect(request).toHaveBeenCalledTimes(1);
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it("resends exactly once, and only after a read proved the change was NOT applied", async () => {
    const request = vi.fn().mockRejectedValueOnce(lost()).mockResolvedValueOnce(state("CANCELLED"));
    const r = await recoverUncertainWrite({ ...base, request, reread: vi.fn().mockResolvedValue(state("FINALIZED")), applied });
    expect(r.recovered).toBe("retried");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not resend when the state is unclear, and rethrows the original error", async () => {
    const request = vi.fn().mockRejectedValue(lost());
    await expect(recoverUncertainWrite({ ...base, request, reread: vi.fn().mockResolvedValue(state("SOMETHING")), applied })).rejects.toBeInstanceOf(NetworkError);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("gives up (original error) when the backend does not come back, without re-reading or resending", async () => {
    const request = vi.fn().mockRejectedValue(lost());
    const reread = vi.fn();
    const probe = vi.fn().mockResolvedValue({ reachable: false, code: "ECONNREFUSED" });
    await expect(recoverUncertainWrite({ ...base, probe, request, reread, applied, waitSeconds: 4 })).rejects.toBeInstanceOf(NetworkError);
    expect(reread).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not touch ordinary errors", async () => {
    await expect(recoverUncertainWrite({ ...base, request: vi.fn().mockRejectedValue(new RangeError("x")), reread: vi.fn(), applied })).rejects.toBeInstanceOf(RangeError);
  });
});

describe("judging a stored bill after a lost cancel answer", () => {
  const bill = (extra = {}) => ({ _id: "b1", status: "CANCELLED", cancelledAt: new Date(), cancelledReason: "x", history: [{ action: "CREATE" }, { action: "FINALIZE" }, { action: "CANCEL" }], ...extra });
  const trip = (extra = {}) => ({ pheeraNo: 1, billingStatus: "BILLED", billId: "b1", billingHistory: [{ action: "BILLED", billId: "b1" }, { action: "BILL_CANCELLED", billId: "b1" }], ...extra });

  it("cancelled, history kept, Pheeras still BILLED and noted: consistent", () => {
    const r = judgeBillState({ bill: bill(), trips: [trip()] });
    expect(r.verdict).toMatch(/WAS APPLIED/);
    expect(r.consistent).toBe(true);
  });

  it("still FINALIZED: not applied, consistent", () => {
    const r = judgeBillState({ bill: bill({ status: "FINALIZED", history: [{ action: "FINALIZE" }] }), trips: [trip({ billingHistory: [{ action: "BILLED", billId: "b1" }] })] });
    expect(r.verdict).toMatch(/NOT APPLIED/);
    expect(r.consistent).toBe(true);
  });

  it("cancelled bill but a Pheera without the cancellation note: flagged as a split save", () => {
    const r = judgeBillState({ bill: bill(), trips: [trip({ billingHistory: [{ action: "BILLED", billId: "b1" }] })] });
    expect(r.consistent).toBe(false);
    expect(r.problems.join(" ")).toMatch(/NOT saved together/);
  });

  it("Pheera noted as cancelled while the bill is still FINALIZED: flagged", () => {
    const r = judgeBillState({ bill: bill({ status: "FINALIZED", history: [{ action: "FINALIZE" }] }), trips: [trip()] });
    expect(r.consistent).toBe(false);
  });

  it("a cancelled bill must keep its FINALIZE history", () => {
    const r = judgeBillState({ bill: bill({ history: [{ action: "CANCEL" }] }), trips: [trip()] });
    expect(r.problems.join(" ")).toMatch(/history must be preserved/);
  });
});

describe("read-only guarantees of the TEST tools", async () => {
  const { readFileSync } = await import("node:fs");
  const src = (name) => readFileSync(new URL(`../scripts/${name}`, import.meta.url), "utf8");

  it("inspectPhase4Bill.js has no database write call and turns index/collection creation off", () => {
    const code = src("inspectPhase4Bill.js");
    expect(code).not.toMatch(/\.(updateOne|updateMany|insertMany|insertOne|create|save|deleteOne|deleteMany|findOneAndUpdate|findByIdAndUpdate|bulkWrite|drop|syncIndexes|createIndex|ensureIndexes)\(/);
    expect(code).toMatch(/mongoose\.set\("autoIndex", false\)/);
    expect(code).toMatch(/mongoose\.set\("autoCreate", false\)/);
  });

  it("verifyPhase4.js turns index/collection creation off before any model is used", () => {
    const code = src("verifyPhase4.js");
    expect(code).toMatch(/mongoose\.set\("autoIndex", false\)/);
    expect(code.indexOf('mongoose.set("autoIndex", false)')).toBeLessThan(code.indexOf("mongoose.connect("));
    expect(code).not.toMatch(/^import \w+ from "\.\.\/models\//m); // models are imported dynamically, after the setting
    expect(code.indexOf('mongoose.set("autoIndex", false)')).toBeLessThan(code.indexOf('await import("../models/'));
  });
});
