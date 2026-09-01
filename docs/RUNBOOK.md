# RUNBOOK — index

Five numbered runbooks. Each is written for someone with no prior context and
must be executable by someone who did not write it (PRD Success Metric 7,
US-K1). Link here, not scattered across other docs.

| # | Runbook | Owning role | When |
|---|---|---|---|
| 01 | [Term Rollover](runbooks/01-TERM_ROLLOVER.md) | `tech_admin` (CTO) | Once a year, end of May |
| 02 | [Restore From Backup](runbooks/02-RESTORE_FROM_BACKUP.md) | `tech_admin` (CTO) | Drilled quarterly; on real data loss |
| 03 | [Credential Rotation](runbooks/03-CREDENTIAL_ROTATION.md) | `tech_admin` (CTO) | On handover, on suspected compromise, on schedule |
| 04 | [MFA Recovery](runbooks/04-MFA_RECOVERY.md) | `tech_admin` | On a lost second-factor device |
| 05 | [Incident Response](runbooks/05-INCIDENT_RESPONSE.md) | `tech_admin` (CTO) | On any suspected security incident or outage |

See also [ANNUAL_HANDOVER.md](ANNUAL_HANDOVER.md), the checklist the outgoing
CTO signs at the end of each term.
