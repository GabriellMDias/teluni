# Authoring Architecture Decision Records

Use the [decision index](README.md) to search existing decisions and the [template](template.md) to draft a record. ADRs preserve decision history and rationale; current policy describes current architecture. Git, migrations, changelogs, design documents, and runbooks retain their separate responsibilities.

## When a decision needs an ADR

Create an ADR for a significant choice whose rationale a future contributor cannot reliably infer from implementation. Relevant effects include system boundaries, dependency direction, ownership, runtime/deployment topology, security, persistence, public contracts, cross-cutting technology, operational behavior, and long-term maintainability.

Consider the breadth, reversibility, long-term dependency, plausible alternatives, integrity/security implications, and risk of losing the reasoning. Ordinary local refactors, fixes, tests, small helpers, individual indexes, and routine dependency additions do not each need an ADR. Major technology choices generally do. Existing foundation policies do not each need retroactive ADRs.

An ADR records a sufficiently concrete architectural conclusion, not every discussion or rejected idea. It must not become a task tracker, changelog, runbook, detailed implementation design, or snapshot of volatile vendor data. A separate RFC system is not required. Bundle decisions only when their rationale and lifecycle belong together; avoid giant records deciding unrelated parts of the stack.

## Lifecycle and historical integrity

| Status | Meaning |
| --- | --- |
| `proposed` | Under active consideration; implementation must not assume finality unless explicitly exploratory |
| `accepted` | Approved architectural direction; implementation and current documentation should align, allowing an explicit migration period |
| `rejected` | Considered and deliberately not adopted |
| `superseded` | Previously accepted, then replaced by another decision; link the replacement |
| `deprecated` | Historically relevant but no longer appropriate for new architecture; use sparingly when replacement is transitional or incomplete |

Do not add statuses without a clear need. Normal transitions are proposed to accepted/rejected and accepted to superseded/deprecated. Do not normally revert historical decisions to proposed; create a new record when reconsidering them.

Accepted does not mean implemented or released. Track pending/partial/completed implementation through normal issues, tasks, or pull requests, not extra ADR statuses. Exploratory work and proofs of concept provide evidence but do not themselves establish acceptance. Long-lived production implementation should generally not rely on an unresolved major proposal.

Accepted substantive history should remain immutable. Non-semantic spelling, formatting, broken-link, and obvious-typo corrections may be acceptable, but must not change historical meaning. When architecture changes, create a new ADR. Retain the old record, mark it superseded, and add reciprocal `Supersedes` / `Superseded by` references. Keep the original date. For partial supersession, identify precisely what remains valid, what changed, and which decision replaces it.

Rejected records can preserve useful evaluation and constraints; a changed context can justify reconsideration in a new ADR. Do not treat rejection as a permanent prohibition. Purely local abandoned proposals may be removed before meaningful shared history; preserve broadly reviewed or referenced proposals as rejected where useful. Do not record every immediately dismissed idea.

## Identity and metadata

Use monotonic numeric identifiers and descriptive English filenames of the form `NNNN-short-decision-title.md`. Numbers identify records, not importance, domain, priority, or version. Gaps are acceptable. Never reuse or renumber identifiers already in shared history. Resolve parallel numbering conflicts before merge; an unshared identifier may be changed.

Record title, status, date, context, decision, and consequences. For accepted records, the date should generally be the acceptance date. Titles should describe the decision rather than merely name a topic. Preserve identifiers once merged and referenced.

Simple Markdown metadata is the current format. `pnpm docs:check` validates filenames, matching titles/IDs, status, ISO dates, required sections, and index membership. Preserve these field names as tooling contracts. Supersession semantics still require review; no automatic numbering or supersession checker is implemented. ADR files remain canonical; avoid duplicate status stores or custom ADR software without a concrete need.

## Content and evidence

- **Context:** explain the actual problem, relevant constraints, scope, timing, and assumptions. Avoid unnecessary implementation detail.
- **Decision:** state the chosen direction clearly enough to understand independently of the alternatives.
- **Rationale:** explain the material tradeoffs, evidence, and constraints. Distinguish confirmed evidence, reasoned tradeoffs, and assumptions.
- **Alternatives:** describe serious alternatives considered; do not fabricate alternatives or evaluation evidence to fill a template.
- **Consequences:** include benefits, costs, limitations, new responsibilities, security/operational effects, and reversibility or migration costs where relevant. Formal scoring is not required.
- **References:** link relevant repository policy, earlier decisions, designs, benchmarks, proofs of concept, and durable evidence. Avoid unnecessary dependency graphs and large volatile datasets. Preserve enough explanation that disappearing external links do not destroy the rationale.

Use current evidence at decision time when product capability, support lifecycle, pricing, security status, or provider limits matter. Vendor documentation can support constraints but must not be the sole location of the explanation. Detailed implementation and operational migration steps normally belong outside the ADR.

## Creation, review, and acceptance

1. Search the index and related policies for the same question, accepted direction, superseded decision, or rejected alternative. Determine whether this is an architectural decision rather than an implementation detail.
2. Allocate the next available identifier, copy the template, and use `proposed` status.
3. Document context, explicit direction, meaningful alternatives, rationale, constraints, and positive and negative consequences while the context is still known.
4. Review in proportion to impact: is the problem real, the complexity justified, and the choice consistent with existing architecture? Identify conflicts and intentional deviations explicitly.
5. Accept or reject through repository review. For a small team, review, merge, and accepted status are sufficient; do not add governance ceremony without a concrete need.
6. On acceptance, update affected current documentation and implement the selected direction with relevant verification. Do not retain rejected experimental paths unnecessarily.

For supersession, additionally identify changed constraints, reciprocal references, affected current policy, and compatibility/migration work. For rejection, record decisive reasons, preferred alternatives where applicable, and conditions that could justify reconsideration.

Retrospective ADRs should say the decision was already in effect. Record only known reasoning and state uncertainty rather than inventing a historical evaluation. Significant principle deviations belong in the decision and corresponding current-policy update. When later accepted decisions supersede older records, follow the replacement and current policy rather than treating the superseded record as current architecture.

## Maintenance and deferred mechanisms

Routine maintenance should be limited to permitted corrections and supersession metadata. Current architecture must remain discoverable without reading the entire chronological ADR history. Keep descriptive titles, explicit technologies/concepts, and useful related references.

Frontmatter, automatic numbering, generated indexing, status/supersession validation, approval workflows, and required reviewers remain tooling or organizational decisions. Introduce them only when justified. ADRs should preserve meaningful reasoning without becoming bureaucratic records for every change.
