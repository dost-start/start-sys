// ─────────────────────────────────────────────────────────────────────────────
// The four reviewed templates (ARCHITECTURE.md §4.2): the three form sends the SRS names
// — Membership Application (external), Committee Application (internal), Membership
// Renewal — plus Freeform. A template is a starting subject + markdown body the CRRD
// edits in the composer; the form link is baked in at compose time from the site origin,
// so a stored campaign is self-contained and a later origin change cannot rewrite it.
//
// Templates are code, and code-reviewed, because a template is the one place a merge
// field could leak someone else's data. Only `MERGE_FIELDS` tokens may appear.
// ─────────────────────────────────────────────────────────────────────────────

import type { Enums } from "@/database.types";

export type FormKind = Enums<"form_kind">;

export const TEMPLATE_KEYS = [
  "membership_application_invite",
  "committee_call",
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
  committee_call: {
    key: "committee_call",
    label: "Committee Application Form",
    formKind: "committee_application",
    formPath: "/committee-apply",
    subject: "Call for committee members — {{term_label}}",
    body: (url) =>
      [
        "Hi {{given_name}},",
        "",
        "START-DOST is opening committee applications for {{term_label}}. Committee members work under a department's Chief and Deputies; you may apply to up to three departments.",
        "",
        url
          ? `[Open the Committee Application Form](${url})`
          : "(the committee form link will appear here)",
        "",
        "Prepare your latest registration form, your latest grades and your Notice of Award for each department you apply to.",
        "",
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
