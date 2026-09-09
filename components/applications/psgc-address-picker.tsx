"use client";

// ─────────────────────────────────────────────────────────────────────────────
// PR C2 — the address cascade. Region → Province → City/Municipality → Barangay,
// each step offering only the children of the one above it.
//
// Ethan, 2026-09-09: "let's make it drop down with drop down filter instead of typing it …
// the only thing that they will type is their address and postal code."
//
// ⚠ THE NUMBER OF STEPS IS NOT FIXED, AND THAT IS THE WHOLE DESIGN. This component asks
// the database for "the children of what was just picked" and stops when those children
// are barangays. Two places in the country are not four levels deep, and both fall out
// without a special case here:
//
//   · NCR HAS NO PROVINCES. Its cities hang directly off the region, so picking National
//     Capital Region offers cities next. That is the PSA's own structure, not something
//     this form imposes.
//   · CITY OF MANILA HAS FOURTEEN SUB-MUNICIPALITIES between the city and the barangay —
//     Tondo, Binondo, Sampaloc and the rest. Ethan's example was "Binondo in Manila", and
//     Binondo's barangays are named "Barangay 287" through "Barangay 296": collapse that
//     level away and a Manila resident is choosing between bare numbers.
//
// ⚠ WHY THIS QUERIES FROM THE BROWSER, when `lib/supabase/client.ts` says PII is never
// fetched there. `psgc_locations` is the PSA's published national geography — public
// reference data, anon-readable by policy (0057), and it discloses nothing about any
// person. The alternative is shipping 43,769 rows into the page to avoid a query for the
// ~20 that are actually needed at each step.
//
// The value this component owns is a single BARANGAY CODE. Everything above it is an
// ancestor of that code, resolved server-side by `psgc_resolve()` — so the form never
// sends a place name and the stored names can never disagree with the stored code.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";

import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { createBrowserSupabase } from "@/lib/supabase/client";

export type PsgcRegionOption = {
  /** Our `regions.psgc_code` — the PSA's two digits. */
  psgc_code: string;
  name: string;
};

type Node = { code: string; name: string; level: string };

/** One rendered select: what it offers, and what is chosen in it. */
type Step = { level: string; options: Node[]; selected: string };

/** The PSA's ten-digit code for a region: two digits and eight zeroes. */
function regionCode(psgcCode: string): string {
  return `${psgcCode}00000000`;
}

/**
 * What to call a step, from the levels its options carry.
 *
 * The options at one step can MIX levels — a province's children are cities AND
 * municipalities, and NCR's are cities and one municipality (Pateros) — so the label is
 * chosen from what is actually present rather than from a fixed position in a list.
 */
function stepLabel(levels: Set<string>): string {
  if (levels.has("province")) return "Province";
  if (levels.has("barangay")) return "Barangay";
  if (levels.has("sub_municipality")) return "District";
  return "City / Municipality";
}

function placeholderFor(label: string): string {
  return label === "Barangay" ? "Select your barangay…" : `Select your ${label.toLowerCase()}…`;
}

