import { z } from "zod";

// Strings only: an object such as {"$gt": ""} in place of the email is rejected here, before it can reach a database query.
export const loginSchema = z
  .object({
    email: z.string({ error: "Email is required" }).trim().toLowerCase().pipe(z.email({ error: "Enter a valid email address" }).max(254)),
    password: z.string({ error: "Password is required" }).min(1, "Password is required").max(128, "Password is too long"),
  })
  .strict();
