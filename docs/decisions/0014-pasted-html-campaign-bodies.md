# ADR 0014 — A campaign body may be a designed HTML template, pasted and sanitised

**Date:** 2026-09-07
**Author:** Ethan Baltazar (project head), on the CCDO's working practice
**Status:** Accepted
**Affects:** `lib/campaigns/{sanitize,markdown,schema,actions}.ts`,
`components/campaigns/campaign-composer.tsx`, migration `0049_campaign_html_body.sql`,
pgTAP `077_campaign_html_body.sql`, `sanitize-html` 2.17.7 (exact)

---

## Context

The composer shipped with one way to write a message: a Telegram-style markdown subset
(`lib/campaigns/markdown.ts`), chosen at the 2026-09-05 meeting because a CRRD officer
should not have to know HTML. That renderer **escapes its input before rendering**, so
the only tags that can reach a recipient are the ones our own code emits. It is a
complete sanitisation story, and it is why ADR 0010 says the mail transport trusts the
composer's output without inspecting it.

On 2026-09-07 the CCDO showed how START-DOST actually sends designed mail today: the
template is built in an external email builder, and a Chrome extension — Designmodo's
"Insert and Send HTML with Gmail", or cloudHQ's equivalent — pastes the finished HTML
into a Gmail compose window. A DataCamp scholarship announcement built that way carries a
banner image, a table layout, inline styles and a `{{First Name}}` placeholder.

None of that can be expressed in the markdown subset, and nothing in START-SYS could
accept it: pasted into the composer, every `<table>` would arrive at the recipient as
escaped text. So the org's designed sends stay outside the system, which means they also
lose the audience filter, the recipient picker, the merge whitelist and the delivery
report — the whole reason the campaign feature exists.

Accepting markup the system did not author means the escape-first guarantee is gone for
that path. Something has to replace it.

## Decision

### 1. Two body formats, one stored source, one discriminator

`email_campaigns.body_format` is `'markdown'` (the default, and what every campaign
written before migration `0049` is) or `'html'`. `body_markdown` continues to hold the
**source** the CRRD typed or pasted; `body_html` holds what was rendered from it. The
column keeps its name deliberately — renaming it would touch queries, generated types,
two pgTAP suites and the e2e spec for no behavioural gain, and the migration header says
so plainly rather than leaving a future reader to wonder.

### 2. The markdown tab gains what a simple designed email needs

Headings (`#` to `###`), images (`![alt](https://…)`), numbered lists, quotes (`> `) and
dividers (`---`), on top of the marks already supported. Still escape-first, still no
dependency. A CRRD officer who does not use a builder can now produce something with a
banner and a heading without leaving the tab they already know.

### 3. The paste tab is governed by an allowlist, server-side

`lib/campaigns/sanitize.ts` keeps only what is named in it: the table and text tags an
email template needs, a fixed attribute list per tag, and inline CSS filtered **one
property at a time** against a value pattern that permits colour functions and forbids
bare parentheses — which rules out `url()`, `expression()` and every other fetch-or-
execute function in one rule rather than a blocklist somebody has to keep current.
Schemes are `https`, `mailto` and `tel`; images are `https` only. `<script>`, `<style>`,
`<iframe>`, `<form>`, `<input>`, `<object>`, `<embed>`, `<base>`, `<meta>` and `<link>`
are dropped **with their contents**, so a stripped script does not leave its source
behind as visible text.

The sanitiser runs **inside the Server Action, and its output is what is stored.** The
raw paste is never sent. The composer's preview calls the same function through
`previewHtmlBodyAction` and renders the result in a sandboxed iframe, so the CCDO sees
what will actually be saved — including anything the allowlist removed — before
committing to it. The markdown preview stays inline, because that path is still
escape-first and the HTML there is ours.

### 4. `<style>` blocks are dropped, not filtered

Ethan, 2026-09-07: *"Let's drop style. We'll just add it if it's needed."*

`sanitize-html` filters inline style **properties**; it cannot filter the CSS inside a
`<style>` block — the block is kept whole or dropped whole. Kept whole means trusting
pasted CSS, including `url()` fetches and `@import` of a third-party stylesheet. Builders
use `<style>` mainly for `@media` phone tweaks, and Gmail already strips it for non-Google
accounts and for forwarded mail, so no builder relies on it for the base layout.

