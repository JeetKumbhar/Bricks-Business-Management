// Creates the owner account, or resets its password.
//
//   npm run create-owner -- --email owner@example.com --name "Ramesh Patel"
//   npm run create-owner -- --email owner@example.com --reset-password
//
// The password is typed at a hidden prompt (and asked twice). It is never taken from a command-line argument, so it cannot
// end up in shell history or a process list, and it is never printed or logged. For automation only, it may instead be
// supplied in the OWNER_PASSWORD environment variable.
// A reset also signs the account out everywhere.
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

const main = async () => {
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
