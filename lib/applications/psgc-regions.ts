// ─────────────────────────────────────────────────────────────────────────────
// The top of the address cascade: our eighteen regions, narrowed to the ones the PSA has
// given a code.
//
// ⚠ THIS IS A PLAIN MODULE ON PURPOSE — no `"use client"`, no `server-only`. It started
// inside `components/applications/psgc-address-picker.tsx`, which carries `"use client"`,
// and a Server Component cannot CALL a function exported from a client module: it may
// render such a component, but invoking one fails at runtime with "Attempted to call
// toPsgcRegions() from the server but toPsgcRegions is on the client". The member detail
// page does exactly that, and the whole page 500'd (caught in CI, 2026-09-09).
//
// Both sides need this: the two public forms are client components, the member detail page
// is a Server Component. A module with neither directive is the only shape both can use.
// ─────────────────────────────────────────────────────────────────────────────

export type PsgcRegionOption = {
  /** Our `regions.psgc_code` — the PSA's two digits. */
  psgc_code: string;
  name: string;
};

/**
 * Drop any region the PSA has not given a code, so the picker never offers a top level it
 * cannot descend from.
 *
 * `regions.psgc_code` is nullable on purpose (0057): `021_reference_rls.sql` asserts that
 * tech_admin may add a nineteenth region, and a region the PSA has not yet published has
 * no code to give it. All eighteen seeded regions carry one, so today this filters
 * nothing — it is here so that the day a nineteenth is added, the picker omits it rather
 * than rendering an option that leads nowhere.
 */
export function toPsgcRegions(
  regions: ReadonlyArray<{ psgc_code: string | null; name: string }>,
): PsgcRegionOption[] {
  return regions
    .filter((r): r is { psgc_code: string; name: string } => r.psgc_code !== null)
    .map((r) => ({ psgc_code: r.psgc_code, name: r.name }));
}
