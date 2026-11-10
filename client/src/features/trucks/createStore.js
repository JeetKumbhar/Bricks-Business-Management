// A tiny external store (state + subscribe) so the logic of a screen's data lives in plain JavaScript and can be tested without a browser.
// React reads it with useSyncExternalStore (see the contexts).
export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    getState: () => state,
    setState: (patch) => {
      state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Lets only one save run at a time: a second call while one is running is ignored (resolves undefined). */
export function createSingleFlight() {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    async run(fn) {
      if (busy) return undefined;
      busy = true;
      try {
        return await fn();
      } finally {
        busy = false;
      }
    },
  };
}
