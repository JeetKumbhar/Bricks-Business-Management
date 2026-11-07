// Pure helpers that merge what the server returned into the lists the screens read. No React, no requests.
// The server's answer always wins: a list is never patched with what the screen guessed.

/** Insert or replace one record by id. */
export const upsertById = (list, item) => {
  const index = list.findIndex((x) => x.id === item.id);
  if (index === -1) return [...list, item];
  const next = list.slice();
  next[index] = item;
  return next;
};

export const removeById = (list, id) => list.filter((x) => x.id !== id);

/** Replace every record of one business date with the server's full list for that day. */
export const replaceDay = (list, date, items) => [...list.filter((x) => x.date !== date), ...items];

/** Replace every record of one labour (for example its rate history) with the server's list. */
export const replaceForLabour = (list, labourId, items) => [...list.filter((x) => x.labourId !== labourId), ...items];

/** How many records a day-save created or corrected (unchanged rows do not count). */
export const changedCount = (saved) => (saved?.created ?? 0) + (saved?.updated ?? 0);
