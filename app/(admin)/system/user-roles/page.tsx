import { InviteUserDialog } from "@/components/auth/invite-user-dialog";
import {
  UserRolesTable,
  type RegionOption,
  type UserRoleRow,
} from "@/components/auth/user-roles-table";
import { getSessionContext } from "@/lib/auth/queries";
import type { OrgRole } from "@/lib/auth/route-access";

// ─────────────────────────────────────────────────────────────────────────────
// `/system/user-roles` — the tech_admin role-management screen (BUILD_PLAN
// S2-T40, US-E3). Without this screen nobody can be given a role at all and
// every later slice is blocked on manual SQL.
//
// Reads through the CALLER's client (`ctx.supabase`), so the visibility here is
// exactly what the `user_roles_read` RLS policy grants (self-read + exec/tech
// read-all) — this page adds no scoping of its own. `auth.users.email` is NOT
// selected: PostgREST cannot read `auth.users` and there is no column-level
// GRANT for it here, so accounts are identified by `user_id` — a documented
// limitation, not an oversight (see the note on the page itself).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function UserRolesPage() {
  const ctx = await getSessionContext();
  if (ctx === null) {
    // Unreachable in practice — the layout above already redirects — but this
    // keeps the page self-contained if it is ever rendered outside that tree.
    return null;
  }

  const [{ data: roleRows }, { data: regionRows }, { data: personRows }] = await Promise.all([
    ctx.supabase
      .from("user_roles")
      .select("user_id, role, person_id, region_id")
      .order("role", { ascending: true }),
    ctx.supabase.from("regions").select("id, code, name").order("sort_order", { ascending: true }),
    ctx.supabase.from("people").select("id, given_name, family_name, member_id"),
  ]);

  const regions: RegionOption[] = (regionRows ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
  }));

  const regionById = new Map(regions.map((r) => [r.id, r]));
  const personById = new Map((personRows ?? []).map((p) => [p.id, p]));

  const rows: UserRoleRow[] = (roleRows ?? []).map((row) => {
    const person = row.person_id ? (personById.get(row.person_id) ?? null) : null;
    const region = row.region_id ? (regionById.get(row.region_id) ?? null) : null;

    const personLabel = person
      ? `${person.given_name} ${person.family_name}${
          person.member_id ? ` (${person.member_id})` : ""
        }`
      : null;

    return {
      userId: row.user_id,
      role: row.role as OrgRole,
      personId: row.person_id,
      regionId: row.region_id,
      regionLabel: region ? `${region.name} (${region.code})` : null,
      personLabel,
    };
  });

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">User roles</h1>
          <p className="text-muted-foreground max-w-xl text-sm">
            Public signup is disabled (PRD MVP item 1) — accounts exist only by invitation.
            Assigning or revoking a role here takes effect on that account&apos;s next request
            (US-E3); nothing here silently confirms which of &quot;no account&quot; or &quot;no
            role&quot; produced an empty result.
          </p>
        </div>
        <InviteUserDialog regions={regions} />
      </header>

      <UserRolesTable rows={rows} regions={regions} />

      <p className="text-muted-foreground text-xs">
        Accounts are identified by their <code>auth.users.id</code> above, not by email — PostgREST
        has no read access to <code>auth.users</code>, and granting it would widen the service-role
        boundary this system is built to avoid (ARCHITECTURE.md §5).
      </p>
    </main>
  );
}
