// READ-ONLY: lists the collections and indexes of one database and compares them with the indexes the app declares.
// It NEVER creates, drops, rebuilds or changes anything: the only database commands it sends are ping, listCollections and listIndexes.
// No documents are read. No credentials or connection strings are printed. It is meant for YOU to run on your own computer.
//
//   PowerShell, from the server folder (use a Read-only Atlas user if you can):
//     $secure = Read-Host "Connection string" -AsSecureString
//     $env:INSPECT_MONGODB_URI = [System.Net.NetworkCredential]::new("", $secure).Password
//     node scripts\inspectIndexes.js --label production --confirm-db <the exact database name> | Tee-Object index-report.txt
//     Remove-Item Env:INSPECT_MONGODB_URI
//
// It stops (and sends nothing) unless: the connection string names a database, --confirm-db equals that name, --label is production|test|other,
// and the database name the server reports after connecting equals the confirmed name.
import mongoose from "mongoose";
import { compareIndexes, declaredToIndexes } from "./lib/indexCompare.js";

// Never build anything on connect, whatever the models say.
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

const args = process.argv.slice(2);
const option = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const stop = (message) => {
  console.error(`STOP: ${message}`);
  process.exit(2);
};

const uri = process.env.INSPECT_MONGODB_URI ?? "";
if (!uri) stop("set INSPECT_MONGODB_URI first (see the instructions at the top of this file).");
if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) stop("INSPECT_MONGODB_URI is not a MongoDB connection string.");
const dbName = decodeURIComponent(uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?#]*)/i)?.[1] ?? "");
if (!dbName) stop("the connection string has no database name after the host. Add it (for example .../mydatabase?...). Nothing was sent.");
const label = option("label");
if (!["production", "test", "other"].includes(label)) stop("add --label production (or test, or other) so the report says which database it is.");
if (option("confirm-db") !== dbName) stop(`add --confirm-db ${dbName} to confirm the database you mean. Nothing was sent.`);

const models = (
  await Promise.all(
    ["Attendance", "Bill", "Customer", "InvoiceSettings", "Labour", "LabourRateHistory", "MaapEntry", "Payment", "ProductionEntry", "Season", "Truck", "TruckStatusHistory", "TruckTrip", "User"].map((n) => import(`../models/${n}.js`).then((m) => m.default))
  )
).filter(Boolean);

let connection;
try {
  connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 15000, autoIndex: false, autoCreate: false }).asPromise();
  await connection.db.admin().ping();
  const connectedName = connection.db.databaseName;
  if (connectedName !== dbName) stop(`connected to "${connectedName}", which is not the confirmed "${dbName}". Nothing further was done.`);

  const collections = (await connection.db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith("system.")).sort();
  const expected = models.map((m) => m.collection.name);
  const present = expected.filter((n) => collections.includes(n));
  console.log("=== INDEX REPORT (read-only) ===");
  console.log(`Database:     ${connectedName}`);
  console.log(`Environment:  ${label} (as stated by you with --label; a database cannot prove this by itself)`);
  console.log(`Collections:  ${collections.length} found, ${present.length} of ${expected.length} expected application collections present`);
  if (present.length === 0) console.log("WARNING: none of the application's collections exist here. This may not be the database you meant.");
  console.log("");

  let problems = 0;
  for (const model of models.sort((a, b) => a.collection.name.localeCompare(b.collection.name))) {
    const name = model.collection.name;
    console.log(`--- ${name}`);
    if (!collections.includes(name)) {
      console.log("    (collection does not exist yet)");
      continue;
    }
    const actual = await connection.db.collection(name).listIndexes().toArray();
    const { missing, extra, matching } = compareIndexes(actual, declaredToIndexes(model.schema.indexes()));
    console.log(`    ${actual.length} index(es) in the database: ${actual.map((i) => i.name).join(", ")}`);
    console.log(`    matching the app: ${matching.length}`);
    for (const m of missing) {
      problems += 1;
      console.log(`    MISSING in the database: ${m}`);
    }
    for (const e of extra) console.log(`    extra (not declared by the app): ${e}`);
  }
  console.log("");
  console.log(problems ? `RESULT: ${problems} declared index(es) are MISSING. Nothing was changed.` : "RESULT: every index the app declares exists. Nothing was changed.");
} catch (error) {
  console.error(`Could not inspect: ${error?.name}: ${String(error?.message).replace(/mongodb(\+srv)?:\/\/\S+/gi, "mongodb://***")}`);
  process.exitCode = 3;
} finally {
  await connection?.close().catch(() => {});
}
