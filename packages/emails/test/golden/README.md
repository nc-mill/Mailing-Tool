# Golden snapshots of the renderer

These files pin the exact byte output of the renderer for sixteen documents.

**Updating a snapshot is a deliberate step.** Run `pnpm vitest run packages/emails/test/golden -u`
only when you intended to change the output, and explain the change in the commit message.
A snapshot updated without an explanation hides a regression.

Documents 10, 11 and 12 exist because of acceptance criteria 17b and 17c: without a document
carrying a non default `baseFontSize`, a custom dark palette and a partial colour map, the rule
that these values are derived from the theme could be broken by a hard coded constant and the
snapshots would stay green.
