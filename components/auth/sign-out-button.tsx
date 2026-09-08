// ─────────────────────────────────────────────────────────────────────────────
// The sign-out control, rendered in every authenticated route group's header and
// inside the MFA cards (where a lost authenticator must not be a dead end).
//
// A Server Component on purpose: `signOut` is a Server Action with no input to
// validate, so a plain <form action> needs no client bundle, no `useTransition`
// and no fetch. It also means the control still works with JavaScript disabled,
// which matters for the one thing a user must always be able to do on a shared
// machine. Client components that need it receive it as a ReactNode prop from
// their page rather than importing it — that keeps the server/client boundary
// exactly where it is.
//
// This is a UX affordance, not an authorization mechanism. Session validity is
// re-checked by `middleware.ts` and by every RLS policy on every request; a user
// who never clicks this is not thereby authorized for anything.
//
// Two looks (brand restyle, 2026-09-08): `link` — the quiet text link under a form —
// and `button` — the reversed-gradient pill the app shell uses.
// ─────────────────────────────────────────────────────────────────────────────

import { buttonVariants } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

const VARIANT_CLASS = {
  link: "text-brand-label cursor-pointer text-xs underline-offset-4 hover:underline",
  button: buttonVariants({ variant: "brand-reverse" }),
} as const;

export function SignOutButton({
  variant = "link",
  className,
}: {
  variant?: keyof typeof VARIANT_CLASS;
  className?: string;
}) {
  return (
    <form action={signOut} className={className}>
      <button type="submit" className={cn(VARIANT_CLASS[variant])}>
        Sign out
      </button>
    </form>
  );
}
