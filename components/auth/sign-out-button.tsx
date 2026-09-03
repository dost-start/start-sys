// ─────────────────────────────────────────────────────────────────────────────
// The sign-out control, rendered in every authenticated route group's header.
//
// A Server Component on purpose: `signOut` is a Server Action with no input to
// validate, so a plain <form action> needs no client bundle, no `useTransition`
// and no fetch. It also means the control still works with JavaScript disabled,
// which matters for the one thing a user must always be able to do on a shared
// machine.
//
// This is a UX affordance, not an authorization mechanism. Session validity is
// re-checked by `middleware.ts` and by every RLS policy on every request; a user
// who never clicks this is not thereby authorized for anything.
// ─────────────────────────────────────────────────────────────────────────────

import { signOut } from "@/lib/auth/actions";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="text-muted-foreground hover:text-foreground cursor-pointer text-xs underline-offset-4 hover:underline"
      >
        Sign out
      </button>
    </form>
  );
}
