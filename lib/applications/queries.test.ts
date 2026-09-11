// Officer feedback 2026-09-11: a reviewer without a current-term confidentiality
// acknowledgement (CBL Art. VIII §7.1) saw a bare 404 on every application and renewal
// detail page. These pin the one refusal that is now named, and that every other refusal
// still reads exactly like a missing row (CONVENTIONS §4.3).
import { describe, expect, it, vi } from "vitest";

import type { ActionContext } from "@/lib/auth/with-role";

vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: vi.fn() }));

const {
  getApplicationDetail,
  isReviewAcknowledgementMissing,
  REVIEW_MISSING_ACKNOWLEDGEMENT_MESSAGE,
} = await import("@/lib/applications/queries");
const { getRenewalDetail } = await import("@/lib/applications/renewal-queries");

/** `assert_confidentiality_ack()`'s exception, transcribed from 0012 rather than imported. */
const ACK_REFUSAL = {
  code: "42501",
  message:
    "confidentiality acknowledgement for the current term is not on file for this account (CBL Art. VIII §7.1); an Executive Admin must record it before sensitive member data can be read",
};

function contextReturning(result: { data: unknown; error: unknown }): ActionContext {
  return { supabase: { rpc: vi.fn().mockResolvedValue(result) } } as unknown as ActionContext;
}

describe.each([
  {
    name: "getApplicationDetail",
    read: getApplicationDetail,
    tierRefusal: { code: "42501", message: "not authorized to read an application in full" },
  },
  {
    name: "getRenewalDetail",
    read: getRenewalDetail,
    tierRefusal: { code: "42501", message: "not authorized to read a renewal in full" },
  },
])("$name", ({ read, tierRefusal }) => {
  it("names a missing confidentiality acknowledgement instead of returning not_found", async () => {
    const result = await read(contextReturning({ data: null, error: ACK_REFUSAL }), "any-id");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isReviewAcknowledgementMissing(result.error)).toBe(true);
    expect(result.error.message).toBe(REVIEW_MISSING_ACKNOWLEDGEMENT_MESSAGE);
    // The database's own sentence never reaches the page.
    expect(result.error.message).not.toContain("sensitive member data");
  });

  it("keeps a wrong-tier refusal identical to a missing row", async () => {
    const refused = await read(contextReturning({ data: null, error: tierRefusal }), "any-id");
    const missing = await read(contextReturning({ data: null, error: null }), "any-id");
    expect(refused).toEqual(missing);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("not_found");
    expect(isReviewAcknowledgementMissing(refused.error)).toBe(false);
  });
});
