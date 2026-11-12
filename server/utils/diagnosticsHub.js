// Lets code outside server.js (database events, the error handler) write to the same diagnostics file without importing server.js.
// Until server.js registers the real one, and in tests, it does nothing.
let current = { event: () => false, error: () => false };
export const setDiagnostics = (diagnostics) => {
  current = diagnostics;
};
export const diag = {
  event: (...args) => {
    try {
      return current.event(...args);
    } catch {
      return false;
    }
  },
  error: (...args) => {
    try {
      return current.error(...args);
    } catch {
      return false;
    }
  },
};
