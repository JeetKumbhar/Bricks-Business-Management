// Creates the FIRST Owner account in the PRODUCTION database, once. Create-only: it cannot reset a password or change an account.
//
//   (PowerShell, in a fresh window; the connection string exists only in that window)
//   $env:MONGODB_URI = Read-Host "Production MONGODB_URI"
//   npm run create-owner-prod -- --email owner@example.com --name "Owner Name" --confirm-db aayush_carting_prod
//
// SAFETY (every check runs BEFORE the password prompt and BEFORE any connection):
//   - the database named in MONGODB_URI must be exactly "aayush_carting_prod", and --confirm-db must repeat that exact name;
//   - MONGODB_URI is taken ONLY from this terminal session's environment (never from a .env file), so a leftover development
//     value can never be used; if it is not set the script stops;
//   - only --email, --name and --confirm-db are accepted: any other option (for example --reset-password) is refused;
//   - after connecting, the users collection's indexes are built and checked (the unique email index must exist) BEFORE anything is
//     counted or created; if that fails, nothing is written;
//   - after that, if ANY account already exists (of any role, active or not) it stops without writing anything.
// The password is typed at a hidden prompt (asked twice). It is never an argument, never read from OWNER_PASSWORD, never printed.
// createOwner.js (TEST databases only) is separate and unchanged.
import { pathToFileURL } from "node:url";

export const PRODUCTION_DB = "aayush_carting_prod";
const ALLOWED_OPTIONS = ["--email", "--name", "--confirm-db"];

/** Reads a line from the terminal without echoing it (same behaviour as createOwner.js). */
export const readHidden = (prompt) =>
  new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error("no terminal"));
    process.stdout.write(prompt);
    let value = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const finish = (fn, arg) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
      fn(arg);
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") return finish(reject, new Error("cancelled")); // Ctrl-C
        if (char === "\r" || char === "\n") return finish(resolve, value);
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    process.stdin.on("data", onData);
  });

const hiddenTwice = async (read) => {
  const first = await read("Password: ");
  const second = await read("Repeat password: ");
  if (first !== second) throw new Error("The two passwords do not match");
  return first;
};

const parseUri = (uri) => {
  const m = String(uri ?? "").match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?#]+)(?:\/([^/?#]*))?/i);
  return m ? { host: m[1], dbName: m[2] ?? "" } : null;
};

/** Returns an error message, or null when the arguments and target are acceptable. Pure: never connects, never prints the URI. */
export const guardProblem = ({ argv, uri }) => {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      if (!ALLOWED_OPTIONS.includes(arg)) return `Refusing: "${arg}" is not allowed. This script only creates the first Owner (options: ${ALLOWED_OPTIONS.join(", ")}).`;
      i += 1; // skip the value
    }
  }
  if (!uri) return "Refusing: MONGODB_URI is not set in this terminal session. Set it for this window only, then run again (it is never read from a .env file).";
  const target = parseUri(uri);
  if (!target) return "Refusing: MONGODB_URI is not a readable MongoDB connection string.";
  if (target.dbName !== PRODUCTION_DB) return `Refusing: the database in MONGODB_URI is "${target.dbName || "(none)"}", not "${PRODUCTION_DB}". Nothing was done.`;
  const option = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  if (option("--confirm-db") !== PRODUCTION_DB) return `Refusing: add --confirm-db ${PRODUCTION_DB} to confirm the target.`;
  return null;
};

/** True when the list of index descriptions (from listIndexes) contains a unique index on email alone. Pure. */
export const hasUniqueEmailIndex = (indexes) =>
  Array.isArray(indexes) && indexes.some((ix) => ix?.unique === true && ix.key && Object.keys(ix.key).length === 1 && ix.key.email === 1);

