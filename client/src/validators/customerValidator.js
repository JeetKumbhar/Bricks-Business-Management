import { z } from "zod";

// Only the basics are checked here (the name is required). Everything else (GSTIN format, state code, phone, duplicates, the reserved
// name) is decided by the server, whose messages are shown under the fields.
const optionalText = z.string().trim().optional().default("");
export const customerSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer name").max(120, "Customer name is too long"),
  contact: optionalText,
  address: z.string().trim().max(300, "Address is too long").optional().default(""),
  gstin: optionalText,
  stateName: optionalText,
  stateCode: optionalText,
});
