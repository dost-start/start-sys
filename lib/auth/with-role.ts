// ─────────────────────────────────────────────────────────────────────────────
// The opening line of every Server Action in START-SYS (CONVENTIONS.md §0 rule 6,
// §4.2). The mandated order is:
//
//     withRole([...])  ->  schema.safeParse(input)  ->  supabase call
//                      ->  mapDbError  ->  revalidatePath  ->  ActionResult
//
// ⚠️ THIS IS DEFENCE IN DEPTH, NOT THE BOUNDARY.
//
// The identical call must already be refused by the underlying RLS policy or the
// SECURITY DEFINER function's own role guard, independently and without this wrapper
// (CLAUDE.md "Definition of done" item 6). The asymmetry is the design: if `withRole`
// is wrong, RLS still refuses; if a policy is wrong, `withRole` still refuses. If the
// two ever disagree, THE POLICY IS THE ANSWER AND `withRole` IS THE BUG.
//
// What it actually buys: a denied action returns a clean `unauthorized` instead of an
// opaque empty result, and the inner function never runs — so it cannot mint a side
// effect (an email, a Drive session URI, a Sentry breadcrumb) on the way to being
// refused by the database.
// ─────────────────────────────────────────────────────────────────────────────

import type { ActionResult } from "@/lib/action-result";
import { err } from "@/lib/action-result";
import { getSessionContext, type SessionContext } from "@/lib/auth/queries";
import type { OrgRole } from "@/lib/auth/route-access";

/** What a guarded action receives: the caller, and the caller's own Supabase client. */
export type ActionContext = SessionContext;

/** The shape of a guarded action's body. */
export type GuardedAction<TIn, TOut> = (
  ctx: ActionContext,
  input: TIn,
) => Promise<ActionResult<TOut>>;

/**
 * Wrap a Server Action so it runs only for the listed roles.
 *
 * A caller with no session, no `user_roles` row, or a role outside `roles` receives
 * `unauthorized` and `fn` IS NOT INVOKED — asserted by a spy count of 0 in
 * `with-role.test.ts`. The refusal message is the same in every case, so it never
 * discloses which role would have been required.
 *
 * @param roles the tiers permitted to run this action. Never widen this list to make a
 *              screen work: if the action needs a role the policy does not grant, the
 *              policy is what has to change, with a pgTAP test written first.
 */
export function withRole<TIn = void, TOut = void>(
  roles: readonly OrgRole[],
  fn: GuardedAction<TIn, TOut>,
): (input: TIn) => Promise<ActionResult<TOut>> {
  return async function guarded(input: TIn): Promise<ActionResult<TOut>> {
    const ctx = await getSessionContext();

    // No session, or an account with no live role. Both are "no capability".
    if (ctx === null) return err<TOut>("unauthorized");

    if (!roles.includes(ctx.role)) return err<TOut>("unauthorized");

    return fn(ctx, input);
  };
}

/**
 * Wrap a Server Action so it runs for any signed-in account, whatever their tier.
 *
 * For the handful of actions whose authorization is entirely row-scoped — a member
 * marking their own notification read, say — where the policy, not the tier, is the
 * whole of the rule. Still not unguarded: an anonymous caller is refused here, and
 * `withPublic()` (S3-T14) is the separate, explicit wrapper for the two genuinely
 * anonymous intake actions, so an unguarded-looking action is never ambiguous with a
 * forgotten guard.
 */
export function withAnyRole<TIn = void, TOut = void>(
  fn: GuardedAction<TIn, TOut>,
): (input: TIn) => Promise<ActionResult<TOut>> {
  return async function guarded(input: TIn): Promise<ActionResult<TOut>> {
    const ctx = await getSessionContext();
    if (ctx === null) return err<TOut>("unauthorized");
    return fn(ctx, input);
  };
}
