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
//
// Brand restyle (2026-09-08, docs/design/canvas/boards_admin.py `campaign_new`): the
// filter options are CHIPS — a pill <label> wrapping the same native checkbox, now
// screen-reader-only — so every id, value and label association is what it was.
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { AudiencePicker } from "@/components/campaigns/audience-picker";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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
import { cn } from "@/lib/utils";

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

/** The design canvas's `.chip` / `.chip.on`, driven by the wrapped checkbox's state. */
const CHIP_CLASS =
  "border-border bg-card text-brand-body inline-flex max-w-full min-h-8 cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-left text-[13px] transition-colors has-[:checked]:bg-brand-gradient has-[:checked]:border-transparent has-[:checked]:font-semibold has-[:checked]:text-brand-ink has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/25";

/** The design canvas's `.label`, for a fieldset legend (the Label primitive is for <label>). */
const LEGEND_CLASS = "text-brand-label mb-2 text-xs font-semibold tracking-[0.08em] uppercase";

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
    <div className="grid gap-7 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
      <div className="min-w-0 space-y-6">
        {/* ── template ── */}
        <Field>
          <FieldLabel htmlFor="template_key">Template</FieldLabel>
          <NativeSelect
            id="template_key"
            name="template_key"
            value={templateKey}
            onChange={(event) => applyTemplate(event.target.value as TemplateKey)}
          >
            {TEMPLATE_KEYS.map((key) => (
              <option key={key} value={key}>
                {TEMPLATES[key].label}
              </option>
            ))}
          </NativeSelect>
          <FieldHint>
            Choosing a template replaces the subject and message with its starting text. The two
            form templates carry the link to the public form for this site.
          </FieldHint>
        </Field>

        {/* ── subject ── */}
        <Field>
          <FieldLabel htmlFor="subject">Subject</FieldLabel>
          <Input
            id="subject"
            name="subject"
            type="text"
            maxLength={200}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
          <FieldErrors messages={fieldErrors["subject"]} />
        </Field>

        {/* ── body ── */}
        <Field>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FieldLabel htmlFor="body_markdown">Message</FieldLabel>
            {/* The design canvas's `.tabs`: a soft-grey rail, the active tab lifted to white. */}
            <div
              className="bg-brand-field flex gap-1 rounded-lg p-1"
              role="tablist"
              aria-label="Format"
            >
              {(
                [
                  ["markdown", "Write it here"],
                  ["html", "Paste a design"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  role="tab"
                  variant="ghost"
                  size="sm"
                  aria-selected={bodyFormat === value}
                  data-testid={`body-format-${value}`}
                  onClick={() => setBodyFormat(value)}
                  className={cn(
                    "h-8 rounded-md px-3.5 text-[13px]",
                    bodyFormat === value
                      ? "bg-card text-brand-ink font-semibold shadow-[0_2px_8px_rgb(23_23_23/0.08)] hover:bg-card hover:text-brand-ink"
                      : "",
                  )}
                >
                  {label}
                </Button>
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
              <FieldHint>
                Formatting: <code>**bold**</code>, <code>__underline__</code>, <code>_italic_</code>
                , <code>~~strike~~</code>, <code>`code`</code>, <code>[label](https://link)</code>,{" "}
                <code>![alt](https://image)</code>, lines starting with <code>- </code> or{" "}
                <code>1. </code> for a list, <code>&gt; </code> for a quote, <code>#</code> to{" "}
                <code>###</code> for a heading, <code>---</code> for a divider, a blank line for a
                new paragraph. Up to {MARKDOWN_BODY_MAX_CHARS.toLocaleString("en")} characters.
              </FieldHint>
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
              <FieldHint>
                Paste the HTML from your email builder — the same code you would paste into Gmail.
                It is checked on the server before it is saved: anything that could run code, load a
                page, or reach a non-secure address is removed, and the preview shows you what
                survived. Up to {Math.round(HTML_BODY_MAX_BYTES / 1024)} KB
                {htmlPreview === null
                  ? ""
                  : ` — this one is ${Math.max(1, Math.round(htmlPreview.bytes / 1024))} KB`}
                .
              </FieldHint>
              <FieldHint>
                Two things are dropped that a builder may include: <code>&lt;style&gt;</code> blocks
                (phone-only layout tweaks — a design that relies on them shows its desktop layout on
                a phone, scaled to fit) and images that are not on an <code>https</code> address.
                Host images where your builder puts them and paste the link it gives you.
              </FieldHint>
            </>
          )}
          <FieldHint>
            Merge fields:{" "}
            {MERGE_FIELDS.map((field, index) => (
              <span key={field}>
                {index > 0 ? ", " : null}
                <code>{`{{${field}}}`}</code>
              </span>
            ))}
            . Nothing else can be merged — a birthdate or a phone number is not on the list, on
            purpose.
          </FieldHint>
        </Field>

        {/* ── audience ── */}
        <Card className="gap-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>Recipients</CardTitle>
            <p
              className="text-brand-ink text-sm font-semibold"
              aria-live="polite"
              data-testid="audience-count"
            >
              {previewError !== null
                ? previewError
                : preview === null || previewPending
                  ? "Counting…"
                  : `This will reach ${preview.count} ${preview.count === 1 ? "person" : "people"}.`}
            </p>
          </div>
          <FieldHint>
            Every filter is &ldquo;any of&rdquo;; leaving one empty means it does not narrow. Only
            scholars with an email on file for the current term are counted.
          </FieldHint>

          {preview !== null && preview.count > DAILY_SEND_WARNING_THRESHOLD ? (
            <Alert variant="warning" role="status" data-testid="daily-limit-warning">
              Gmail sends about 500 messages a day. A list this size takes more than one day; the
              send pauses and resumes on its own.
            </Alert>
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

          <fieldset className="space-y-3">
            <legend className={LEGEND_CLASS}>Region</legend>
            {[...regionsByIsland.entries()].map(([island, regions]) => (
              <div key={island} className="space-y-1.5">
                <p className="text-brand-label text-xs">{island}</p>
                <div className="flex flex-wrap gap-2">
                  {regions.map((region) => (
                    <Chip
                      key={region.id}
                      checked={audience.region_ids.includes(region.id)}
                      onChange={(on) =>
                        setAudience((current) => ({
                          ...current,
                          region_ids: toggled(current.region_ids, region.id, on),
                        }))
                      }
                    >
                      {region.name}
                    </Chip>
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
            <FieldHint>
              No affiliations are recorded yet. A partnership (e.g. START x DataCamp) is a row a
              CRRD Admin adds, never a code change.
            </FieldHint>
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
              <p className="text-brand-label text-xs">Sample of who this reaches:</p>
              <ul className="text-brand-body text-sm">
                {preview.sample.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-3 border-t border-[#eff0f2] pt-5">
            <h3 className="text-brand-ink text-sm font-semibold">Pick people individually</h3>
            <FieldHint>
              Search finds anyone the filters above match. Untick someone to drop them from the
              send; tick someone to add them even if a filter above would otherwise exclude them.
            </FieldHint>
            <AudiencePicker audience={audience} onChange={setAudience} />
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-4">
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
          <p className="text-brand-label max-w-md text-xs">
            Saving does not send. The draft opens on its own page, where the recipient list is
            frozen and the send is started — and watched — from there.
          </p>
        </div>
        {message === null ? null : (
          <p role="alert" className="text-brand-body text-sm">
            {message}
          </p>
        )}
      </div>

      {/* ── live preview ── */}
      <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <Card className="gap-3.5 p-5 sm:p-6">
          <CardTitle>Preview</CardTitle>
          <FieldHint>
            Rendered as a recipient sees it, with sample values in place of the merge fields.
          </FieldHint>
          {rendered.error === null ? null : (
            <Alert variant="danger" role="alert" data-testid="merge-token-error">
              {rendered.error}
            </Alert>
          )}
          <div className="border-border overflow-hidden rounded-xl border bg-white">
            <div className="border-b border-[#eff0f2] px-4 py-2.5 text-sm">
              <span className="text-brand-label">Subject: </span>
              <span className="text-brand-ink font-medium">
                {rendered.subject || "(no subject)"}
              </span>
            </div>
            {bodyFormat === "markdown" ? (
              /* The renderer escapes the input FIRST and emits only its own tags
                 (lib/campaigns/markdown.ts), so this is our HTML, not the CRRD's. */
              <div
                className="prose prose-sm text-brand-body max-w-none px-4 py-3 text-sm"
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
                className="h-[32rem] w-full bg-white"
                data-testid="campaign-preview-frame"
              />
            )}
          </div>
          {bodyFormat === "html" && htmlPending ? (
            <FieldHint>Checking the pasted HTML…</FieldHint>
          ) : null}
        </Card>
      </aside>
    </div>
  );
}

/**
 * One filter option as a chip. The checkbox is the SAME native input it always was —
 * only visually hidden — so the label association, keyboard toggling and `:checked`
 * state are the browser's; the chip merely paints them.
 */
function Chip({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className={CHIP_CLASS}>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {children}
    </label>
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
    <fieldset>
      <legend className={LEGEND_CLASS}>{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Chip
            key={String(item.value)}
            checked={selected.includes(item.value)}
            onChange={(on) => onToggle(item.value, on)}
          >
            {item.label}
          </Chip>
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
