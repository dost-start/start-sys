#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# RESTORE DRILL — BUILD_PLAN S7-T16; PRD item 17, US-J4; ARCHITECTURE.md §8, §11.
#
# US-J4's acceptance criterion is not "backups are configured". It is:
#
#     "A restore has actually been performed and recorded, not merely configured.
#      An untested backup does not count."
#
# So this script exists to be RUN, quarterly, BY SOMEONE WHO DID NOT WRITE IT, following
# only docs/runbooks/02-RESTORE_FROM_BACKUP.md — and the result is written into that
# runbook's Drill record table. An unrecorded drill is indistinguishable from one that
# never happened.
#
# It restores a nightly age-encrypted B2 dump into a THROWAWAY Docker Postgres 17 and
# prints five PASS/FAIL lines. It never touches production, never touches Supabase, and
# never needs a network credential beyond reading the object you already downloaded.
#
# ── THE FIVE ASSERTIONS, AND WHY EACH ONE ────────────────────────────────────
#   1. 18 regions            reference data survived. 18, not 17: RA 12000 (2024) created
#                            the Negros Island Region (DATA_MODEL.md §6/0016).
#   2. 4 administrators      the constitutional invariant — CEO, COO, CTO, CCDO and
#                            nobody else (CBL Art. III §2; the `admin_is_c_suite` CHECK).
#   3. people > 0            the actual member records are there. A dump taken by a role
#                            subject to FORCE ROW LEVEL SECURITY restores an EMPTY
#                            database that looks structurally perfect.
#   4. pg_policies > 0       ⚠️ THE ONE NOBODY THINKS TO CHECK. A dump that restored the
#                            DATA but not the POLICIES restores an OPEN DATABASE: every
#                            scholar's birthdate, address and school ID present, with no
#                            RLS in front of any of it. It would pass assertions 1–3.
#   5. RLS enabled+forced    every table in `public` carries BOTH flags. ENABLE alone is
#                            not enough: a table owner bypasses non-forced RLS, and the
#                            migration role IS the owner (supabase/tests/001).
#
# Then, if the Supabase CLI is available, the full pgTAP suite is re-run against the
# restored database — the strongest available statement that what came back is the
# system and not merely its bytes.
#
# ── USAGE ────────────────────────────────────────────────────────────────────
#   scripts/restore-drill.sh <encrypted-dump> <age-identity-file>
#
#   <encrypted-dump>      the .sql.age you downloaded from B2, e.g.
#                         backup/startsys-2026-09-06.sql.age
#   <age-identity-file>   the PRIVATE age key. Offline, held by the CTO, escrowed with
#                         the faculty adviser (keys/backup.age.pub holds only the public
#                         half). NEVER commit it; the repo ignores *.pem and .env*, so
#                         keep it outside the working tree entirely.
#
# Requires: docker, age, psql. Optional: the supabase CLI, for the pgTAP re-run.
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

CONTAINER="startsys-restore-drill"
PGPORT="${RESTORE_DRILL_PORT:-55433}"
PGPASSWORD_LOCAL="drill"           # throwaway container, throwaway password, no network
DB="startsys_restore"

pass_count=0
fail_count=0

say()  { printf '%s\n' "$*"; }
rule() { printf '%s\n' "────────────────────────────────────────────────────────────"; }

pass() { pass_count=$((pass_count + 1)); say "PASS  $*"; }
fail() { fail_count=$((fail_count + 1)); say "FAIL  $*"; }

usage() {
  say "usage: $0 <encrypted-dump.sql.age> <age-identity-file>"
  say ""
  say "See docs/runbooks/02-RESTORE_FROM_BACKUP.md. Run this quarterly, and record the"
  say "result in that runbook's Drill record table — including the operator's name."
  exit 2
}

[ "$#" -eq 2 ] || usage

ENCRYPTED="$1"
IDENTITY="$2"

[ -f "$ENCRYPTED" ] || { say "No such dump: $ENCRYPTED"; exit 2; }
[ -f "$IDENTITY" ]  || { say "No such age identity file: $IDENTITY"; exit 2; }

for tool in docker age psql; do
  command -v "$tool" >/dev/null 2>&1 || { say "Required tool not found: $tool"; exit 2; }
done

# The decrypted dump is 600 scholars' PII in plaintext. It lives in a private temp
# directory for the length of this script and is removed on EVERY exit path, including
# Ctrl-C and an assertion failure — a drill that leaves PII on the operator's laptop has
# created the incident it was rehearsing for.
WORKDIR="$(mktemp -d)"
chmod 700 "$WORKDIR"

