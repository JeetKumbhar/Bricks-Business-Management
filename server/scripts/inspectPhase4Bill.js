// READ-ONLY look at one Phase 4 bill and its Pheeras in the TEST database. It never writes, creates, updates, deletes, or builds indexes.
//
//   (PowerShell, from the server folder, with the backend running or stopped: it does not need the backend)
//   Remove-Item Env:MONGODB_URI -ErrorAction SilentlyContinue
//   node scripts\inspectPhase4Bill.js --bill 6af58cb8cfb7e868d53d33c5 --confirm-db aayush_carting_test
//   node scripts\inspectPhase4Bill.js --recent --confirm-db aayush_carting_test        (lists the 5 newest bills to find an id)
//
// Same guards as the other TEST tools: refuses NODE_ENV=production, refuses unless the database name from server\.env ends with "_test",
// and needs --confirm-db with that exact name. There is no bypass. Only the database NAME is printed, never the connection string.
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { judgeBillState } from "./lib/billStateVerdict.js";

const args = process.argv.slice(2);
const option = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const stop = (message) => {
  console.error(`STOP: ${message}`);
  process.exit(2);
};

if ((process.env.NODE_ENV ?? "").toLowerCase() === "production" || env.isProduction) stop("NODE_ENV is production.");
const dbName = decodeURIComponent(env.mongodbUri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?#]*)/i)?.[1] ?? "");
if (!dbName) stop("MONGODB_URI (server\\.env) has no database name.");
if (!/_test$/i.test(dbName)) stop(`the database name "${dbName}" does not end with "_test". This tool only reads a TEST database.`);
if (option("confirm-db") !== dbName) stop(`add --confirm-db ${dbName} to confirm the TEST database.`);
const billId = option("bill");
if (!billId && !args.includes("--recent")) stop("give --bill <24-character id> or --recent.");
if (billId && !/^[0-9a-f]{24}$/.test(billId)) stop("--bill must be a 24-character id.");

// Truly read-only: Mongoose must not create collections or build indexes when it connects.
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);
const { default: Bill } = await import("../models/Bill.js");
const { default: TruckTrip } = await import("../models/TruckTrip.js");

try {
  console.log(`Database: ${dbName} (TEST, read-only)\n`);
  await mongoose.connect(env.mongodbUri, { serverSelectionTimeoutMS: 15000 });
  if (mongoose.connection.name !== dbName) stop(`connected to "${mongoose.connection.name}", not "${dbName}".`);

  if (!billId) {
    const rows = await Bill.find({}).sort({ createdAt: -1 }).limit(5).lean();
    for (const b of rows) console.log(`${b._id}  ${b.status.padEnd(9)} ${b.billNumber ?? "(draft)"}  ${b.customer?.name ?? ""}  created ${b.createdAt?.toISOString?.() ?? ""}`);
  } else {
    const bill = await Bill.findById(billId).lean();
    if (!bill) stop("no bill with that id in this database.");
    const trips = await TruckTrip.find({ _id: { $in: (bill.sourceTripIds ?? []).map(String) } }).lean();
    console.log(`Bill ${bill._id}`);
    console.log(`  number ${bill.billNumber ?? "(none)"}   status ${bill.status}   revision ${bill.revision}   total paise ${bill.grandTotalPaise}`);
    console.log(`  finalizedAt ${bill.finalizedAt?.toISOString?.() ?? "-"}   cancelledAt ${bill.cancelledAt?.toISOString?.() ?? "-"}   cancelledReason ${bill.cancelledReason ?? "-"}`);
    console.log(`  history: ${(bill.history ?? []).map((h) => `${h.action}@r${h.revision}`).join(" -> ")}`);
    console.log(`  Pheeras (${trips.length}):`);
    for (const t of trips) console.log(`    #${t.pheeraNo} ${t.billingStatus}  billId ${t.billId ?? "none"}  trail: ${(t.billingHistory ?? []).map((h) => h.action).join(" -> ")}`);
    const { verdict, lines, problems, consistent } = judgeBillState({ bill, trips });
    console.log(`\nVERDICT: ${verdict}`);
    for (const l of lines) console.log(`  note: ${l}`);
    console.log(consistent ? "CONSISTENT: the bill and its Pheeras agree." : `INCONSISTENT:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
} catch (error) {
  console.error(`Could not read: ${error?.name}: ${String(error?.message).replace(/mongodb(\+srv)?:\/\/\S+/gi, "mongodb://***")}`);
  process.exitCode = 3;
} finally {
  await mongoose.disconnect().catch(() => {});
}