/**
 * The whole procedure, with its collaborators passed in so it can be tested without any database.
 * deps: { argv, uri, readPassword(), loadServices() -> { connect, disconnect, initIndexes, countUsers, createUser, checkPasswordPolicy }, log, error }
 * Returns the exit code (0 created, 1 refused or failed).
 */
export async function runCreateProductionOwner({ argv, uri, readPassword, loadServices, log = console.log, error = console.error }) {
  const refuse = (message) => {
    error(`\n${message}`);
    return 1;
  };

  const problem = guardProblem({ argv, uri });
  if (problem) return refuse(problem);
  const option = (name) => argv[argv.indexOf(name) + 1];
  const email = String(option("--email") ?? "").trim().toLowerCase();
  const name = String(option("--name") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return refuse('Missing or invalid --email. Example: --email owner@example.com --name "Owner Name"');
  if (name.length < 2) return refuse("Missing --name (at least 2 characters).");

  const target = parseUri(uri);
  log(`Target database: ${target.dbName} on ${target.host} (confirmed production)`);

  let password;
  try {
    password = await readPassword();
  } catch (err) {
    return refuse(err.message === "no terminal" ? "No terminal to type the password in. Run this in an interactive terminal." : err.message);
  }

  let services;
  try {
    services = await loadServices();
    const policy = services.checkPasswordPolicy(password, { email });
    if (policy.length > 0) return refuse(`That password is not acceptable:\n - ${policy.join("\n - ")}`);

    log("Connecting ...");
    await services.connect();

    // Build and verify the users indexes first: without the unique email index, nothing may be created.
    log("Preparing the users collection and its unique email index ...");
    let indexes;
    try {
      indexes = await services.initIndexes();
    } catch (err) {
      return refuse(`Refusing: the users indexes could not be initialised (${err?.message ?? err}). Nothing was created.`);
    }
    if (!hasUniqueEmailIndex(indexes)) return refuse("Refusing: the unique email index on the users collection does not exist after initialisation. Nothing was created.");

    const existing = await services.countUsers();
    if (existing > 0) return refuse(`Refusing: ${existing} account(s) already exist in ${PRODUCTION_DB}. Nothing was changed. This script only creates the first Owner.`);

    const user = await services.createUser({ name, email, password });
    log(`Created ${user.role} account for ${user.email}. You can now sign in.`);
    return 0;
  } catch (err) {
    if (err?.code === "EMAIL_TAKEN") return refuse(`${err.message}. Nothing was changed.`);
    return refuse(err?.name === "DatabaseConnectionError" ? err.message : `Could not finish: ${err?.message ?? err}`);
  } finally {
    await services?.disconnect?.().catch(() => {});
  }
}

/** Loads the real services only after every guard has passed (their config would otherwise load first). */
const loadRealServices = async () => {
  // Tokens are never issued here, but the shared config insists on a secret: use a throw-away one for this process only.
  const { randomBytes } = await import("node:crypto");
  process.env.JWT_SECRET ||= randomBytes(48).toString("base64url");
  const [{ connectDB, disconnectDB }, { createUser, checkPasswordPolicy }, { default: User }, { ROLES }] = await Promise.all([
    import("../config/db.js"),
    import("../services/auth.service.js"),
    import("../models/User.js"),
    import("../constants/roles.js"),
  ]);
  return {
    connect: () => connectDB(),
    disconnect: () => disconnectDB(),
    // Awaits the model's own index build (it rejects if the build fails), then lists the indexes (read-only) so the caller can verify them.
    initIndexes: async () => {
      await User.init();
      return User.collection.indexes();
    },
    countUsers: () => User.countDocuments({}),
    createUser: ({ name, email, password }) => createUser({ name, email, password, role: ROLES.OWNER }),
    checkPasswordPolicy,
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCreateProductionOwner({
    argv: process.argv.slice(2),
    uri: process.env.MONGODB_URI, // read before any config module can load a .env file
    readPassword: () => hiddenTwice(readHidden),
    loadServices: loadRealServices,
  });
}
