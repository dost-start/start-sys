// ─────────────────────────────────────────────────────────────────────────────
// One zod schema per form/entity (CONVENTIONS.md §6), imported by both the login
// form and the `signIn` Server Action. Field names equal the form field `name`s.
//
// Deliberately permissive on `password`: this schema exists to catch an EMPTY
// submission before a network round trip, not to enforce a password policy —
// Supabase Auth owns hashing and any strength rule (ARCHITECTURE §5). A tighter
// check here would just be a second, drifting copy of a rule GoTrue already
// enforces at account creation.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

export const signInSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type SignInInput = z.infer<typeof signInSchema>;
