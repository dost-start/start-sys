# START-SYS

Centralized Membership Information Management System for START-DOST.
Scope: [PRD.md](PRD.md). Stack + boundaries: [ARCHITECTURE.md](ARCHITECTURE.md).
Schema: [DATA_MODEL.md](DATA_MODEL.md). Style: [CONVENTIONS.md](CONVENTIONS.md).
Working contract: [CLAUDE.md](CLAUDE.md).

## Cold start

```bash
nvm use                          # Node version pinned in .nvmrc
corepack enable                  # pnpm pinned in package.json's packageManager field
pnpm i --frozen-lockfile
cp .env.example .env.local       # fill in real values from Bitwarden — see .env.example
supabase start                   # needs Docker running
supabase db reset                # applies every migration in supabase/migrations/ + seed
pnpm dev
```

## Commands

| Task | Command |
|---|---|
| Dev server | `pnpm dev` |
| Build | `pnpm build` |
| Unit tests | `pnpm test` |
| E2E smoke | `pnpm test:e2e` |
| RLS security suite | `pnpm test:rls` |
| Lint + format | `pnpm check` |
| Typecheck | `pnpm typecheck` |
| New migration | `pnpm db:new <name>` |
| Apply locally / reset | `pnpm db:reset` |
| Regenerate DB types | `pnpm db:types` |
| Lint schema | `pnpm db:lint` |
| Email preview | `pnpm email` |

## Compliance position

START-SYS handles real personal data for ~600 scholars under RA 10173 (the Data
Privacy Act). The technical mechanisms — access restriction, audit logging,
encrypted backups, scheduled deletion, a published notice with consent at collection —
are built and tested. **The organizational side is not finished**: no Data Protection
Officer is designated, no data processing agreement is executed with any processor,
and the National Privacy Commission has not been notified of this processing.

**The system must not be used to collect real applicant data until that is resolved.**
See [`docs/issues/2026-09-06-ra10173-organizational-gaps.md`](docs/issues/2026-09-06-ra10173-organizational-gaps.md)
for the full accounting — what is built (Table 1) versus what is still owed (Table 2)
— and [`docs/privacy/DPA_REGISTER.md`](docs/privacy/DPA_REGISTER.md) for the
processor-by-processor status. This project does not claim RA 10173 compliance, and no
document in this repository should.

## Two things that save the most time

1. **Schema is never clicked into the Supabase dashboard.** Every schema and
   RLS change is a `.sql` file in `supabase/migrations/`, committed, applied
   by CI on merge to `main`. Dashboard drift is how a student-run project
   permanently loses its schema history.
2. **If a query returns an empty set with no error, that is Row Level
   Security, not a bug.** Read the "If your query returns nothing, read
   this first" section of [ARCHITECTURE.md](ARCHITECTURE.md) §9 before
   debugging further.
