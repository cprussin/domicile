# Design docs

How to write the design docs in [`/docs/architecture/`](/docs/architecture/).
See AGENTS.md's "Architecture & design docs" section for where they live and
the index. This guideline governs the writing; those docs carry no authority.

## Principles

These are the rule. A doc that follows them is good regardless of shape.

1. **Lead with the answer.** Proposal and why, up front. No ramp-up, no
   history, no suspense.
2. **Document the design, not the journey.** Describe what you landed on.
   Mention an alternative only when rejecting it is necessary to explain the
   choice.
3. **Say it once.** Don't restate an idea across sections, or narrate in prose
   what a table or code block already shows.
4. **Show, don't describe.** Use real type names, field names, file paths, and
   example I/O. Reach for a table, list, or code block to convey a shape,
   mapping, or comparison.
5. **Every sentence earns its place.** Cut filler and hedging — "it's worth
   noting," "in order to," "arguably," "essentially." One claim per heading.
6. **Decisions, not musings.** State trade-offs as choices: "A over B because
   Z." An "Open questions" section lists only genuinely unresolved decisions,
   each with a recommendation.
7. **Don't restate code or READMEs.** Cite or link instead.
8. **Cut RFC ceremony.** No status banners, audience headers, changelogs, or
   "appendix: citations."
9. **The doc obeys its own rule.** Be the example of the style.

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
the doc, and remove its row from AGENTS.md's "Architecture & design docs" index
(and the README `architecture/` listing). Durable documentation
lives in the code and package READMEs, not a stale `/docs/architecture/` doc
that drifts from reality.
