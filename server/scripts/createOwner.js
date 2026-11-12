// Creates the owner account, or resets its password.
//
//   npm run create-owner -- --email owner@example.com --name "Ramesh Patel"
//   npm run create-owner -- --email owner@example.com --reset-password
//
// The password is typed at a hidden prompt (and asked twice). It is never taken from a command-line argument, so it cannot
// end up in shell history or a process list, and it is never printed or logged. For automation only, it may instead be
// supplied in the OWNER_PASSWORD environment variable.
// A reset also signs the account out everywhere.
//
// SAFETY: this script works ONLY on a TEST database. It refuses (before asking for a password or connecting) unless
//   - NODE_ENV is not production,
//   - the database name in MONGODB_URI ends with "_test" (case-insensitive), and
//   - --confirm-db <that exact name> is given.
// There is deliberately no bypass: creating the real owner is a separate, production procedure, not this script.
//   npm run create-owner -- --email testowner@aayush.local --name "Test Owner" --confirm-db brickpro_test
import { connectDB, describeTarget, disconnectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { ROLES } from "../constants/roles.js";
import { checkPasswordPolicy, createUser, resetPassword } from "../services/auth.service.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const die = (message) => {
  console.error(`\n${message}`);
  process.exitCode = 1;
};

/** Reads a line from the terminal without echoing it. */
const readHidden = (prompt) =>
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

const getPassword = async () => {
  if (process.env.OWNER_PASSWORD) return process.env.OWNER_PASSWORD;
  const first = await readHidden("Password: ");
  const second = await readHidden("Repeat password: ");
  if (first !== second) throw new Error("The two passwords do not match");
  return first;
};

/** Refuses (returns an error message) unless the effective MONGODB_URI is a confirmed TEST database. Never prints the URI. */
const testDatabaseProblem = () => {
  if ((process.env.NODE_ENV ?? "").toLowerCase() === "production" || env.isProduction) return "Refusing: NODE_ENV is production. This script only works on a TEST database.";
  const dbName = env.mongodbUri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?#]*)/i)?.[1] ?? "";
  if (!dbName) return "Refusing: MONGODB_URI has no database name. Use a TEST database whose name ends with _test (for example brickpro_test).";
  if (!/_test$/i.test(dbName)) return `Refusing: the database name "${dbName}" does not end with "_test". This script only works on a TEST database.`;
  if (option("confirm-db") !== dbName) return `Refusing: add --confirm-db ${dbName} to confirm that "${dbName}" is the TEST database you mean.`;
  console.log(`Target database: ${dbName} (confirmed TEST)`);
  return null;
};

const main = async () => {
  const unsafe = testDatabaseProblem(); // before the password prompt, the connection, and for BOTH create and --reset-password
  if (unsafe) return die(unsafe);

  const email = (option("email") ?? "").trim().toLowerCase();
  const name = (option("name") ?? "").trim();
  const reset = flag("reset-password");

  if (!email) return die('Missing --email. Example: npm run create-owner -- --email owner@example.com --name "Ramesh Patel"');
  if (!reset && name.length < 2) return die("Missing --name (at least 2 characters).");

  let password;
  try {
    password = await getPassword();
  } catch (err) {
    return die(err.message === "no terminal" ? "No terminal to type the password in. Run this in a terminal, or set OWNER_PASSWORD." : err.message);
  }

  const problems = checkPasswordPolicy(password, { email });
  if (problems.length > 0) return die(`That password is not acceptable:\n - ${problems.join("\n - ")}`);

  console.log(`Connecting to ${describeTarget(env.mongodbUri)} ...`);
  await connectDB();

  if (reset) {
    const found = await resetPassword(email, password);
    return found ? console.log(`Password updated for ${email}. Existing sessions were signed out.`) : die(`No account found for ${email}.`);
  }

  const user = await createUser({ name, email, password, role: ROLES.OWNER });
  console.log(`Created ${user.role} account for ${user.email}. You can now sign in.`);
};

try {
  await main();
} catch (err) {
  if (err.code === "EMAIL_TAKEN") die(`${err.message}. To change its password use --reset-password.`);
  else die(err.name === "DatabaseConnectionError" ? err.message : `Could not finish: ${err.message}`);
} finally {
  await disconnectDB().catch(() => {});
}
