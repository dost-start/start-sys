"use client";

// The login form. Bound to the SAME `signInSchema` the Server Action re-parses
// (CONVENTIONS §6) — the client check here is UX, never enforcement. Server field
// errors (currently just `_form`, since `signIn` returns one generic message either
// way — see `lib/auth/actions.ts`) are attached via `setError`, never a bare toast.
//
// No "create account" affordance anywhere in this file. Accounts are invite-only.
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { isErr } from "@/lib/action-result";
import { signIn } from "@/lib/auth/actions";
import { type SignInInput, signInSchema } from "@/lib/auth/schema";

export function LoginForm({ next }: { next?: string }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  // ⚠ A1 — see the `method="post"` note on the <form> below. The submit control stays
  // disabled until this effect runs, which is the moment React has hydrated and
  // `onSubmit` is live. Before that there is no JS handler, so a fast submit on a slow
  // connection would be a NATIVE submit. The disabled button is UX; `method="post"` is
  // the actual guarantee, because a determined Enter keypress can still submit a form
  // whose button is disabled.
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => setIsHydrated(true), []);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const formError = errors.root?.message;

  async function onSubmit(values: SignInInput) {
    setIsSubmitting(true);
    try {
      // On success `signIn` redirects server-side and never returns to this branch.
      const result = await signIn(next, values);
      if (isErr(result)) {
        const fieldErrors = result.error.fields;
        if (fieldErrors) {
          for (const [key, messages] of Object.entries(fieldErrors)) {
            const message = messages[0];
            if (!message) continue;
            if (key === "_form") {
              setError("root", { message });
            } else if (key === "email" || key === "password") {
              setError(key, { message });
            }
          }
        } else {
          setError("root", { message: result.error.message });
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  // Field-level messages stay plain paragraphs (no `role="alert"`): e2e/fixtures/auth.ts
  // reads the ONE form-level alert below, and a second alert on the page would make
  // that lookup ambiguous. The inputs carry `aria-invalid` either way.
  // ⚠ A1 — CREDENTIAL EXPOSURE, found in QA 2026-09-09. This form carried no `method`,
  // so a submit landing before React hydrated performed the HTML default: a GET, which
  // puts `?email=…&password=…` in the address bar, in browser history, in the `Referer`
  // header of the next navigation, and in the hosting provider's access log. Observed
  // live as `/login?email=demo.ccdo%40start-sys.test&password=ccdo123`.
  //
  // `method="post"` makes the pre-hydration fallback a POST to this same route, which is
  // a Server Component page with no POST handler — so it fails with a 405 and the
  // credentials never leave the request body. Failing loudly is the correct outcome;
  // leaking quietly is not. DO NOT REMOVE THIS ATTRIBUTE.
  return (
    <form
      method="post"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-5"
    >
      <Field>
        <FieldLabel htmlFor="email">Email address</FieldLabel>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          aria-invalid={errors.email ? "true" : "false"}
          {...register("email")}
        />
        {errors.email && <p className="text-destructive text-sm">{errors.email.message}</p>}
      </Field>

      <Field>
        <FieldLabel htmlFor="password">Password</FieldLabel>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={errors.password ? "true" : "false"}
          {...register("password")}
        />
        {errors.password && <p className="text-destructive text-sm">{errors.password.message}</p>}
      </Field>

      {formError && (
        <p role="alert" className="text-destructive text-center text-sm">
          {formError}
        </p>
      )}

      <div className="flex flex-col items-center gap-3.5 pt-1.5">
        <Button
          type="submit"
          className="mx-auto w-full sm:w-[320px]"
          disabled={isSubmitting || !isHydrated}
        >
          {isSubmitting ? "Signing in…" : "Log in"}
        </Button>
        {/*
          A8 (reviewer PDF 2026-09-09): applicants were reaching /login looking for the
          application form and finding no way onward. This points them at /apply. It is
          NOT a signup affordance — /apply creates an application, never an account, and
          the wording deliberately avoids "sign up", "register" and "create an account"
          so `e2e/login.spec.ts` case 3 keeps passing.
        */}
        <p className="text-muted-foreground text-center text-xs">
          Applying for membership?{" "}
          <Link
            href="/apply"
            className="text-brand-link font-medium underline-offset-4 hover:underline"
          >
            Go to the application form
          </Link>
          .
        </p>
      </div>
    </form>
  );
}
