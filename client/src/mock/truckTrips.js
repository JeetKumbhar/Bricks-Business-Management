// Demo Pheera (truck trip) data, generated relative to today so the screens always look "live".
// Deterministic: the same numbers every load. Replaced by API data later (see services/truckTripService.js).
//
// Pheera: see features/trucks/pheeraOps.js for the record shape.
import { addDaysISO } from "../utils/formatDate";
import { todayBusinessDate, weekdayOf } from "../utils/businessDate";
import { initialTrucks } from "./trucks";

const DESTINATIONS = ["Palghar", "Manor", "Vasai", "Boisar", "Virar", "Wada", "Dahanu", "Kasa"];

// per truck number: [kind, first day with trips counted as "days ago" cut-off]. Trucks that are stopped / in maintenance
// have no trips after they stopped; TRK-10 has no driver but still ran earlier.
const PLAN = {
  "TRK-01": { kind: "bricks", lastDaysAgo: 0 },
  "TRK-02": { kind: "mixed", lastDaysAgo: 2 }, // stopped 1 day ago
  "TRK-03": { kind: "bricks", lastDaysAgo: 0 },
  "TRK-04": { kind: "mixed", lastDaysAgo: 3 }, // in maintenance since 2 days ago
  "TRK-05": { kind: "soil", lastDaysAgo: 0 },
  "TRK-06": { kind: "bricks", lastDaysAgo: 0 },
  "TRK-07": { kind: "mixed", lastDaysAgo: 1 }, // stopped today
  "TRK-08": { kind: "mixed", lastDaysAgo: 0 },
  "TRK-09": { kind: "bricks", lastDaysAgo: 0 },
  "TRK-10": { kind: "soil", lastDaysAgo: 2 },
};

const BRICK_LOADS = [1000, 1200, 1500, 2000, 2500, 3000];
// tonnes per load. Soil is a standard material; "Stone Dust" and "Fly Ash" stand for names typed under "Other".
const TONNE_LOADS = { Soil: [3, 4, 4.5, 5, 6, 7.5], "Stone Dust": [3, 4, 5, 6], "Fly Ash": [2, 3, 4] };

const lcg = (seed) => {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
};
const pick = (rand, list) => list[Math.floor(rand() * list.length)];

const MATERIAL_BY_KIND = {
  bricks: ["Bricks"],
  soil: ["Soil", "Soil", "Soil", "Stone Dust"],
  mixed: ["Bricks", "Soil", "Soil", "Stone Dust", "Fly Ash"],
};

function generate() {
  const today = todayBusinessDate();
  const records = [];
  initialTrucks.forEach((truck, ti) => {
    const plan = PLAN[truck.truckNumber];
    if (!plan) return;
    for (let daysAgo = 20; daysAgo >= plan.lastDaysAgo; daysAgo -= 1) {
      const date = addDaysISO(today, -daysAgo);
      const rand = lcg(ti * 1000 + daysAgo * 7 + 13);
      if (weekdayOf(date) === 0 && rand() < 0.7) continue; // mostly rest on Sundays
      if (daysAgo === 0 && rand() < 0.15) continue; // not every truck has run yet today
      const trips = daysAgo === 0 ? 1 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * 4);
      for (let n = 1; n <= trips; n += 1) {
        const material = pick(rand, MATERIAL_BY_KIND[plan.kind]);
        let quantity;
        if (material === "Bricks") quantity = pick(rand, BRICK_LOADS.slice(0, truck.capacity >= 6 ? 6 : 4));
        else {
          const fits = TONNE_LOADS[material].filter((t) => t <= (truck.capacity ?? 8) + 1);
          quantity = pick(rand, fits.length > 0 ? fits : [TONNE_LOADS[material][0]]); // small trucks: smallest load
        }
        records.push({
          id: `pheera-seed-${truck.truckNumber}-${date}-${n}`,
          businessDate: date,
          truckId: truck.id,
          truckRegistration: truck.truckNumber,
          pheeraNumber: n,
          material,
          destination: pick(rand, DESTINATIONS),
          quantity,
          unit: material === "Bricks" ? "bricks" : "tonnes",
          remarks: rand() < 0.12 ? "Delivered to site, signed by supervisor" : "",
          batchId: `seed-${truck.truckNumber}-${date}`,
          createdAt: `${date}T${String(14 + (n % 4)).padStart(2, "0")}:00:00.000Z`,
          isDeleted: false,
        });
      }
    }
  });
  return records;
}

export const initialPheeras = generate();
