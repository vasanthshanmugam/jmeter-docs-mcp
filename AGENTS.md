# AGENTS.md

This repo is **JMeter Docs MCP**, a local stdio MCP server (`server/`, published to npm as `jmeter-docs-mcp`) that gives AI agents access to the official Apache JMeter user manual and inspects `.jmx` test plans. It also contains agent skills (`skills/`) and plugin manifests for three ecosystems.

## Plugin ecosystems

`.claude-plugin/plugin.json` is the **source of truth** for shared plugin fields (name, description, version, author, homepage, repository, keywords).

**Shared assets** used across ecosystems:
- `skills/`: agent skill packages. Each subfolder has a `SKILL.md` whose frontmatter `name` matches the folder.
- `.mcp.json`: launches the MCP server with `npx -y jmeter-docs-mcp@latest`

**Claude**: `.claude-plugin/plugin.json` (source of truth) + `.claude-plugin/marketplace.json`

**GitHub Copilot**: `.github/plugin/plugin.json` must be an **exact copy** of `.claude-plugin/plugin.json`.

**Codex**: `.codex-plugin/plugin.json` + `.agents/plugins/marketplace.json`. The plugin.json shares fields with Claude and adds Codex-only fields (`skills`, `mcpServers`, `interface`, `license`). Keep asset paths relative to the repo root (`./skills/`, `./.mcp.json`) and never use `..` paths. The marketplace entry must point at `./`.

## Sync rules

- When editing shared plugin metadata, edit `.claude-plugin/plugin.json` first, copy it verbatim to `.github/plugin/plugin.json`, and update the shared fields in `.codex-plugin/plugin.json` to match.
- The plugin `version` and `server/package.json` `version` must match. Bump both in the same change.

## MCP server

Source is in `server/src/`. `dist/` is build output and is not checked in.

- `docs/pages.ts`: the list of indexed manual pages and the allowed fetch hosts. Add new manual pages here.
- `docs/html.ts`: HTML to markdown conversion and section splitting. It depends on jmeter.apache.org markup (`#content`, `h1`/`h2` ids, `div.property`, `div.note`, `span.code`). If the site layout changes, update it together with `test/fixtures/`.
- `docs/search.ts`: BM25 ranking and excerpts.
- `docs/library.ts`: index loading, search, fetch, and lookup used by both the MCP tools and the CLI.
- `jmx/inspect.ts`: JMX parsing and lint rules. Each new rule needs a test in `test/unit/inspect.test.ts`.
- `server.ts` registers the MCP tools and `index.ts` defines the CLI. Keep tool names, the CLI, `server/README.md`, and the skills in step.

If you change server behavior, run `npm run build && npm test` from `server/`. Unit tests must stay offline. Targets Node.js 22+.

## Validation

Run the repo validator after any plugin, skill, layout, or doc change:

```powershell
pwsh -File scripts/validate-repo.ps1
```

It enforces the sync rules, skill structure, file existence, MCP config wiring, and marketplace wiring. Treat it as the authoritative checklist.

## General principles

- `README.md` is the primary user-facing document. Update it in the same change whenever install steps, tools, skills, or CLI behavior change.
- Make the smallest synchronized set of edits that keeps all three ecosystems coherent.
- Do not imply affiliation with the Apache Software Foundation. Keep the trademark notice in `README.md`.
- Prefer fixing drift immediately over documenting known inconsistency.
