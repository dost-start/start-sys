// ─────────────────────────────────────────────────────────────────────────────
// The three reviewed templates (ARCHITECTURE.md §4.2): the two form sends whose form
// actually exists — Membership Application (external), Membership Renewal — plus
// Freeform. A template is a starting subject + markdown body the CRRD edits in the
// composer; the form link is baked in at compose time from the site origin, so a stored
// campaign is self-contained and a later origin change cannot rewrite it.
//
// ⚠ EVERY `formPath` MUST BE A ROUTE THAT EXISTS AND IS PUBLIC. A template mails members
// a link they open from their inbox, so a path with no page behind it is not a 404 — it
// is a login wall, and members hold no accounts at all (SRS 2026-09-05). `templates.test.ts`
// checks each path against `ROUTE_GROUPS.public`, against `app/(public)/` on disk, and
// against middleware's matcher, so linking a template to an unbuilt form fails CI.
//
// Committee Application (PRD item 24 / US-G6) is deliberately absent for exactly that
// reason — see the note on `TEMPLATE_KEYS` below.
//
// Templates are code, and code-reviewed, because a template is the one place a merge
// field could leak someone else's data. Only `MERGE_FIELDS` tokens may appear.
// ─────────────────────────────────────────────────────────────────────────────

import type { Enums } from "@/database.types";

export type FormKind = Enums<"form_kind">;

/**
 * The templates the composer offers, and the only values `campaignComposeSchema` accepts.
 *
 * `committee_call` was here until 2026-09-11 and is REMOVED, not merely hidden from the
 * dropdown. It pre-filled a link to `/committee-apply`, a route that has never existed:
 * the committee form is v1.1 (PRD item 24 / US-G6) and `committee_applications` is
 * explicitly not modelled (DATA_MODEL §1.1). The failure was not a 404 — `/committee-apply`
 * is not in `ROUTE_GROUPS.public` and not excluded by middleware's matcher, so every
 * member who clicked it was redirected to `/login`, which members can never pass because
 * they hold no accounts (SRS 2026-09-05). Removing the KEY rather than the link also
 * narrows `z.enum(TEMPLATE_KEYS)`, so a hand-crafted compose POST naming it is refused
 * server-side, not just absent from the UI.
 *
 * Same reasoning as `WINDOW_FORM_KINDS` in `lib/applications/window-schema.ts`: a control
 * that sends members to a form nobody can submit is worse than no control, and a campaign
 * is the one artefact the org cannot recall once sent.
 *
 * Restore it in the PR that ships `app/(public)/committee-apply/page.tsx`, not before —
 * `templates.test.ts` fails while the route is missing.
 *
 * A campaign sent before the removal keeps `template_key = 'committee_call'` in the
 * database (0043 types the column plain `text`, with no CHECK). Both admin screens already
 * guard their label lookup with `isTemplateKey`, so such a row renders its raw key instead
 * of a label — cosmetic, and preferable to keeping a live option that mails a dead link.
 */
export const TEMPLATE_KEYS = [
  "membership_application_invite",
  "membership_renewal",
  "freeform",
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export type CampaignTemplate = {
  key: TemplateKey;
  label: string;
  formKind: FormKind;
  /** The public path the template links to, resolved against the site origin at compose. */
  formPath: string | null;
  subject: string;
  body: (formUrl: string | null) => string;
  /** The filter the template is normally sent with; the composer pre-selects it. */
  defaultStatuses: readonly string[];
};

export const TEMPLATES: Record<TemplateKey, CampaignTemplate> = {
  membership_application_invite: {
    key: "membership_application_invite",
    label: "Membership Application Form",
    formKind: "membership_application",
    formPath: "/apply",
    subject: "START-DOST membership applications are open",
    body: (url) =>
      [
        "Hello!",
        "",
        "START-DOST is now accepting membership applications from DOST scholars. If you are a current scholar and would like to be part of the organization, fill in the form below while the application period is open.",
        "",
        url
          ? `[Open the Membership Application Form](${url})`
          : "(the application link will appear here)",
        "",
        "Have your **latest registration form** and your **Notice of Award** ready — both are uploaded as part of the application.",
        "",
        "See you in the community,",
        "START-DOST CRRD",
      ].join("\n"),
    defaultStatuses: ["active"],
  },
  membership_renewal: {
    key: "membership_renewal",
    label: "Membership Renewal Form",
    formKind: "membership_renewal",
    formPath: "/renew",
    subject: "Renew your START-DOST membership for {{term_label}}",
    body: (url) =>
      [
        "Hi {{given_name}},",
        "",
        "A new term has started and your START-DOST membership is up for renewal. Your member ID stays **{{member_id}}** — renewing never changes it.",
        "",
        url ? `[Open the Membership Renewal Form](${url})` : "(the renewal link will appear here)",
        "",
        "You will need your member ID, your latest registration form and your Notice of Award.",
        "",
        "START-DOST CRRD",
      ].join("\n"),
    defaultStatuses: ["active"],
  },
  freeform: {
    key: "freeform",
    label: "Freeform message",
    formKind: "freeform",
    formPath: null,
    subject: "",
    body: () => "Hi {{given_name}},\n\n",
    defaultStatuses: ["active"],
  },
};

export function isTemplateKey(value: string): value is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(value);
}

/** Absolute form URL for a template, or null for freeform. `origin` has no trailing slash. */
export function templateFormUrl(template: CampaignTemplate, origin: string): string | null {
  return template.formPath ? `${origin}${template.formPath}` : null;
}
