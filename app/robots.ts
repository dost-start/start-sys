// ─────────────────────────────────────────────────────────────────────────────
// /robots.txt — BUILD_PLAN S7-T12.
//
// PRD §4 Non-Goals, "Public accessibility": *"Other than the forms it sends out, the
// system is not accessible to the general public."* RLS already makes that true of the
// DATA — a crawler is `anon` and `anon` reads almost nothing. This file makes it true
// of the URL SPACE, which is a separate and smaller problem: an indexed
// `/admin/members` or `/login` is not a disclosure, but it is an invitation, and it is
// the kind of thing an org discovers because somebody else found it first.
//
// TWO ALLOWED PATHS, AND ONLY TWO:
//   /apply    the public membership application portal (PRD v1.0 item 5). It is
//             deliberately discoverable — the org WANTS scholars to find it, and
//             US-G5 sends its link to external recipients.
//   /privacy  the RA 10173 privacy notice. A notice nobody can reach is not published,
//             and consent at collection is meaningless if the text behind the checkbox
//             is not publicly readable (S7-T21, S7-T23).
//
// Everything else is `Disallow: /`. `Allow` beats `Disallow` on a longer, more specific
// match, so the two exceptions survive the blanket rule in every major crawler.
//
// ⚠️ **`robots.txt` IS A REQUEST, NOT A CONTROL.** A crawler may ignore it, and an
// attacker certainly will — it is also, read the other way, a list of the paths that
// exist. That is why the enforcing half is the `X-Robots-Tag: noindex, nofollow`
// header in `next.config.ts`, which applies to every path except these same two and
// cannot be declined, and why neither of them is a security boundary. Adding a public
// page means editing THREE files: here, `next.config.ts`'s exclusion regex, and
// `middleware.ts`'s matcher. Three, deliberately.
//
// `/robots.txt` is itself reachable anonymously: `middleware.ts`'s matcher excludes any
// path with a file extension, so this route is not behind the login gate.
// ─────────────────────────────────────────────────────────────────────────────

import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/",
        allow: ["/apply", "/privacy"],
      },
    ],
    // No `sitemap` and no `host`. A sitemap would be a published index of a system
    // whose whole non-goal is public accessibility.
  };
}
