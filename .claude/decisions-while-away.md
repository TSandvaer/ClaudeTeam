# Decisions While Away — Autonomy Log

Append-only log of every autonomous orchestrator decision made under the user-global "Orchestrator autonomy" rule. Sponsor reviews on return and updates `Status` to `accepted` or `reversed by <user> <date>`.

**Calibration target:** 5–10% reversal rate.
- <5% → orchestrator is being too cautious; surface fewer items, auto-decide more.
- \>15% → foundation bar is too loose; raise the bar on what counts as foundation.

The filename retains the historic name `decisions-while-away.md` for path stability with the rule defined in user-global CLAUDE.md (the AWAY/LOCAL distinction was retired 2026-05-23 but the filename stays).

## Entry schema

Each entry uses an `## YYYY-MM-DD HHMM UTC — <one-line headline>` heading and includes:

- **Decided:** what was done (concrete and specific)
- **Foundation:** cited memory name / doc section + path / prior-session precedent reference
- **Alternative:** what surfacing would have produced as the other option
- **Reversibility:** how to undo + estimated effort
- **Status:** `pending review` initially; user updates to `accepted` or `reversed by <user> <date>` on return.

---

## Entries

<!-- New entries are appended below this line. -->
