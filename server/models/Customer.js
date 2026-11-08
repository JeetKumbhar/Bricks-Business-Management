import mongoose from "mongoose";
import { CUSTOMER_HISTORY, CUSTOMER_KIND, CUSTOMER_KIND_VALUES, CUSTOMER_LIMITS } from "../constants/customer.js";
import { createSchema, softDeleteFields } from "../utils/schema.js";

// One shared customer record for Bills and Pheeras. Bills keep their own frozen snapshot of the customer, so editing or archiving a
// customer never changes an invoice that has been issued.
//  - customerKey = trimmed, whitespace-collapsed, lower-case name. UNIQUE over ALL records (archived ones too), so two customers can
//    never share a name and an archived name is never silently reused (it must be restored explicitly).
//  - kind INTERNAL is the single built-in "Internal / No Bill" customer. It is never billable and cannot be edited or archived.
const line = { type: String, trim: true, default: "" };

const historySchema = new mongoose.Schema(
  {
    action: { type: String, enum: Object.values(CUSTOMER_HISTORY), required: true },
    at: { type: Date, required: true },
    by: { type: String, required: true },
    byId: { type: String, default: null },
    reason: { type: String, default: null },
    revision: { type: Number, required: true },
  },
  { _id: false }
);

const customerSchema = createSchema({
  name: { type: String, required: true, trim: true, minlength: CUSTOMER_LIMITS.nameMin, maxlength: CUSTOMER_LIMITS.nameMax },
  customerKey: { type: String, required: true },
  kind: { type: String, enum: CUSTOMER_KIND_VALUES, default: CUSTOMER_KIND.NORMAL, immutable: true },
  address: line,
  gstin: line,
  stateName: line,
  stateCode: line,
  contact: line,
  revision: { type: Number, default: 1 },
  // Bumped (in the same transaction) by every operation that creates or reserves a Pheera for this customer, and by archiving. All of
  // them write this one document, so MongoDB's write-conflict detection makes them take turns: archive and "new Pheera / new draft"
  // can never both succeed on a stale read. Not shown to clients.
  lockVersion: { type: Number, default: 0 },
  history: { type: [historySchema], default: [] },
  ...softDeleteFields(),
  createdBy: { type: String, default: null },
  createdByName: { type: String, default: null },
  updatedBy: { type: String, default: null },
  updatedByName: { type: String, default: null },
});

customerSchema.index({ customerKey: 1 }, { unique: true });
customerSchema.index({ kind: 1 });

export default mongoose.models.Customer || mongoose.model("Customer", customerSchema);
