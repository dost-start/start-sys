"use client";

// The login form. Bound to the SAME `signInSchema` the Server Action re-parses
// (CONVENTIONS §6) — the client check here is UX, never enforcement. Server field
// errors (currently just `_form`, since `signIn` returns one generic message either
// way — see `lib/auth/actions.ts`) are attached via `setError`, never a bare toast.
//
// No "create account" affordance anywhere in this file. Accounts are invite-only.
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { isErr } from "@/lib/action-result";
import { signIn } from "@/lib/auth/actions";
import { type SignInInput, signInSchema } from "@/lib/auth/schema";

export function LoginForm({ next }: { next?: string }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
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
  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
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
        <Button type="submit" className="mx-auto w-full sm:w-[320px]" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Log in"}
        </Button>
        <p className="text-muted-foreground text-center text-xs">
          Officer accounts are created by invitation.
        </p>
      </div>
    </form>
  );
}
