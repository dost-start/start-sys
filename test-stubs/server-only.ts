// A no-op stand-in for the `server-only` package, used ONLY by Vitest.
//
// `server-only`'s published entry point throws on import by design: that is how it turns
// "a client bundle imported a server module" into a BUILD error. Vitest is neither a
// client nor a server bundle, so it hits the throw and cannot load any module that
// guards itself — which is most of `lib/`.
//
// Aliasing it here does not weaken the guard. The guard is enforced by Next's bundler at
// build time (and by `scripts/audit-client-bundle.mjs` afterwards); Vitest never produces
// a client bundle and could not enforce it either way. What this buys is the ability to
// unit-test a server-only module's LOGIC, which is otherwise untestable.
export {};
