// Turns what is on the entry screen into the request payload (pure, so it can be tested).
import { validateBatch } from "../../validators/pheeraValidator";
import { matchKnownMaterial, OTHER } from "../../utils/materials";

/**
 * drafts: the rows as typed ({ key, customerId, material, customMaterial, destination, quantity, remarks }).
 * -> { check (the validation result), payload: { businessDate, truckId, rows } | null }
 *  - every row needs a customer; the unit and the Pheera number are NOT part of the payload (the server decides them);
 *  - a typed material name spelled like one already used (only the capitals differ) is sent with the existing spelling;
 *  - each row gets the stable clientRowId "row-<key>": it does not change while the row is on screen, so a retry sends the same ids.
 */
export function prepareEntry({ businessDate, truckId, today, trucks, drafts, customNames = [] }) {
  const prepared = drafts.map((d) => (d.material === OTHER ? { ...d, customMaterial: matchKnownMaterial(d.customMaterial.trim().replace(/\s+/g, " "), customNames) } : d));
  const check = validateBatch({ businessDate, truckId, today, trucks, drafts: prepared, requireCustomer: true });
  if (!check.valid) return { check, payload: null };
  return { check, payload: { businessDate, truckId, rows: check.values.map((v, i) => ({ ...v, clientRowId: `row-${prepared[i].key}` })) } };
}