export function PsgcAddressPicker({
  idPrefix,
  regions,
  value,
  onChange,
  error,
  disabled = false,
  required = true,
}: {
  /** Prefixes every control id, so the home and current pickers never collide. */
  idPrefix: string;
  regions: PsgcRegionOption[];
  /** The chosen BARANGAY code, or "" for nothing chosen yet. */
  value: string;
  onChange: (barangayCode: string) => void;
  error?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const [regionPsgc, setRegionPsgc] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // One client for the life of the component. Creating one per query would re-read the
  // environment and rebuild the auth listener on every keystroke-driven re-render.
  const supabaseRef = useRef<ReturnType<typeof createBrowserSupabase> | null>(null);
  function supabase() {
    supabaseRef.current ??= createBrowserSupabase();
    return supabaseRef.current;
  }

  const fetchChildren = useCallback(async (parentCode: string): Promise<Node[]> => {
    const { data, error: queryError } = await supabase()
      .from("psgc_locations")
      .select("code, name, level")
      .eq("parent_code", parentCode)
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (queryError || !data) throw new Error("psgc");
    return data;
  }, []);

  /** Replace everything below `depth` with one new step, or nothing if there is none. */
  const openNextStep = useCallback(
    async (parentCode: string, depth: number) => {
      setLoading(true);
      setLoadError(null);
      try {
        const options = await fetchChildren(parentCode);
        setSteps((prev) => {
          const kept = prev.slice(0, depth);
          if (options.length === 0) return kept;
          return [...kept, { level: options[0]?.level ?? "", options, selected: "" }];
        });
      } catch {
        setLoadError("The address list could not be loaded. Check your connection and try again.");
      } finally {
        setLoading(false);
      }
    },
    [fetchChildren],
  );

  // ── Restoring a stored value ──────────────────────────────────────────────
  // The admin edit screen and a restored draft both arrive with a barangay code and no
  // idea what is above it. Walk the parents once, on mount, and rebuild the steps so the
  // control shows an address rather than an empty picker over a value that is already set.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || value === "" || regions.length === 0) return;
    restoredRef.current = true;

    (async () => {
      setLoading(true);
      try {
        // Up from the leaf: barangay → (district) → city → (province) → region.
        const chain: Node[] = [];
        let code: string | null = value;
        // Annotated explicitly: without it `code`'s type is inferred from a query whose
        // result feeds back into `code`, which TypeScript reports as circular.
        for (let hop = 0; hop < 5 && code !== null; hop += 1) {
          const result: {
            code: string;
            name: string;
            level: string;
            parent_code: string | null;
          } | null = (
            await supabase()
              .from("psgc_locations")
              .select("code, name, level, parent_code")
              .eq("code", code)
              .maybeSingle()
          ).data;
          if (result === null) break;
          chain.unshift({ code: result.code, name: result.name, level: result.level });
          code = result.parent_code;
        }
        if (chain.length < 2) return; // not a resolvable address; leave the picker empty

        const region = chain[0];
        if (region === undefined) return;
        setRegionPsgc(region.code.slice(0, 2));

        // Rebuild each step's OPTIONS as well as its selection, so the reader can change
        // any level without the control having to re-derive itself.
        const rebuilt: Step[] = [];
        for (let depth = 1; depth < chain.length; depth += 1) {
          const parent = chain[depth - 1];
          const chosen = chain[depth];
          if (parent === undefined || chosen === undefined) break;
          const options = await fetchChildren(parent.code);
          rebuilt.push({ level: chosen.level, options, selected: chosen.code });
        }
        setSteps(rebuilt);
      } catch {
        setLoadError("The saved address could not be loaded. Choose it again below.");
      } finally {
        setLoading(false);
      }
    })();
  }, [value, regions.length, fetchChildren]);

  function handleRegion(nextPsgc: string) {
    setRegionPsgc(nextPsgc);
    setSteps([]);
    onChange("");
    if (nextPsgc !== "") void openNextStep(regionCode(nextPsgc), 0);
  }

  function handleStep(depth: number, code: string) {
    setSteps((prev) => prev.map((s, i) => (i === depth ? { ...s, selected: code } : s)));
    // Anything chosen below this step is no longer valid — a barangay in the old city is
    // not a barangay in the new one, and leaving it selected would submit an address the
    // applicant did not pick.
    onChange("");
    if (code === "") {
      setSteps((prev) => prev.slice(0, depth + 1));
      return;
    }
    const step = steps[depth];
    if (step?.level === "barangay") {
      setSteps((prev) => prev.map((s, i) => (i === depth ? { ...s, selected: code } : s)));
      onChange(code);
      return;
    }
    void openNextStep(code, depth + 1);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}_region`} required={required}>
            Region
          </FieldLabel>
          <NativeSelect
            id={`${idPrefix}_region`}
            value={regionPsgc}
            disabled={disabled}
            onChange={(event) => handleRegion(event.target.value)}
          >
            <option value="" disabled>
              Select your region…
            </option>
            {regions.map((region) => (
              <option key={region.psgc_code} value={region.psgc_code}>
                {region.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {steps.map((step, depth) => {
          const label = stepLabel(new Set(step.options.map((o) => o.level)));
          const id = `${idPrefix}_psgc_${depth}`;
          return (
            <Field key={id}>
              <FieldLabel htmlFor={id} required={required}>
                {label}
              </FieldLabel>
              <NativeSelect
                id={id}
                value={step.selected}
                disabled={disabled}
                onChange={(event) => handleStep(depth, event.target.value)}
              >
                <option value="" disabled>
                  {placeholderFor(label)}
                </option>
                {step.options.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          );
        })}
      </div>

      {loading ? <p className="text-brand-label text-xs">Loading…</p> : null}
      {loadError ? <FieldError message={loadError} /> : null}
      <FieldError message={error} />

      {/*
        The submitted value. A hidden input rather than `register()` on a select, because
        the value is the LEAF of a cascade whose depth is data-driven — there is no single
        select that holds it, and react-hook-form is given the resolved answer instead.
      */}
      <input type="hidden" name={`${idPrefix}_psgc_barangay_code`} value={value} readOnly />
    </div>
  );
}
