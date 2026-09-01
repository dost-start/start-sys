# CLAUDE.md — START-SYS

@PRD.md
@ARCHITECTURE.md
@DATA_MODEL.md
@CONVENTIONS.md
@BUILD_PLAN.md
@SCRATCH.md

## Orientation

1. START-SYS is the centralized membership information system for START-DOST, a Philippine DOST scholar org. Built by CRRD with the Technology Department. Heads: Danielle Quiambao, Ethan Baltazar.
2. It holds real PII for ~600 scholars + 70 officers under RA 10173: birthdates, addresses, contact numbers, school ID numbers, and Certificates of Registration. A leak is the worst outcome available; treat it as the top constraint.
3. Stack: Next.js 16 App Router + supabase-js → Postgres 17 on Supabase Pro (ap-southeast-1), Vercel (sin1), Resend, Google Drive. No ORM. No Docker. No queue.
4. **Postgres RLS is the authorization boundary.** Middleware and `withRole()` are UX and defence-in-depth. If deleting middleware would leak data, the change is wrong.
5. Maintainers are student officers who hand the system over every academic year. Handover cost outranks cleverness. Boring wins.
6. **The START-DOST Constitution and By-Laws 2026 (CBL) is the authority for org structure, tenure, separation from office and membership termination** — 23 positions (Art. III §2/§3/§4.6/§5), seven departments (Art. III §4), exactly four administrators (CEO, COO, CTO, CCDO), a term ending in May (Art. V §1). It is seeded data with articles cited inline, never a string literal in TypeScript. Never invent a provision; cite only what the text says.

If a query returns an empty set with no error, read the "If your query returns nothing, read this first" section of @ARCHITECTURE.md before debugging. That is RLS, not a bug.

## Commands

| Task | Command |
|---|---|
| Dev server | `pnpm dev` |
| Build | `pnpm build` |
| Unit tests | `pnpm test` (vitest) |
| E2E smoke | `pnpm test:e2e` (playwright) |
| RLS security suite | `pnpm test:rls` → `supabase test db` (pgTAP) |
| Lint + format | `pnpm check` (eslint 9 flat + prettier 3) |
| Typecheck | `pnpm typecheck` (`tsc --noEmit`) |
| New migration | `pnpm db:new <name>` → `supabase migration new <name>` |
| Apply locally / reset | `pnpm db:reset` → `supabase db reset` |
| Regenerate DB types | `pnpm db:types` → `supabase gen types typescript --local > database.types.ts` |
| Lint schema | `pnpm db:lint` → `supabase db lint` |
| Email preview | `pnpm email` → `react-email dev` |

<!-- decision: package.json script names are not fixed by the locked stack; these short aliases are chosen for handover legibility. -->
Node 24.x via `.nvmrc`. pnpm 11.x via `packageManager`. Never `npm` or `yarn`. Migrations apply to production only via CI on merge to `main` — never by hand in the Supabase dashboard.

## Naming

Full rules in @CONVENTIONS.md. The ones that get broken:

| Thing | Rule | Example |
|---|---|---|
| Tables | `snake_case`, plural | `officer_assignments` |
| Columns | `snake_case`; timestamps `*_at` `timestamptz`; booleans `is_*` / `has_*` | `reviewed_at`, `is_active` |
| Keys | PK is always `id uuid`; FK is `<singular>_id` | `person_id`, `term_id` |
| Views | `v_` prefix | `v_member_directory` |
| Auth helpers | `auth_*()` | `auth_role()`, `auth_region_id()` |
| RPCs | verb_noun, `snake_case` | `approve_application()`, `roll_over_term()` |
| Enum values | lowercase `snake_case` | `crrd_admin`, `renewal_pending` |
| TS files/dirs | `kebab-case` | `lib/members/resolve-filters.ts` |
| Components | file `kebab-case.tsx`, export `PascalCase`, one per file | `member-status-badge.tsx` → `MemberStatusBadge` |
| Zod schemas | `<entity><Verb>Schema` in `lib/<feature>/schema.ts` | `applicationSubmitSchema` |
| Server Actions | `verbNoun` in `lib/<feature>/actions.ts`, `"use server"` at top | `approveApplication` |
| Env vars | `SCREAMING_SNAKE`; `NEXT_PUBLIC_` only for the Supabase URL and anon key | `RESEND_API_KEY` |

Feature folders, not layer folders: `app/(admin)/members/` + `lib/members/`. Types come from generated `database.types.ts` — never hand-write a row type. `any` is banned; `strict` and `noUncheckedIndexedAccess` are on.

## Banned patterns

**Authorization / data access**
- Never import the service-role client outside `lib/server/admin-client.ts`. It exists for the invite flow and the backup job only. An ESLint `no-restricted-imports` rule enforces this — if you find yourself editing that rule, stop and ask.
- Never add an ORM or a direct Postgres connection (`pg`, `postgres`, Prisma, Drizzle). All user-facing reads and writes go through `supabase-js` with the caller's JWT so RLS applies by construction.
- Never ship a table in `public` without both `ENABLE` and `FORCE ROW LEVEL SECURITY`. The pgTAP meta-test will fail CI; do not weaken the test.
- Never store a role in `user_metadata` or stamp roles into the JWT. Roles live in `public.user_roles` and are read per statement, so revocation is instant.
- Never write a `SECURITY DEFINER` function without `SET search_path = ''`.
- Never rely on a hidden link, a disabled button, or a route guard as the enforcement of a permission. The policy is the permission.
- Never widen `v_member_directory` or a column-level `GRANT` to make an officer screen work. Officers and regional reps see name, member ID, region, status, committee — nothing else.

