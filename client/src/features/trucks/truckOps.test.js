// Tests for the truck master changes (nickname, duplicate registration check). The zod form schema needs the installed packages, so it is not covered here..
import { describe, expect, it } from "vitest";
import { createTruck, normalizeTruckNumber, truckNumberKey } from "./truckOps";

describe("truck registration", () => {
  it("normalises case and spaces", () => expect(normalizeTruckNumber("  mh04 ab 1234 ")).toBe("MH04 AB 1234"));
  it("treats spacing and hyphens as the same truck", () => {
    expect(truckNumberKey("MH-04 AB 1234")).toBe(truckNumberKey("mh04ab1234"));
    expect(truckNumberKey("TRK-01")).not.toBe(truckNumberKey("TRK-02"));
  });
});

describe("createTruck", () => {
  it("keeps an optional trimmed nickname and starts as Working", () => {
    const { truck } = createTruck({ truckNumber: "mh04ab1234", nickname: "  Red Tata " }, { changedBy: "Test" });
    expect(truck.nickname).toBe("Red Tata");
    expect(truck.truckNumber).toBe("MH04AB1234");
    expect(truck.status).toBe("WORKING");
    expect(createTruck({ truckNumber: "TRK-11" }, { changedBy: "Test" }).truck.nickname).toBe("");
  });
});
