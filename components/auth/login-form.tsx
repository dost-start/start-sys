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

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-invalid={errors.email ? "true" : "false"}
          {...register("email")}
        />
        {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-invalid={errors.password ? "true" : "false"}
          {...register("password")}
        />
        {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
      </div>

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Signing in…" : "Log in"}
      </Button>
    </form>
  );
}