**Records and lifecycle**
- Never hard-delete anything. No `DELETE` policy exists anywhere in the schema and none may be added. Membership end is a status change; term end is a flag on `terms`.
- Never merge `memberships.status` (CBL Art. VII, termination of **membership**) with `officer_assignments.status` (CBL Art. VI, separation from **office**). Different Articles, different deciding bodies: an impeached officer is still a member. Adding a value to either without checking which Article the event lives in is the single most likely future mistake in this schema (@DATA_MODEL.md §3.1, §3.4).
- Never mutate rows belonging to a term whose `status = 'archived'`, and never write outside `current_term_id()` without an explicit, reviewed reason.
- Never create `_archive` tables or an annual data-migration job. Rollover is `roll_over_term()`, one transaction, idempotent.
- Never generate, format, or assign a `member_id` in TypeScript. Only `approve_application()` may allocate one, via `member_id_counters`. `2024-001` never becomes `2025-001`.
- Never hand-add a recipient to the renewal campaign. Eligibility is the server-side `renewal_eligible` predicate; it is not a checkbox.

**Privacy**
- Never log PII. No `console.log` of a person, application, or merge payload; Sentry `beforeSend` strips request bodies and must stay. Log IDs, never values.
- Never read PII in a Client Component. PII is fetched in Server Components and passed only as far as the rendered screen requires.
- Never mail-merge a field outside `v_email_merge_fields`. A birthdate or phone number in a bulk send is a reportable breach.
- Never share a Drive file publicly, never grant "anyone with the link", never add admins to the Shared Drive individually, and never use the `drive` or `drive.readonly` scope. `drive.file` only.
- Never return a Drive URL to the browser. Documents stream through `GET /api/applications/[id]/proof`, which authorizes by doing an ordinary RLS-checked `SELECT` first and writes an audit row on every view.
- Never POST upload bytes through a Route Handler. Vercel caps request bodies at 4.5MB; the browser PUTs to a server-minted resumable session URI, and the server re-verifies size and MIME from Drive metadata afterward.

**Infrastructure**
- Never commit a secret, a real `.env`, a service-account JSON, or the backup private key. `.env.example` only.
- Never add `pg_cron`, `pg_net`, Vercel Cron, Redis, BullMQ, Inngest, or QStash. Every recurring job goes in `.github/workflows/scheduled.yml`.
- Never point a preview deployment at the production Supabase project. Preview-scoped env vars target the seeded staging project.
- Never add a client state-management library. Filters, sorting and pagination live in URL search params.
- Never install a runtime component library. shadcn/ui components are vendored source in `components/ui/` and are edited in place.
- Never edit a migration that has been applied. Write a new one.

## Definition of done

A change is done when all of these are true:

1. `pnpm typecheck`, `pnpm check`, `pnpm test`, `pnpm db:lint` and `pnpm test:rls` all pass locally.
2. New or changed tables have RLS enabled + forced, explicit policies per role, and **new pgTAP assertions** covering exact row counts and visible columns for the affected role fixtures (anon, member, officer, two regional reps, moderator, crrd_admin, exec_admin, tech_admin).
3. Schema changes are a committed migration file, and `database.types.ts` is regenerated and committed in the same commit.
4. Any change to `people`, `memberships`, `officer_assignments`, `applications`, `committee_memberships`, `department_assignments`, `user_roles`, `rr_send_grants`, `terms` or `confidentiality_acknowledgements` writes an `audit_log` row via the `audit_row()` trigger — including the acting user (list of record: @DATA_MODEL.md §8.3). If a new table holds records of that kind, attach the trigger and register any sensitive column in `sensitive_column_registry` in the same migration.
5. Validation runs from a shared zod schema on both the client form and inside the Server Action.
6. Every Server Action opens with `withRole([...])`, and the underlying RLS policy would refuse the same call independently.
7. If it touches auth, RLS, Drive, email sending, or term rollover: the relevant section of @ARCHITECTURE.md and the matching runbook are updated in the same PR. The PRD's Maintainability NFR requires documentation for every system change.
8. If it touches login, application submission + upload, approval → member ID, campaign send, rollover, or regional-rep scoping: the Playwright smoke flow for it passes.

## Scope discipline

Out of scope per the PRD, permanently: operations management, event management, financial management, general file storage, advanced analytics. Do not build them. If a request implies one, say so and stop.

Do not invent requirements. If the PRD is silent, check @PRD.md §7 (OQ-1 … OQ-18, the authoritative open-question register — OQ-15…OQ-18 are the ones the Constitution itself raises) — surface the question, pick the boring option, and mark it `<!-- decision: ... -->` rather than deciding silently. A real deviation from the locked stack needs an ADR in `docs/decisions/`, not a note in @SCRATCH.md; SCRATCH.md is a disposable scratchpad and is never a decision record.
