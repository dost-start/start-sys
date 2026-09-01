// ─────────────────────────────────────────────────────────────────────────────
// The opening line of the two genuinely ANONYMOUS Server Actions in START-SYS.
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS AT ALL, GIVEN IT GRANTS NOTHING
// ═══════════════════════════════════════════════════════════════════════════════
// CONVENTIONS.md §0 rule 6: "Every Server Action opens with `withRole([...])`." The
// intake actions cannot — the applicant has no account, by design (PRD US-B1: "the
// form is reachable without an account"). An action that simply opened with no
// wrapper would then be INDISTINGUISHABLE FROM ONE WHOSE GUARD SOMEBODY FORGOT, on
// the only unauthenticated write path in the entire system.
//
// So being public is stated explicitly, in the same position a role guard would
// occupy. `actions-are-guarded.test.ts` reads every action module's source and
// asserts that every exported action is wrapped in `withRole`, `withAnyRole` or
// `withPublic` — which is only a meaningful assertion because this wrapper exists.
//
// ⚠ IT IS NOT THE BOUNDARY. Nothing here authorizes anything. The boundary for
// `startApplication` is the `applications_insert_anon` policy (0008), which checks the
// application window, pins `term_id` to `current_term_id()` and forces `status =
// 'draft'`; the boundary for `finalizeApplication` is the sha256 token check inside
// `finalize_application()` (0019). Delete this file and no data leaks — the form just
// gets worse error messages and loses its throttle.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ONE MESSAGE FOR TWO OUTCOMES, DELIBERATELY
// ═══════════════════════════════════════════════════════════════════════════════
// A rate-limit refusal returns the SAME code and the SAME message as an ordinary
// validation failure. A distinct "you are being rate limited" code would itself be a
// signal: it tells a prober that their earlier requests registered, which is exactly
// the confirmation the anti-enumeration design in 0008/0019 spends its whole budget
// denying them (BUILD_PLAN S3-T14).
// ─────────────────────────────────────────────────────────────────────────────

import { headers } from "next/headers";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/database.types";
import { type ActionResult, err, validationFailure } from "@/lib/action-result";
import { checkRateLimit } from "@/lib/rate-limit";
import { createServerSupabase } from "@/lib/supabase/server";

// ── The schema shape, structurally ───────────────────────────────────────────
// Structural rather than `z.ZodType`, so this module carries no type dependency on a
// particular zod major and a test can pass a hand-rolled parser.

type ParseSuccess<T> = { success: true; data: T };
type ParseFailure = {
  success: false;
  error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> };
};

export type PublicSchema<T> = {
  safeParse(input: unknown): ParseSuccess<T> | ParseFailure;
};

// ── Rate-limit specs ─────────────────────────────────────────────────────────

export type PublicRateLimitSpec<TParsed> = {
  /** Bucket name, e.g. `apply_ip`. Namespaces one subject across different limits. */
  bucket: string;
  /** Attempts per window. */
  limit: number;
  /** Postgres interval literal. `checkRateLimit` defaults to one hour. */
  window?: string;
  /**
   * How to derive the subject from the PARSED input.
   *
   * Absent means "key on the caller's IP", and an IP-keyed bucket runs BEFORE parsing —
   * it is the cheap gate, and it must not require us to have read the body first.
   * Present means the bucket runs AFTER parsing, because the subject is a field. Return
   * `null` to skip the bucket for this particular input.
   */
  key?: (input: TParsed) => string | null;
};

/** What a public action receives. No user, because there is not one. */
export type PublicContext = {
  /** The caller's own Supabase client — `anon`, since a public page holds no session. */
  supabase: SupabaseClient<Database>;
  /**
   * The caller's IP as reported by the proxy.
   *
   * ⚠ PERSONAL DATA under RA 10173 (CBL Art. VIII §6). It is passed to the rate limiter,
   * which HMACs it before it reaches the database, and it is NEVER logged, never stored
   * raw and never written into an `ActionError` message.
   */
  ip: string;
};

export type PublicAction<TParsed, TOut> = (
  ctx: PublicContext,
  input: TParsed,
) => Promise<ActionResult<TOut>>;

export type WithPublicOptions<TParsed> = {
  /** One spec, several, or `null` for no throttle. */
  rateLimit: PublicRateLimitSpec<TParsed> | ReadonlyArray<PublicRateLimitSpec<TParsed>> | null;
  schema: PublicSchema<TParsed>;
};

/** Used when there is no forwarded address. Everyone unattributable shares one bucket. */
const UNKNOWN_IP = "unknown";

/**
 * The caller's IP, taken from the FIRST hop of `x-forwarded-for`.
 *
 * The first hop is the client; every entry after it is a proxy. Taking the last hop
 * would key every applicant behind Vercel's edge to the same bucket and turn the
 * limiter into an outage. The header is client-controllable in principle — behind
 * Vercel it is rewritten — so this is a best-effort attribution, which is the correct
 * strength for a throttle that is not the authorization boundary.
 */
async function resolveClientIp(): Promise<string> {
  const headerList = await headers();

  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return headerList.get("x-real-ip")?.trim() || UNKNOWN_IP;
}

function toArray<T>(value: T | ReadonlyArray<T> | null): ReadonlyArray<T> {
  if (value === null) return [];
  return Array.isArray(value) ? value : [value as T];
}

/**
 * Wrap an anonymous Server Action: throttle, validate, then run.
 *
 * @param options.rateLimit buckets. IP-keyed ones run before parsing; input-keyed ones
 *        after, since their subject is a field of the parsed body.
 * @param options.schema the SAME schema module the client form uses. The client check
 *        is UX; this re-parse is the one that counts (CONVENTIONS §6).
 */
export function withPublic<TParsed, TOut>(
  options: WithPublicOptions<TParsed>,
  fn: PublicAction<TParsed, TOut>,
): (input: unknown) => Promise<ActionResult<TOut>> {
  const specs = toArray(options.rateLimit);
  const ipSpecs = specs.filter((spec) => spec.key === undefined);
  const inputSpecs = specs.filter((spec) => spec.key !== undefined);

  return async function publicAction(input: unknown): Promise<ActionResult<TOut>> {
    const ip = await resolveClientIp();
    const supabase = await createServerSupabase();

    // ── 1. IP-keyed throttle, BEFORE the body is even parsed ──────────────────
    for (const spec of ipSpecs) {
      const allowed = await checkRateLimit({
        supabase,
        bucket: spec.bucket,
        key: ip,
        limit: spec.limit,
        ...(spec.window === undefined ? {} : { window: spec.window }),
      });
      // Same code, same message as a validation failure. See the header.
      if (!allowed) return err<TOut>("validation");
    }

    // ── 2. Validate ──────────────────────────────────────────────────────────
    const parsed = options.schema.safeParse(input);
    if (!parsed.success) return validationFailure<TOut>(parsed.error);

    // ── 3. Input-keyed throttle, now that there is a subject to key on ───────
    for (const spec of inputSpecs) {
      const subject = spec.key?.(parsed.data) ?? null;
      if (subject === null) continue;

      const allowed = await checkRateLimit({
        supabase,
        bucket: spec.bucket,
        key: subject,
        limit: spec.limit,
        ...(spec.window === undefined ? {} : { window: spec.window }),
      });
      if (!allowed) return err<TOut>("validation");
    }

    return fn({ supabase, ip }, parsed.data);
  };
}
