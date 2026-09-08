// ─────────────────────────────────────────────────────────────────────────────
// The campaign composer (PRD US-G1, US-G2, US-G3; SRS "Email Sending" / "Form Sending").
//
// One screen: pick a template, write the message — either in the Telegram-style markdown
// subset or by pasting a designed template exported from an email builder (ADR 0014) —
// with a live rendered preview, choose the audience on the five PRD axes, watch the live
// recipient count, save the draft.
//
// THE TWO BODY TABS ARE PREVIEWED DIFFERENTLY, ON PURPOSE. Markdown is escaped before it
// is rendered, so the preview below is our own HTML and is safe to inject inline. A
// pasted template is not ours: it is sent to `previewHtmlBodyAction`, sanitised by the
// SAME server-side allowlist that runs before it is stored, and shown in a sandboxed
// iframe. What the CCDO sees in that frame is exactly what will be saved, so anything
// the allowlist stripped is visibly gone before they commit to it. The count comes from `previewAudienceAction`, which
// calls the SAME `resolve_recipients()` the send freezes from — so the number shown here
// is the number the send uses (PRD US-G2), by construction rather than by care.
//
// ⚠ NOTHING HERE IS AN ENFORCEMENT. The action re-parses the same zod schema and RLS
// refuses anyone outside crrd_admin / exec_admin regardless of what this renders.
//
// NO ADDRESSES. The preview returns names and a count; an email address leaves the
// database only as a frozen recipient row at send time, and only to the sending tier.
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { AudiencePicker } from "@/components/campaigns/audience-picker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  createCampaign,
  previewAudienceAction,
  previewHtmlBodyAction,
} from "@/lib/campaigns/actions";
import { markdownToHtml } from "@/lib/campaigns/markdown";
import { MERGE_FIELDS, mergeHtml, mergeText, type MergePayload } from "@/lib/campaigns/merge";
import {
  AUDIENCE_STATUSES,
  DAILY_SEND_WARNING_THRESHOLD,
  HTML_BODY_MAX_BYTES,
  ISLAND_GROUPS,
  MARKDOWN_BODY_MAX_CHARS,
  YEAR_LEVELS,
  type AudienceFilter,
  type BodyFormat,
} from "@/lib/campaigns/schema";
import {
  TEMPLATE_KEYS,
  TEMPLATES,
  templateFormUrl,
  type TemplateKey,
} from "@/lib/campaigns/templates";
import type { AudienceOptions, AudiencePreview } from "@/lib/campaigns/types";

export type CampaignComposerProps = {
  options: AudienceOptions;
  /** The site origin (no trailing slash) the form links are resolved against. */
  origin: string;
};

type AudienceStatus = (typeof AUDIENCE_STATUSES)[number];
type IslandGroup = (typeof ISLAND_GROUPS)[number];

const STATUS_LABELS: Record<AudienceStatus, string> = {
  active: "Active",
  renewal_pending: "Renewal pending",
  graduated: "Graduated",
  resigned: "Resigned",
  left: "Left",
  terminated: "Terminated",
};

/** What the rendered preview substitutes for each token. Fictional, obviously. */
const SAMPLE_MERGE: MergePayload = {
  given_name: "Juan",
  family_name: "Dela Cruz",
  member_id: "2024-0001",
  join_year: 2024,
  region_name: "National Capital Region",
  island_group: "Luzon",
  term_label: "2026-2027",
  year_level: 3,
  committee_name: "Membership Committee",
  department_name: "Community & Regional Relations Department",
};

const EMPTY_AUDIENCE: AudienceFilter = {
  join_years: [],
  region_ids: [],
  island_groups: [],
  statuses: ["active"],
  affiliation_ids: [],
  role_codes: [],
  department_ids: [],
  committee_ids: [],
  university_ids: [],
  year_levels: [],
  select_all: true,
  person_ids: [],
  excluded_person_ids: [],
};

function isAudienceStatus(value: string): value is AudienceStatus {
  return (AUDIENCE_STATUSES as readonly string[]).includes(value);
}

function toggled<T>(list: readonly T[], value: T, on: boolean): T[] {
  const without = list.filter((item) => item !== value);
  return on ? [...without, value] : without;
}

