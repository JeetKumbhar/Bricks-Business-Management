
// Helpers shared by the MOCKED service tests (fetch is replaced by a stub; no real server or database is involved).
import { vi } from "vitest";

const JSON_HEADERS = { "content-type": "application/json" };
export const ok = (data, meta, status = 200) => new Response(JSON.stringify({ success: true, message: "ok", data, ...(meta ? { meta } : {}) }), { status, headers: JSON_HEADERS });
export const fail = (status, message, errors) => new Response(JSON.stringify({ success: false, message, ...(errors ? { errors } : {}) }), { status, headers: JSON_HEADERS });
export const stubFetch = () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};
export const call = (fetchMock, i = 0) => {
  const [url, init] = fetchMock.mock.calls[i];
  const u = new URL(url, "http://x");
  return { method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : undefined };
};
