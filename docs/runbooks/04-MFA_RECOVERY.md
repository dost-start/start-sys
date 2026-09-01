# Runbook 04 — MFA Recovery

**Owner:** `tech_admin`.
**Status:** STUB.

## When to run this

Someone above Member tier (PRD item 2: TOTP enrolment is mandatory above
Member) has lost their second-factor device and cannot complete login.

## Preconditions

- You hold `tech_admin`.
- You have verified the requester's identity out-of-band (not merely
  because an email arrived from their address).

## Steps

The lost-device path is **`tech_admin`-mediated re-enrolment, and the
re-enrolment itself is written to the audit log** (PRD US-A3, ARCHITECTURE.md
§5 "2FA on password reset"):

1. Verify the requester's identity out-of-band.
2. As `tech_admin`, force-clear the requester's existing TOTP factor so
   they can re-enrol from scratch.
3. Have the requester complete TOTP enrolment again from `/auth/mfa/enroll`
   while on a call or in person, and confirm they receive a fresh set of
   one-time recovery codes (shown once — they cannot be re-displayed).
4. Confirm the re-enrolment action produced an `audit_log` row naming you
   as the acting `tech_admin` and the requester's account.

**Documented exception:** Members hold no organizational data and reset via
an emailed one-time code alone — they do not go through this TOTP recovery
path at all (PRD US-A4, ARCHITECTURE.md §5).

## How to verify it worked

The requester can log in and reach a route past the MFA gate; a new
`audit_log` row exists for the re-enrolment naming both the requester and
the acting `tech_admin`.

## If it fails

*(TODO(tech_admin) — link to runbook 05 if this looks like account
compromise rather than an honest lost device.)*
