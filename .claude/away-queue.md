# Away Queue — Sponsor Sign-Off Required

Items the orchestrator deliberately did NOT auto-decide. These require the sponsor's input before any action proceeds.

The orchestrator queues here when a decision falls into the never-auto-decide list (user-global CLAUDE.md):

- Strategic priority shifts (which milestone ships next, scope cuts, pivots, sequence changes, deferrals of in-flight work).
- Subjective-feel calls (visual polish, character voice, copy tone, motion feel, design aesthetic).
- Externally-visible actions (Teams/Slack posts, force-push, force-reset, deletes, force-merge, anything sent to third parties).
- Billing, credit usage, or infrastructure-config changes (Vercel, Azure, cloud accounts, secrets).
- Anything where the only "foundation" is the orchestrator's own confidence.

## Entry schema

Each entry uses an `## YYYY-MM-DD HHMM UTC — <one-line headline>` heading and includes:

- **Question:** what specifically needs sponsor input
- **Context:** what triggered this and what's currently blocked on the answer
- **Options:** the candidate answers the orchestrator considered, with one-line trade-offs each
- **Orchestrator recommendation:** the option the orchestrator would pick if forced, with rationale
- **Status:** `pending` initially; user updates to `answered <date>: <decision>` on return.

---

## Open items

<!-- New entries are appended below this line. -->
