// Segment-scoped 404 for `/members/[id]` (BUILD_PLAN S5-T26; CONVENTIONS.md §4.3).
//
// Reached by `notFound()` in page.tsx for every denial EXCEPT a missing CBL Art.
// VIII §7.1 acknowledgement (which renders its own actionable panel instead). This
// text is deliberately generic: it must read the same whether the id is malformed,
// the person does not exist, or the caller's tier simply cannot see them — "forbidden"
// would itself disclose that a named scholar has a record.
import { MEMBERS_PATH } from "@/lib/members/filters";

export default function MemberNotFound() {
  return (
    <div className="space-y-3 py-12 text-center">
      <h1 className="text-lg font-semibold">Member not found</h1>
      <p className="text-sm text-muted-foreground">That record could not be found.</p>
      <a href={MEMBERS_PATH} className="text-sm underline underline-offset-2">
        Back to members
      </a>
    </div>
  );
}
