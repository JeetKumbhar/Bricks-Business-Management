import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Truck from "../models/Truck.js";
import TruckStatusHistory from "../models/TruckStatusHistory.js";
import TruckTrip from "../models/TruckTrip.js";
import { toTruckDto, toHistoryDto } from "../services/truck.service.js";
import { toTripDto } from "../services/truckTrip.service.js";

// Found by the real Phase 4 run: the shared schema's toObject() drops _id (it adds "id" instead), so a DTO built from a freshly
// created document's plain toObject() got the id "undefined". Create paths must use toObject({ transform: false }).
const HEX24 = /^[0-9a-f]{24}$/;

describe("ids of freshly created documents", () => {
  it("shows the hazard: a plain toObject() has no _id", () => {
    expect(new Truck({ truckNumber: "X" }).toObject()._id).toBeUndefined();
  });

  it("truck DTO gets a real 24-character id from toObject({ transform: false })", () => {
    const doc = new Truck({ truckNumber: "MH04AB1234" });
    expect(toTruckDto(doc.toObject({ transform: false })).id).toMatch(HEX24);
    expect(toTruckDto(doc.toObject()).id).toBe(doc.id); // the DTO also copes with a transformed object
  });

  it("truck history DTO gets a real id and truck id", () => {
    const doc = new TruckStatusHistory({ truckId: new Truck({}).id, kind: "CREATED" });
    const dto = toHistoryDto(doc.toObject({ transform: false }));
    expect(dto.id).toMatch(HEX24);
    expect(dto.truckId).toMatch(HEX24);
  });

  it("Pheera DTO gets a real id from toObject({ transform: false })", () => {
    const doc = new TruckTrip({ truckId: new Truck({}).id });
    expect(toTripDto(doc.toObject({ transform: false })).id).toMatch(HEX24);
  });

  it.each(["truck", "customer", "bill", "truckTrip"])("%s service never builds a DTO from a plain toObject()", (name) => {
    const source = readFileSync(new URL(`../services/${name}.service.js`, import.meta.url), "utf8");
    expect(source).not.toMatch(/\.toObject\(\)/);
  });
});