export function CampaignComposer({ options, origin }: CampaignComposerProps) {
  const router = useRouter();
  const [templateKey, setTemplateKey] = useState<TemplateKey>("freeform");
  const [subject, setSubject] = useState<string>(TEMPLATES.freeform.subject);
  // Two independent drafts, so switching tabs to look at the other one never destroys work.
  const [bodyFormat, setBodyFormat] = useState<BodyFormat>("markdown");
  const [markdownBody, setMarkdownBody] = useState<string>(TEMPLATES.freeform.body(null));
  const [htmlBody, setHtmlBody] = useState<string>("");
  const [htmlPreview, setHtmlPreview] = useState<{ html: string; bytes: number } | null>(null);
  const [htmlError, setHtmlError] = useState<string | null>(null);
  const [htmlPending, setHtmlPending] = useState(false);
  const [audience, setAudience] = useState<AudienceFilter>(EMPTY_AUDIENCE);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const body = bodyFormat === "html" ? htmlBody : markdownBody;

  // The live count, debounced. Every change to the audience re-resolves it server-side.
  useEffect(() => {
    let cancelled = false;
    setPreviewPending(true);
    const handle = setTimeout(() => {
      void previewAudienceAction(audience).then((result) => {
        if (cancelled) return;
        setPreviewPending(false);
        if (result.ok) {
          setPreview(result.data);
          setPreviewError(null);
        } else {
          setPreview(null);
          setPreviewError(result.error.message);
        }
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [audience]);

  // The rendered preview, merged with sample values so an unknown token shows up as an
  // error HERE, before anything is saved — never as a literal `{{frist_name}}` in a mailbox.
  const rendered = useMemo(() => {
    const source = bodyFormat === "html" ? (htmlPreview?.html ?? "") : markdownToHtml(markdownBody);
    try {
      return {
        subject: mergeText(subject, SAMPLE_MERGE),
        html: mergeHtml(source, SAMPLE_MERGE),
        error: null as string | null,
      };
    } catch (caught) {
      return { subject, html: source, error: (caught as Error).message };
    }
  }, [subject, bodyFormat, markdownBody, htmlPreview]);

  // The pasted body goes to the server to be sanitised — see the header note. Debounced,
  // and skipped entirely while the markdown tab is open so a stale paste costs nothing.
  useEffect(() => {
    if (bodyFormat !== "html") return;
    if (htmlBody.trim() === "") {
      setHtmlPreview(null);
      setHtmlError(null);
      return;
    }
    let cancelled = false;
    setHtmlPending(true);
    const handle = setTimeout(() => {
      void previewHtmlBodyAction({ body_html: htmlBody }).then((result) => {
        if (cancelled) return;
        setHtmlPending(false);
        if (result.ok) {
          setHtmlPreview(result.data);
          setHtmlError(null);
        } else {
          setHtmlPreview(null);
          setHtmlError(result.error.message);
        }
      });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [bodyFormat, htmlBody]);

  const applyTemplate = (key: TemplateKey) => {
    const template = TEMPLATES[key];
    setTemplateKey(key);
    setSubject(template.subject);
    // The four templates are written in markdown, so choosing one moves to that tab. The
    // pasted draft is kept, not cleared — switching back finds it where it was left.
    setMarkdownBody(template.body(templateFormUrl(template, origin)));
    setBodyFormat("markdown");
    setAudience((current) => ({
      ...current,
      statuses: template.defaultStatuses.filter(isAudienceStatus),
    }));
  };

  const submit = () => {
    setMessage(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await createCampaign({
        template_key: templateKey,
        subject,
        body_format: bodyFormat,
        body_markdown: body,
        audience,
      });
      if (result.ok) {
        router.push(`/campaigns/${result.data.id}`);
        return;
      }
      // Server field errors go under their input, never into a generic toast (CONVENTIONS §6).
      setFieldErrors(result.error.fields ?? {});
      setMessage(result.error.message);
    });
  };

  const regionsByIsland = useMemo(() => {
    const groups = new Map<string, AudienceOptions["regions"]>();
    for (const region of options.regions) {
      const list = groups.get(region.island_group) ?? [];
      list.push(region);
      groups.set(region.island_group, list);
    }
    return groups;
  }, [options.regions]);

  const audienceErrors = Object.entries(fieldErrors)
    .filter(([key]) => key.startsWith("audience"))
    .flatMap(([, messages]) => messages);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-6">
        {/* ── template ── */}
        <section className="space-y-2">
          <label htmlFor="template_key" className="text-sm font-medium">
            Template
          </label>
          <select
            id="template_key"
            name="template_key"
            value={templateKey}
            onChange={(event) => applyTemplate(event.target.value as TemplateKey)}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            {TEMPLATE_KEYS.map((key) => (
              <option key={key} value={key}>
                {TEMPLATES[key].label}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">
            Choosing a template replaces the subject and message with its starting text. The three
            form templates carry the link to the public form for this site.
          </p>
        </section>

        {/* ── subject ── */}
        <section className="space-y-2">
          <label htmlFor="subject" className="text-sm font-medium">
            Subject
          </label>
          <input
            id="subject"
            name="subject"
            type="text"
            maxLength={200}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
          <FieldErrors messages={fieldErrors["subject"]} />
        </section>

        {/* ── body ── */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="body_markdown" className="text-sm font-medium">
              Message
            </label>
            <div className="flex gap-1 rounded-md border p-0.5" role="tablist" aria-label="Format">
              {(
                [
                  ["markdown", "Write it here"],
                  ["html", "Paste a design"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={bodyFormat === value}
                  data-testid={`body-format-${value}`}
                  onClick={() => setBodyFormat(value)}
                  className={
                    bodyFormat === value
                      ? "bg-primary text-primary-foreground rounded px-3 py-1 text-xs font-medium"
                      : "text-muted-foreground hover:text-foreground rounded px-3 py-1 text-xs"
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {bodyFormat === "markdown" ? (
            <>
              <Textarea
                id="body_markdown"
                name="body_markdown"
                rows={16}
                value={markdownBody}
                onChange={(event) => setMarkdownBody(event.target.value)}
                className="font-mono text-sm"
              />
              <FieldErrors messages={fieldErrors["body_markdown"]} />
              <p className="text-muted-foreground text-xs">
                Formatting: <code>**bold**</code>, <code>__underline__</code>, <code>_italic_</code>
                , <code>~~strike~~</code>, <code>`code`</code>, <code>[label](https://link)</code>,{" "}
                <code>![alt](https://image)</code>, lines starting with <code>- </code> or{" "}
                <code>1. </code> for a list, <code>&gt; </code> for a quote, <code>#</code> to{" "}
                <code>###</code> for a heading, <code>---</code> for a divider, a blank line for a
                new paragraph. Up to {MARKDOWN_BODY_MAX_CHARS.toLocaleString("en")} characters.
              </p>
            </>
          ) : (
            <>
              <Textarea
                id="body_markdown"
                name="body_markdown"
                rows={16}
                value={htmlBody}
                onChange={(event) => setHtmlBody(event.target.value)}
                placeholder="Paste the HTML your email builder exports…"
                className="font-mono text-xs"
                data-testid="body-html-input"
              />
              <FieldErrors messages={fieldErrors["body_markdown"]} />
              {htmlError === null ? null : (
                <p role="alert" className="text-destructive text-sm" data-testid="html-body-error">
                  {htmlError}
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                Paste the HTML from your email builder — the same code you would paste into Gmail.
                It is checked on the server before it is saved: anything that could run code, load a
                page, or reach a non-secure address is removed, and the preview shows you what
                survived. Up to {Math.round(HTML_BODY_MAX_BYTES / 1024)} KB
                {htmlPreview === null
                  ? ""
                  : ` — this one is ${Math.max(1, Math.round(htmlPreview.bytes / 1024))} KB`}
                .
              </p>
              <p className="text-muted-foreground text-xs">
                Two things are dropped that a builder may include: <code>&lt;style&gt;</code> blocks
                (phone-only layout tweaks — a design that relies on them shows its desktop layout on
                a phone, scaled to fit) and images that are not on an <code>https</code> address.
                Host images where your builder puts them and paste the link it gives you.
              </p>
            </>
          )}
          <p className="text-muted-foreground text-xs">
            Merge fields:{" "}
            {MERGE_FIELDS.map((field, index) => (
              <span key={field}>
                {index > 0 ? ", " : null}
                <code>{`{{${field}}}`}</code>
              </span>
            ))}
            . Nothing else can be merged — a birthdate or a phone number is not on the list, on
            purpose.
          </p>
        </section>

        {/* ── audience ── */}
        <section className="space-y-4 rounded-lg border p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Recipients</h2>
            <p className="text-sm" aria-live="polite" data-testid="audience-count">
              {previewError !== null
                ? previewError
                : preview === null || previewPending
                  ? "Counting…"
                  : `This will reach ${preview.count} ${preview.count === 1 ? "person" : "people"}.`}
            </p>
          </div>
          <p className="text-muted-foreground text-xs">
            Every filter is &ldquo;any of&rdquo;; leaving one empty means it does not narrow. Only
            scholars with an email on file for the current term are counted.
          </p>

          {preview !== null && preview.count > DAILY_SEND_WARNING_THRESHOLD ? (
            <p
              role="status"
              data-testid="daily-limit-warning"
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              Gmail sends about 500 messages a day. A list this size takes more than one day; the
              send pauses and resumes on its own.
            </p>
          ) : null}

          <CheckboxGroup
            legend="Membership status"
            items={AUDIENCE_STATUSES.map((status) => ({
              value: status,
              label: STATUS_LABELS[status],
            }))}
            selected={audience.statuses}
            onToggle={(value, on) =>
              setAudience((current) => ({
                ...current,
                statuses: toggled(current.statuses, value, on),
              }))
            }
          />

          {options.joinYears.length > 0 ? (
            <CheckboxGroup
              legend="Year of membership"
              items={options.joinYears.map((year) => ({ value: year, label: String(year) }))}
              selected={audience.join_years}
              onToggle={(value, on) =>
                setAudience((current) => ({
                  ...current,
                  join_years: toggled(current.join_years, value, on),
                }))
              }
            />
          ) : null}

          <CheckboxGroup
            legend="Island group"
            items={ISLAND_GROUPS.map((group) => ({ value: group, label: group }))}
            selected={audience.island_groups}
            onToggle={(value: IslandGroup, on) =>
              setAudience((current) => ({
                ...current,
                island_groups: toggled(current.island_groups, value, on),
              }))
            }
          />

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Region</legend>
            {[...regionsByIsland.entries()].map(([island, regions]) => (
              <div key={island} className="space-y-1">
                <p className="text-muted-foreground text-xs">{island}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {regions.map((region) => (
                    <label key={region.id} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={audience.region_ids.includes(region.id)}
                        onChange={(event) =>
                          setAudience((current) => ({
                            ...current,
                            region_ids: toggled(
                              current.region_ids,
                              region.id,
                              event.target.checked,
                            ),
                          }))
                        }
                      />
                      {region.name}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>

          {options.positions.length > 0 ? (
            <CheckboxGroup
              legend="Role held this term"
              items={options.positions.map((position) => ({
                value: position.code,
                label: position.title,
              }))}
              selected={audience.role_codes}
              onToggle={(value, on) =>
                setAudience((current) => ({
                  ...current,
                  role_codes: toggled(current.role_codes, value, on),
                }))
              }
            />
          ) : null}

          {options.affiliations.length > 0 ? (
            <CheckboxGroup
              legend="Affiliation"
              items={options.affiliations.map((affiliation) => ({
                value: affiliation.id,
                label: affiliation.name,
              }))}
              selected={audience.affiliation_ids}
              onToggle={(value, on) =>
                setAudience((current) => ({
                  ...current,
                  affiliation_ids: toggled(current.affiliation_ids, value, on),
                }))
              }
            />
          ) : (
            <p className="text-muted-foreground text-xs">
              No affiliations are recorded yet. A partnership (e.g. START x DataCamp) is a row a
              CRRD Admin adds, never a code change.
            </p>
          )}

          {options.departments.length > 0 ? (
            <CheckboxGroup
              legend="Department"
              items={options.departments.map((department) => ({
                value: department.id,
                label: department.name,
              }))}
              selected={audience.department_ids}
              onToggle={(value, on) =>
                setAudience((current) => ({
                  ...current,
                  department_ids: toggled(current.department_ids, value, on),
                }))
              }
            />
          ) : null}

          {options.committees.length > 0 ? (
            <CheckboxGroup
              legend="Committee"
              items={options.committees.map((committee) => ({
                value: committee.id,
                label: committee.name,
              }))}
              selected={audience.committee_ids}
              onToggle={(value, on) =>
                setAudience((current) => ({
                  ...current,
                  committee_ids: toggled(current.committee_ids, value, on),
                }))
              }
            />
          ) : null}

          {options.universities.length > 0 ? (
            <CheckboxGroup
              legend="University"
              items={options.universities.map((university) => ({
                value: university.id,
                label: university.name,
              }))}
              selected={audience.university_ids}
              onToggle={(value, on) =>
                setAudience((current) => ({
                  ...current,
                  university_ids: toggled(current.university_ids, value, on),
                }))
              }
            />
          ) : null}

          <CheckboxGroup
            legend="Year level"
            items={YEAR_LEVELS.map((level): { value: number; label: string } => ({
              value: level,
              label: String(level),
            }))}
            selected={audience.year_levels}
            onToggle={(value, on) =>
              setAudience((current) => ({
                ...current,
                year_levels: toggled(current.year_levels, value, on),
              }))
            }
          />

          <FieldErrors messages={audienceErrors} />

          {preview !== null && preview.sample.length > 0 ? (
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">Sample of who this reaches:</p>
              <ul className="text-sm">
                {preview.sample.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-semibold">Pick people individually</h3>
            <p className="text-muted-foreground text-xs">
              Search finds anyone the filters above match. Untick someone to drop them from the
              send; tick someone to add them even if a filter above would otherwise exclude them.
            </p>
            <AudiencePicker audience={audience} onChange={setAudience} />
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={submit}
            disabled={
              pending ||
              rendered.error !== null ||
              (bodyFormat === "html" && (htmlError !== null || htmlPreview === null))
            }
          >
            Save draft
          </Button>
          <p className="text-muted-foreground text-xs">
            Saving does not send. The draft opens on its own page, where the recipient list is
            frozen and the send is started — and watched — from there.
          </p>
        </div>
        {message === null ? null : (
          <p role="alert" className="text-sm">
            {message}
          </p>
        )}
      </div>

      {/* ── live preview ── */}
      <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
        <h2 className="text-base font-semibold">Preview</h2>
        <p className="text-muted-foreground text-xs">
          Rendered as a recipient sees it, with sample values in place of the merge fields.
        </p>
        {rendered.error === null ? null : (
          <p role="alert" className="text-destructive text-sm" data-testid="merge-token-error">
            {rendered.error}
          </p>
        )}
        <div className="rounded-lg border">
          <div className="border-b px-4 py-2 text-sm">
            <span className="text-muted-foreground">Subject: </span>
            <span className="font-medium">{rendered.subject || "(no subject)"}</span>
          </div>
          {bodyFormat === "markdown" ? (
            /* The renderer escapes the input FIRST and emits only its own tags
               (lib/campaigns/markdown.ts), so this is our HTML, not the CRRD's. */
            <div
              className="prose prose-sm max-w-none px-4 py-3 text-sm"
              data-testid="campaign-preview"
              dangerouslySetInnerHTML={{ __html: rendered.html }}
            />
          ) : (
            /* A pasted template is NOT ours, so it is never injected into this page.
               `rendered.html` here is what the server-side allowlist returned, shown in a
               sandboxed frame — no scripts, no forms, no navigation, same as the campaign
               page's frame. */
            <iframe
              title="Rendered message"
              srcDoc={rendered.html}
              sandbox=""
              className="h-[32rem] w-full rounded-b-lg bg-white"
              data-testid="campaign-preview-frame"
            />
          )}
        </div>
        {bodyFormat === "html" && htmlPending ? (
          <p className="text-muted-foreground text-xs">Checking the pasted HTML…</p>
        ) : null}
      </aside>
    </div>
  );
}

function CheckboxGroup<T extends string | number>({
  legend,
  items,
  selected,
  onToggle,
}: {
  legend: string;
  items: ReadonlyArray<{ value: T; label: string }>;
  selected: readonly T[];
  onToggle: (value: T, on: boolean) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {items.map((item) => (
          <label key={String(item.value)} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(item.value)}
              onChange={(event) => onToggle(item.value, event.target.checked)}
            />
            {item.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function FieldErrors({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return (
    <p role="alert" className="text-destructive text-sm">
      {messages.join(" ")}
    </p>
  );
}
