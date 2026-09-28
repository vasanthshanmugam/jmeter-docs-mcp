# jmeter-docs-mcp

MCP server and CLI that gives AI agents access to the official [Apache JMeter user manual](https://jmeter.apache.org/usermanual/) and inspects `.jmx` test plans.

Community project, not affiliated with the Apache Software Foundation.

## Run as an MCP server

With no command, the binary starts an MCP server over stdio:

```sh
npx -y jmeter-docs-mcp@latest
```

Tools: `jmeter_docs_search`, `jmeter_reference_lookup`, `jmeter_docs_fetch`, `jmeter_inspect_test_plan`. See the [repository README](../README.md) for client setup.

## CLI

The package installs two equivalent binaries, `jmeter-docs-mcp` and `jmeter-docs`.

| Command | Description |
|---------|-------------|
| `serve` | Start the MCP server over stdio (default) |
| `search <query...> [-n, --limit <n>] [--json]` | Search the user manual |
| `lookup <name...> [-k, --kind component\|function\|property] [--max-chars <n>] [--json]` | Show the reference entry for a component, function, or property |
| `fetch <url> [-s, --section <heading>] [--max-chars <n>] [--json]` | Fetch a jmeter.apache.org page, or one section, as markdown. Accepts page names such as `functions.html#__time`. |
| `sections [page]` | List indexed sections, optionally for one page |
| `inspect <file.jmx> [--json]` | Outline a test plan and report best-practice findings |
| `clear-cache` | Delete cached documentation pages |

Examples:

```sh
jmeter-docs search "distributed testing firewall ports"
jmeter-docs lookup "JSON Extractor"
jmeter-docs lookup jmeter.save.saveservice.output_format --kind property
jmeter-docs fetch component_reference.html#HTTP_Request_Defaults
jmeter-docs inspect ./load-test.jmx --json
```

## How it works

- Fetches the 27 user manual pages from jmeter.apache.org, 6 at a time, the first time a search or lookup runs. Pages are cached on disk (see `JMETER_DOCS_CACHE_DIR`) and refreshed after `JMETER_DOCS_CACHE_TTL_HOURS` (default 168). A stale copy is used if the site is unreachable.
- Converts each page to markdown and splits it at `h1`/`h2`, so every component and function is its own section with a deep link.
- Ranks sections with BM25, weighting titles and breadcrumbs above body text.
- `jmeter_docs_fetch` only fetches from `jmeter.apache.org`.
- `inspect` parses the JMX locally and never executes anything.

## Development

```sh
npm install
npm run build
npm test
```

Requires Node.js 22+.
