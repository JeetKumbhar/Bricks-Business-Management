// Network and reporting helpers for verifyPhase4.js. No database access, no environment access: everything is passed in, so it can be
// unit-tested with a fake fetch (tests/phase4Http.test.js).
//
// Retry rule: ONLY a GET that failed at the network level (no HTTP answer at all) is retried, a few times with a short pause. A POST,
// PATCH, PUT or DELETE is NEVER retried automatically: after a network failure its outcome is UNKNOWN (the server may have applied it),
// so it surfaces as an "uncertain" NetworkError and the run stops as INCONCLUSIVE. An HTTP error answer (4xx/5xx) is never retried:
// it is a real result of the application.

const TRANSIENT_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENETUNREACH", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CLOSED"]);

/** Removes anything secret-looking from text that will be printed. */
export const sanitize = (text, secrets = []) => {
  let out = String(text ?? "");
  for (const secret of secrets.filter((s) => typeof s === "string" && s.length >= 4)) out = out.split(secret).join("***");
  return out
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"']+/gi, "mongodb://***")
    .replace(/(brickpro_token=)[^;\s]+/gi, "$1***")
    .replace(/(authorization:\s*)\S+/gi, "$1***")
    .replace(/("?password"?\s*[:=]\s*)"?[^",\s}]+"?/gi, "$1***");
};

/** The useful part of a fetch failure. Node's fetch hides the real reason in error.cause ("fetch failed" alone says nothing). */
export const describeNetworkError = (error) => {
  const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError" || error?.cause?.name === "TimeoutError";
  const code = timedOut ? "TIMEOUT" : error?.cause?.code ?? error?.code ?? error?.cause?.name ?? error?.name ?? "UNKNOWN";
  const detail = error?.cause?.message && error.cause.message !== error?.message ? `${error?.message}: ${error.cause.message}` : error?.message ?? "";
  return { code: String(code), timedOut, detail };
};

/** Genuine transient failure = no HTTP answer was received at all. */
export const isTransientNetworkError = (error) => {
  const { code, timedOut } = describeNetworkError(error);
  return timedOut || TRANSIENT_CODES.has(code) || (error instanceof TypeError && /fetch failed/i.test(error.message));
};

export class NetworkError extends Error {
  constructor({ method, path, code, detail, attempts, timedOut, uncertain }) {
    const what = timedOut ? "timed out" : `failed (${code})`;
    super(`${method} ${path} ${what} after ${attempts} attempt${attempts === 1 ? "" : "s"}${detail ? `: ${detail}` : ""}`);
    this.name = "NetworkError";
    Object.assign(this, { method, path, code, attempts, timedOut, uncertain });
  }
}

export const createHttp = ({
  baseUrl,
  origin,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 20_000,
  maxAttempts = 3,
  retryDelayMs = 500,
  secrets = [],
  onRetry = () => {},
}) => {
  let cookie = "";
  const trace = []; // { method, path, status | error } of every request made, most recent last

  const call = async (method, path, body, { noCookie = false, attempts, raw = false } = {}) => {
    const safeToRetry = method === "GET";
    const limit = safeToRetry ? attempts ?? maxAttempts : 1;
    for (let attempt = 1; ; attempt += 1) {
      try {
        const res = await fetchImpl(`${baseUrl}${path}`, {
          method,
          headers: { Accept: "application/json", Origin: origin, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie && !noCookie ? { Cookie: cookie } : {}) },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
        const token = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("brickpro_token="));
        if (token) cookie = token;
        if (raw) {
          // A file (for example a PDF): report its type and size, never its content.
          const bytes = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
          trace.push({ method, path, status: res.status });
          return { status: res.status, contentType: res.headers.get?.("content-type") ?? "", byteLength: bytes.byteLength };
        }
        let json = null;
        try {
          json = await res.json();
        } catch {
          /* not JSON */
        }
        trace.push({ method, path, status: res.status });
        return { status: res.status, json, data: json?.data, meta: json?.meta, message: json?.message, errors: json?.errors ?? [] };
      } catch (error) {
        const info = describeNetworkError(error);
        const detail = sanitize(info.detail, [...secrets, cookie]);
        if (safeToRetry && attempt < limit && isTransientNetworkError(error)) {
          onRetry({ method, path, attempt, code: info.code });
          await sleep(retryDelayMs * attempt);
          continue;
        }
        trace.push({ method, path, error: info.code });
        throw new NetworkError({ method, path, code: info.code, detail, attempts: attempt, timedOut: info.timedOut, uncertain: !safeToRetry });
      }
    }
  };

  /** After a network failure: is the backend still answering at all? (one read-only GET, no retry) */
  const probeBackend = async () => {
    try {
      const res = await call("GET", "/health", undefined, { noCookie: true, attempts: 1 });
      return { reachable: true, status: res.status };
    } catch (error) {
      return { reachable: false, code: error.code };
    }
  };

  return { call, probeBackend, hasCookie: () => Boolean(cookie), trace };
};

/** Counts every check as exactly one of passed / failed / skipped / inconclusive. Nothing is "passed" unless it was performed. */
export const createReport = (log = console.log) => {
  const counts = { passed: 0, failed: 0, skipped: 0, inconclusive: 0 };
  const lists = { failed: [], skipped: [], inconclusive: [] };
  const show = (detail) => (typeof detail === "string" ? detail : JSON.stringify(detail));
  return {
    counts,
    lists,
    check(name, ok, detail) {
      if (ok) counts.passed += 1;
      else {
        counts.failed += 1;
        lists.failed.push(name);
      }
      log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   -> ${show(detail)}`}`);
      return Boolean(ok);
    },
    skip(name, reason) {
      counts.skipped += 1;
      lists.skipped.push(`${name} (${reason})`);
      log(`SKIP  ${name}   -> ${reason}`);
    },
    inconclusive(name, reason) {
      counts.inconclusive += 1;
      lists.inconclusive.push(`${name} (${reason})`);
      log(`INCONCLUSIVE  ${name}   -> ${reason}`);
    },
    /** 0 = everything performed passed; 1 = an application check failed; 3 = infrastructure problem / uncertain outcome. */
    exitCode() {
      if (counts.failed > 0) return 1;
      if (counts.inconclusive > 0) return 3;
      return 0;
    },
  };
};

/**
 * A state-changing request whose ANSWER was lost (network error). Never blindly repeated: wait for the backend, READ the state, and only
 * if the read proves the change was not applied is the request sent once more.
 *   request()  -> sends the write (may throw NetworkError)
 *   reread()   -> a safe GET returning the current state
 *   applied(r) -> true when that state shows the write was applied; false when it shows it was not; null when it is unclear
 * Returns { response, recovered: "applied" | "retried" | null, lost: NetworkError | null }. Throws the original error when the backend does
 * not come back or the state is unclear (the run then stops as INCONCLUSIVE).
 */
export const recoverUncertainWrite = async ({ request, reread, applied, probe, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), waitSeconds = 60 }) => {
  try {
    return { response: await request(), recovered: null, lost: null };
  } catch (error) {
    if (!(error instanceof NetworkError) || !error.uncertain) throw error;
    let up = false;
    for (let waited = 0; waited <= waitSeconds; waited += 2) {
      if ((await probe()).reachable) {
        up = true;
        break;
      }
      await sleep(2000);
    }
    if (!up) throw error;
    const state = await reread();
    const verdict = applied(state);
    if (verdict === true) return { response: state, recovered: "applied", lost: error };
    if (verdict === false) return { response: await request(), recovered: "retried", lost: error };
    throw error;
  }
};
