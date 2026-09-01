/**
 * Next.js instrumentation hook.
 *
 * Deliberately a no-op today. Sentry is wired here in S7-T8, together with the
 * `beforeSend` scrub that deletes `request.data` and `request.cookies` outright —
 * without it, a failed `/apply` POST would ship an entire application body (birthdate,
 * address, contact number, school ID) to a US error tracker, which is a reportable
 * disclosure under RA 10173.
 *
 * Do not import `@sentry/nextjs` until that task lands.
 */
export async function register(): Promise<void> {
  // no-op — see S7-T8.
}
