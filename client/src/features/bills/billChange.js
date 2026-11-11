import { ApiError } from "../../services/api";

/**
 * Runs one bill write, then re-reads the list. After an UNSURE outcome (lost connection, timeout, 5xx) the list is re-read as well,
 * so the screen shows what the server really holds, and the original error is still thrown (it is never reported as "saved").
 */
export async function runBillChange(run, refresh) {
  try {
    const result = await run();
    await refresh();
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.isConnectionProblem) await refresh();
    throw error;
  }
}