cleanup() {
  status=$?
  rm -rf "$WORKDIR"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT INT TERM

PLAIN="${WORKDIR}/restore.sql"

rule
say "START-SYS restore drill"
say "  dump:      ${ENCRYPTED}"
say "  started:   $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
rule

# ── 1. Decrypt ───────────────────────────────────────────────────────────────
say "Decrypting with the offline age identity..."
age --decrypt --identity "$IDENTITY" --output "$PLAIN" "$ENCRYPTED"
say "  plaintext SQL: $(wc -c < "$PLAIN") bytes"

# ── 2. A throwaway Postgres 17 ───────────────────────────────────────────────
# Postgres 17 to match production exactly (ARCHITECTURE.md §1). Restoring into a
# different major version would prove something about a database we do not run.
say "Starting a throwaway postgres:17 container on port ${PGPORT}..."
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  -e "POSTGRES_PASSWORD=${PGPASSWORD_LOCAL}" \
  -e "POSTGRES_DB=${DB}" \
  -p "127.0.0.1:${PGPORT}:5432" \
  postgres:17 >/dev/null

export PGPASSWORD="$PGPASSWORD_LOCAL"
CONN="postgresql://postgres@127.0.0.1:${PGPORT}/${DB}"

printf '%s' "Waiting for the container to accept connections"
for _ in $(seq 1 60); do
  if psql "$CONN" -c 'select 1' >/dev/null 2>&1; then break; fi
  printf '.'
  sleep 1
done
printf '\n'
psql "$CONN" -c 'select 1' >/dev/null

# ── 3. Load ──────────────────────────────────────────────────────────────────
# A Supabase dump references roles (anon, authenticated, service_role, supabase_admin)
# that a stock postgres:17 does not have. Creating them is part of restoring the system,
# not a workaround: the RLS policies name them, and assertion 4 is about those policies
# existing. Without the roles the policy statements would error and the drill would
# report a false failure.
say "Creating the Supabase roles a stock Postgres does not ship with..."
psql "$CONN" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$
declare r text;
begin
  foreach r in array array[
    'anon','authenticated','service_role','supabase_admin','supabase_auth_admin',
    'supabase_storage_admin','authenticator','dashboard_user','pgbouncer'
  ] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin noinherit', r);
    end if;
  end loop;
end $$;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
SQL

say "Loading the dump (errors are collected, not fatal — see the note below)..."
# NOT ON_ERROR_STOP: a Supabase dump carries statements about managed objects (the auth
# schema's own tables, extension owners) that a stock container legitimately cannot
# replay. The drill's verdict is the FIVE ASSERTIONS below, not psql's exit code — but
# the error count is printed, because a sudden jump in it is a signal worth reading.
load_log="${WORKDIR}/load.log"
psql "$CONN" -f "$PLAIN" >"$load_log" 2>&1 || true
errors=$(grep -c '^ERROR:' "$load_log" || true)
say "  load complete; ${errors} statement error(s) (see ${WORKDIR}/load.log during this run)"

# ── 4. The five assertions ───────────────────────────────────────────────────
q() { psql "$CONN" -tA -c "$1" 2>/dev/null || echo "QUERY_FAILED"; }

rule
say "ASSERTIONS"
rule

# 1 — reference data
regions=$(q "select count(*) from public.regions")
if [ "$regions" = "18" ]; then
  pass "1. regions = 18 (RA 12000 incl. Negros Island Region)"
else
  fail "1. regions = ${regions}, expected 18 — reference data did not survive the restore"
fi

# 2 — the constitutional invariant
admins=$(q "select count(*) from public.officer_positions where is_administrator")
admin_codes=$(q "select string_agg(code, ',' order by code) from public.officer_positions where is_administrator")
if [ "$admins" = "4" ] && [ "$admin_codes" = "CCDO,CEO,COO,CTO" ]; then
  pass "2. administrators = 4 and are exactly CEO, COO, CTO, CCDO (CBL Art. III §2)"
else
  fail "2. administrators = ${admins} (${admin_codes}), expected 4: CEO, COO, CTO, CCDO"
fi

# 3 — the member records themselves
people=$(q "select count(*) from public.people")
if [ "$people" != "QUERY_FAILED" ] && [ "$people" -gt 0 ] 2>/dev/null; then
  pass "3. people = ${people} (> 0) — member records restored"
else
  fail "3. people = ${people}, expected > 0 — a dump taken under FORCE RLS restores an EMPTY database that looks perfect"
fi

# 4 — THE ONE NOBODY CHECKS
policies=$(q "select count(*) from pg_policies where schemaname = 'public'")
if [ "$policies" != "QUERY_FAILED" ] && [ "$policies" -gt 0 ] 2>/dev/null; then
  pass "4. RLS policies on public = ${policies} (> 0) — the restored database is not open"
else
  fail "4. RLS policies on public = ${policies}. A restore with the DATA but not the POLICIES is an OPEN database holding every scholar's PII — and it passes assertions 1-3."
fi

# 5 — enabled AND forced, on every table
unprotected=$(q "
  select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not (c.relrowsecurity and c.relforcerowsecurity)
")
if [ -z "$unprotected" ]; then
  pass "5. every public table has RLS ENABLED and FORCED"
else
  fail "5. tables missing ENABLE and/or FORCE RLS: ${unprotected}"
fi

# ── 5. Optional: the whole executable specification ──────────────────────────
# The strongest statement available about a restored database: not "the rows came back"
# but "the authorization model came back". Optional because the drill's five assertions
# are the runbook's contract and a laptop without the CLI must still be able to run it.
rule
if command -v supabase >/dev/null 2>&1; then
  say "Re-running the pgTAP suite against the RESTORED database..."
  if supabase test db --db-url "$CONN"; then
    pass "6. (bonus) the full pgTAP RLS suite is green against the restored database"
  else
    fail "6. (bonus) the pgTAP suite FAILED against the restored database — the rows came back but the authorization model did not"
  fi
else
  say "SKIP  6. (bonus) pgTAP re-run — the supabase CLI is not on PATH."
  say "      Not a failure; note it in the Drill record."
fi

# ── Verdict ──────────────────────────────────────────────────────────────────
rule
say "RESULT: ${pass_count} passed, ${fail_count} failed"
say "finished: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
say ""
say "Record this run in docs/runbooks/02-RESTORE_FROM_BACKUP.md — date, YOUR name, the"
say "object restored, elapsed time, and this output. An unrecorded drill is"
say "indistinguishable from one that never happened (PRD US-J4, US-K1)."
rule

[ "$fail_count" -eq 0 ]
