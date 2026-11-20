# Lacuna: overview

Full design: [lacuna-plan.md](lacuna-plan.md). This file is the short version.

## Problem

While writing an article in Obsidian, a missing fact (date, name, place, source, explanation) breaks the writer's flow.
Lacuna lets the writer drop a visible marker containing the question, keep writing, and resolve it later.
Claude, run through the user's own Claude Code CLI (subscription, no API credits), proposes answers with sources.
The user picks or edits one. The marker is replaced by the answer plus a citation pointing to a **history note**, which records the question, the candidates, the sources and the choice.

## Constraints

- Plain markdown, nothing proprietary in the vault.
- Private: everything stays local except the context explicitly sent to the search.
- Simple to use and simple to build (TypeScript + esbuild, no UI framework).
- Desktop only (`isDesktopOnly: true`).
- For the author first, built to community-store standards (English UI, README). Installed manually or through BRAT.

## Naming vocabulary (textual criticism)

- A *lacuna* is a gap in a manuscript that an editor later fills.
- *Ad locum* ("at the place") is a note on one specific passage, hence the `/adloc` command.
- The *apparatus criticus* is the footnote record of sources and alternative readings. That is what the history notes are, hence the `Apparatus/` folder.

## Decisions

The decision table (D1 to D24) is in section 2 of [lacuna-plan.md](lacuna-plan.md). Do not duplicate it here: edit it there.

## Reading order

1. [01-syntax-and-keywords.md](01-syntax-and-keywords.md)
2. [02-architecture.md](02-architecture.md)
3. [03-claude-cli.md](03-claude-cli.md)
4. [04-backlog.md](04-backlog.md)