**The cost, stated so nobody is surprised on a phone:** a template that stacks its columns
via `@media` will not stack — it renders its desktop layout, scaled down to fit, which is
what mail clients do with a fixed-width table. Single-column designs (banner, text,
button — the shape of the CCDO's DataCamp mail) are unaffected. If a multi-column template
ever needs it, the follow-up is a postcss pass keeping `@media` and allowlisted properties
while dropping `url(`, `@import` and `expression(` — one to two hours, and it does not
change anything else in this ADR.

### 5. A 200 KB cap on the source, and no clipping warning

Ethan, 2026-09-07: *"warning is 200 kb, no warning needed for 100kb."* Enforced in the zod
schema, again in the sanitiser after cleaning, and again as a CHECK constraint. `body_html`
carries a separate 256 KB backstop so a runaway row cannot be written at all.

Gmail appends *"[Message clipped] View entire message"* past roughly 102 KB. The composer
does **not** warn about it: a clipped message still sends and still renders, the reader
clicks through, and whether that is acceptable is the template author's call.

### 6. Merge fields work in text, and are refused in attributes

`{{given_name}}` in visible text is substituted per recipient and **HTML-escaped at
substitution** (`lib/campaigns/merge.ts`), so a name containing markup cannot inject into
another recipient's mail. A token inside an attribute — `href="…/{{member_id}}"` — is
**refused** rather than escaped differently: escaping that is correct for text is not
sufficient inside a URL, and a second escaping rule is a second thing to get wrong. No
legitimate template needs one.

### 7. A bug found on the way, fixed here

The merge-token guard matched only `{{[a-zA-Z0-9_]+}}`. `{{First Name}}` — the spelling
every other mail-merge tool uses, and the one on the pasted template that prompted this
ADR — matched nothing, so it was **neither substituted nor reported**: it would have gone
out to recipients as the literal text `{{First Name}}`. That is exactly what US-G3 exists
to prevent. Any `{{…}}` that is not a whitelist field is now an unknown token and fails
the send. Regression test in `lib/campaigns/merge.test.ts`, observed red against the old
scan before the fix landed.

## Consequences

- **Designed sends come inside the system.** The audience filter, the recipient picker,
  the merge whitelist and the delivery report now apply to the mail the org actually
  sends, instead of only to plain-text messages.
- **A new dependency**, `sanitize-html` 2.17.7 (exact) plus its types. Justified the way
  `nodemailer` was in ADR 0010: hand-rolling an HTML sanitiser is a worse security
  decision than using the one the ecosystem has audited. It pulls `postcss` and
  `htmlparser2`; both are build-time-quiet, server-only, and never reach a client bundle.
- **Images must be hosted somewhere.** `data:` URIs are refused, so a template's images
  keep the builder's CDN URLs. The org has no image host of its own (no domain — PRD
  OQ-10; Drive is never public). A Supabase Storage public bucket for campaign assets is
  the launch-time answer and is **not** built here.
- **Spam risk rises slightly.** Image-heavy, near-identical HTML from a `gmail.com`
  address is what filters look for. Every message still carries a plain-text alternative
  (derived from the sanitised HTML for this path), which is the mitigation ADR 0010
  already relies on.
- **The pasted source is kept** in `body_markdown` so the CRRD can edit and re-save. It is
  never sent and never rendered outside a sandboxed frame.

## Risks

- **The database does not sanitise, and cannot.** Postgres has no HTML parser. The
  allowlist is application-layer, so a `crrd_admin` or `exec_admin` calling PostgREST
  directly with their own JWT could write a `body_html` the allowlist would have refused.
  That is the same two tiers who compose and send campaigns and can already put any text
  in front of a recipient; the preview is sandboxed and mail clients strip scripts on
  receive. So it is not a privilege boundary being crossed — but it is **not** "the
  database enforces sanitisation" either, and migration `0049`'s header says so in as many
  words so nobody reads the CHECK constraints as more than the size backstops they are.
- **An allowlist is only as good as its list.** A tag or attribute nobody thought of is
  dropped, which is the correct failure direction; a *permitted* attribute with an unsafe
  value is the residual risk, and it is why `style` is filtered per property and why
  schemes are checked on every URL-bearing attribute rather than only on `href`.
- **`sanitize-html` is now security-relevant code.** It needs to be kept current the way
  `nodemailer` does; runbook 03's dependency line covers it.
