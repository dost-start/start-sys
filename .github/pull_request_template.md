## What

<!-- One or two sentences. What changed? -->

## Why

<!-- Link the PRD requirement (US-*, v1.0 item N), the CBL article, or the issue in docs/issues/. -->

## Docs

<!-- Which doc changed (PRD / ARCHITECTURE / DATA_MODEL / CONVENTIONS / a runbook / an ADR),
     or "none — <reason>". An empty Docs line is a blocked review (CONVENTIONS §9 D1). -->

## Security

<!-- New tables? Touched a policy, a column GRANT, a SECURITY DEFINER function, or lib/server/?
     yes → list each one. no → write "no". -->

**Any `yes` under Security requires a matching pgTAP test in this same PR.**

## Verified

<!-- How you checked this beyond CI. For a security change, name the red you observed:
     what you broke, which test failed, and that you reverted it. -->
