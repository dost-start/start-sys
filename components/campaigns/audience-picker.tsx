// ─────────────────────────────────────────────────────────────────────────────
// The campaign composer's people picker (2026-09-06 SRS follow-up). Filters narrow the
// audience; this is where the CRRD looks at exactly who that is and hand-picks or drops
// individual people. A search box finds someone by name or member ID; a header
// checkbox takes "everyone matching the filters"; a row checkbox ticks or unticks one
// person. `list_audience_candidates()` applies ONLY the filter axes — the same axes
// `resolve_recipients()` reads — and ignores the selection keys entirely, so what shows
// up here is exactly "who the filters match" and never a stale or narrowed view of it.
//
// ⚠ NOTHING HERE IS AN ENFORCEMENT. `toggleCandidate` / `setSelectAll` /
// `clearSelection` (lib/campaigns/audience-selection.ts) only rewrite the
// `AudienceFilter` object the composer already holds; `resolve_recipients()` is what
// actually resolves it at freeze time, and RLS refuses the call for anyone outside
// crrd_admin / exec_admin regardless of what this renders (CONVENTIONS §6).
//
// NO EMAIL ADDRESSES, ANYWHERE IN THIS FILE. `AudienceCandidate` carries name, member
// ID, region, department, committee and position — never an address; an address leaves
// the database only as a frozen recipient row, at send time (lib/campaigns/types.ts).
//
// Brand restyle (2026-09-08): the same controls on the vendored primitives. The row
// checkboxes stay VISIBLE (never sr-only) — e2e/campaign-send.spec.ts ticks them by their
// `aria-label`, which is unchanged.
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listAudienceCandidatesAction } from "@/lib/campaigns/actions";
import {
  clearSelection,
  isCandidateSelected,
  selectionSummary,
  setSelectAll,
  toggleCandidate,
} from "@/lib/campaigns/audience-selection";
import { AUDIENCE_PAGE_SIZE, type AudienceFilter } from "@/lib/campaigns/schema";
import type { AudienceCandidate } from "@/lib/campaigns/types";

export type AudiencePickerProps = {
  audience: AudienceFilter;
  onChange: (next: AudienceFilter) => void;
};

export function AudiencePicker({ audience, onChange }: AudiencePickerProps) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AudienceCandidate[]>([]);
  const [total, setTotal] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The full audience, read INSIDE the fetch effect without being one of its
  // dependencies. `list_audience_candidates()` ignores select_all / person_ids /
  // excluded_person_ids entirely, and every row's checked state below is read straight
  // off the live `audience` prop at render time — never off the fetched page — so a
  // selection-only change (a tick, an untick, "everyone matching") must not reset the
  // page or re-fetch anything.
  const audienceRef = useRef(audience);
  audienceRef.current = audience;

  const {
    join_years,
    region_ids,
    island_groups,
    statuses,
    affiliation_ids,
    role_codes,
    department_ids,
    committee_ids,
    university_ids,
    year_levels,
  } = audience;

  // A filter axis (or the search box) changed underneath the picker: whatever page the
  // CRRD was on no longer means anything, so start over at page 1.
  useEffect(() => {
    setPage(1);
  }, [
    join_years,
    region_ids,
    island_groups,
    statuses,
    affiliation_ids,
    role_codes,
    department_ids,
    committee_ids,
    university_ids,
    year_levels,
    q,
  ]);

  // The candidate list itself, debounced 400ms — same rhythm as the composer's own live
  // recipient count, so ticking through filters does not fire a request per keystroke.
  useEffect(() => {
    let cancelled = false;
    setPending(true);
    const handle = setTimeout(() => {
      void listAudienceCandidatesAction({ audience: audienceRef.current, q, page }).then(
        (result) => {
          if (cancelled) return;
          setPending(false);
          if (result.ok) {
            setRows(result.data.rows);
            setTotal(result.data.total);
            setError(null);
          } else {
            setRows([]);
            setTotal(0);
            setError(result.error.message);
          }
        },
      );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // `audience` is read via `audienceRef` on purpose — see the comment above the ref —
    // so a selection-only change is deliberately absent from this dependency list.
  }, [
    join_years,
    region_ids,
    island_groups,
    statuses,
    affiliation_ids,
    role_codes,
    department_ids,
    committee_ids,
    university_ids,
    year_levels,
    q,
    page,
  ]);

  const summary = selectionSummary(audience);
  const start = total === 0 ? 0 : (page - 1) * AUDIENCE_PAGE_SIZE + 1;
  const end = Math.min(page * AUDIENCE_PAGE_SIZE, total);
  const hasNextPage = page * AUDIENCE_PAGE_SIZE < total;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Field className="w-full sm:w-80">
          <FieldLabel htmlFor="audience-search">Search by name or member ID</FieldLabel>
          <Input
            id="audience-search"
            type="text"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="e.g. Dela Cruz or 2024-0001"
            className="h-9 text-[13px]"
          />
        </Field>
        <div className="flex flex-wrap items-center gap-4">
          <label className="text-brand-body flex h-9 items-center gap-2 text-sm whitespace-nowrap">
            <Checkbox
              className="mt-0"
              checked={audience.select_all}
              onChange={(event) => onChange(setSelectAll(audience, event.target.checked))}
            />
            Everyone matching the filters
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange(clearSelection(audience))}
          >
            Clear selection
          </Button>
        </div>
      </div>

      <p className="text-brand-label text-sm" aria-live="polite">
        {summary.picked} picked, {summary.excluded} excluded
      </p>

      {error !== null ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <div className="border-border overflow-hidden rounded-xl border">
        <Table data-testid="audience-candidates">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <span className="sr-only">Select</span>
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Member ID</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Committee</TableHead>
              <TableHead>Position</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && !pending ? (
              <TableRow>
                <TableCell colSpan={7} className="text-brand-label text-center">
                  Nobody matches these filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.person_id}>
                  <TableCell>
                    <Checkbox
                      className="mt-0"
                      aria-label={`Select ${row.family_name}, ${row.given_name}`}
                      checked={isCandidateSelected(audience, row.person_id)}
                      onChange={(event) =>
                        onChange(toggleCandidate(audience, row.person_id, event.target.checked))
                      }
                    />
                  </TableCell>
                  <TableCell className="text-brand-ink font-medium">
                    {row.family_name}, {row.given_name}
                  </TableCell>
                  <TableCell className="font-mono text-[13px]">{row.member_id ?? "—"}</TableCell>
                  <TableCell>{row.region_name}</TableCell>
                  <TableCell>{row.department_name ?? "—"}</TableCell>
                  <TableCell>{row.committee_name ?? "—"}</TableCell>
                  <TableCell>{row.position_title ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-brand-label text-xs">
          {total === 0 ? "Showing 0 of 0" : `Showing ${start}–${end} of ${total}`}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((current) => Math.max(current - 1, 1))}
            disabled={page <= 1 || pending}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((current) => current + 1)}
            disabled={!hasNextPage || pending}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
