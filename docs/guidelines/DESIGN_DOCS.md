# Design docs

How to write the design docs in [`/docs/architecture/`](/docs/architecture/).
See AGENTS.md's "Architecture & design docs" section for where they live and
the index. This guideline governs the writing; those docs carry no authority.

## Principles

Follow [WRITING.md](WRITING.md). On top of it:

1. **Lead with the proposal and why.** No ramp-up or suspense.
2. **Document the design, not the journey.** Describe what you landed on.
3. **Decisions, not musings.** State trade-offs as choices: "A over B because
   Z." An "Open questions" section lists only unresolved decisions, each with a
   recommendation.
4. **Don't restate code or READMEs.** Cite or link instead.
5. **Cut RFC ceremony.** No status banners, audience headers, changelogs, or
   "appendix: citations."

## Recommended structure

A default scaffold, not a template. Big architecture docs and small feature
records differ — adapt or drop sections to fit the scope.

Problem → Design (show it) → Key decisions → Plan (only if phased) → Open
questions.

Write the Plan as a checklist — discrete `- [ ]` items, one per unit of work:

```
- [ ] define the type in agent-loop
- [ ] capture it in each adapter
- [ ] wire it into loop-server
```

## Examples

Bloated → tight.

> **Bad:** It's worth noting that, in order to keep state consistent, we
> decided it would be a good idea to validate the cache against the wire.
>
> **Good:** Consistency: the cache is valid iff its history is a prefix of the
> UI's; else rebuild.

> **Bad:** We considered a number of different approaches to the problem of
> deduplication before ultimately settling on hashing.
>
> **Good:** Dedup by content hash (`sha256(body)`) over timestamps — clocks
> skew across hosts.

## Lifecycle

A design doc is scaffolding, not a permanent record. Each implementation PR
checks off (`- [x]`) the plan items it completes, so the doc tracks the work
left. Once every item is checked — the entire plan shipped, all phases — delete
the doc and remove its row from AGENTS.md's "Architecture & design docs" index.
Durable documentation
lives in the code and package READMEs, not a stale `/docs/architecture/` doc
that drifts from reality.

**A document that describes a deleted mechanism is worse than no document.**
`ROADMAP.md` said "there are two paths, and both work" for as long as there was
one. When a change removes a mechanism, the doc that describes it is part of
the change.
