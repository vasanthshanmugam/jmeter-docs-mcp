# JMeter Docs MCP Server

> Give your AI assistant (Claude, Copilot, Cursor, Codex, ...) direct access to the official Apache JMeter user manual, so it stops guessing component names, parameters, and properties.

JMeter Docs MCP is a [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI agents search the [Apache JMeter user manual](https://jmeter.apache.org/usermanual/), pull the exact reference entry for any component, function, or property, and inspect your local `.jmx` test plans for problems that distort load-test results.

The repository also ships [agent skills](skills/) and plugin manifests for **Claude Code**, **GitHub Copilot**, and **Codex**.

> [!NOTE]
> This is a community project. It is not affiliated with or endorsed by the Apache Software Foundation. Apache JMeter and JMeter are trademarks of the Apache Software Foundation. Documentation is fetched live from jmeter.apache.org and remains under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

## ✨ What your agent can do

| Tool | What it does | Example |
|------|--------------|---------|
| `jmeter_docs_search` | Searches the whole user manual (getting started, test plan building, component reference, functions, properties, best practices, remote testing, dashboards) and returns the best sections with deep links | "How do I pace requests to 100 per second?" |
| `jmeter_reference_lookup` | Returns the complete reference entry for one component, function, or `jmeter.properties` setting, including every parameter and whether it is required | "JSON Extractor", `__time`, `jmeter.save.saveservice.output_format` |
| `jmeter_docs_fetch` | Fetches a full manual page, or one section of it, as clean markdown | `remote-test.html`, `component_reference.html#HTTP_Request` |
| `jmeter_inspect_test_plan` | Parses a local `.jmx` and returns the element tree with key settings plus best-practice findings | "Review `checkout.jmx`" |

`jmeter_inspect_test_plan` flags, among other things:

- GUI listeners such as View Results Tree left enabled
- Functional Test Mode switched on
- BeanShell elements, and JSR223 scripts with inline `${...}` or caching turned off
- Thread groups that loop forever with no duration, or start many threads with no ramp-up
- No timers, no assertions, no Cookie Manager
- Hard-coded hosts that should come from HTTP Request Defaults and `${__P(...)}` properties
- Absolute CSV file paths

It is read-only and never runs your test.

## 🔌 Installation

Requires **Node.js 22+**. The server runs locally over stdio and downloads the manual pages it needs on first use. After that it serves them from a cache, which it refreshes weekly.

### Claude Code (plugin: MCP server + skills)

```
/plugin marketplace add vasanthshanmugam/jmeter-docs-mcp
/plugin install jmeter-docs@jmeter-docs-marketplace
```

Or add just the MCP server:

```sh
claude mcp add jmeter-docs -- npx -y jmeter-docs-mcp@latest
```

### GitHub Copilot CLI (plugin)

```
/plugin install vasanthshanmugam/jmeter-docs-mcp
```

### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "jmeter-docs": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "jmeter-docs-mcp@latest"]
    }
  }
}
```

### Codex

```sh
codex mcp add jmeter-docs -- npx -y jmeter-docs-mcp@latest
```

Or open this repository in Codex and install **JMeter Docs** from `/plugins`. The repo-local marketplace in [.agents/plugins/marketplace.json](.agents/plugins/marketplace.json) registers it.

### Cursor, Claude Desktop, Windsurf, and other MCP clients

Add a stdio server to the client's MCP config:

```json
{
  "mcpServers": {
    "jmeter-docs": {
      "command": "npx",
      "args": ["-y", "jmeter-docs-mcp@latest"]
    }
  }
}
```

> [!TIP]
> On Windows, some clients cannot launch `npx` directly. Use `"command": "cmd"` with `"args": ["/c", "npx", "-y", "jmeter-docs-mcp@latest"]`.

## 🧠 Agent skills

Skills teach an agent *when* and *how* to use the tools. The plugins install them automatically. You can also copy the folders into `.claude/skills/`, `.github/skills/`, or `.agents/skills/` yourself.

| Skill | Use it for |
|-------|-----------|
| [`jmeter-docs`](skills/jmeter-docs/) | Answering JMeter questions from the official manual |
| [`jmeter-test-plan-review`](skills/jmeter-test-plan-review/) | Explaining and troubleshooting an existing `.jmx` |
| [`jmeter-test-plan-authoring`](skills/jmeter-test-plan-authoring/) | Writing new HTTP/REST test plans from a parameterized [template](skills/jmeter-test-plan-authoring/references/http-load-test-template.jmx) |

## 💻 CLI

The same package works as a command-line tool, which is handy for scripts or agents without MCP support:

```sh
npx jmeter-docs-mcp search "regular expression extractor match number"
npx jmeter-docs-mcp lookup "Constant Throughput Timer"
npx jmeter-docs-mcp lookup __Random --kind function
npx jmeter-docs-mcp fetch best-practices.html --section "Reducing resource requirements"
npx jmeter-docs-mcp inspect ./load-test.jmx
```

See [server/README.md](server/README.md) for every command and option.

## ⚙️ Configuration

| Environment variable | Default | Purpose |
|----------------------|---------|---------|
| `JMETER_DOCS_CACHE_DIR` | `%LOCALAPPDATA%\jmeter-docs-mcp\cache` or `~/.cache/jmeter-docs-mcp` | Where downloaded pages are cached |
| `JMETER_DOCS_CACHE_TTL_HOURS` | `168` | How long cached pages stay fresh. Expired pages are still used when offline. |
| `JMETER_DOCS_BASE_URL` | `https://jmeter.apache.org/usermanual/` | User manual location, for mirrors |

## 🛠️ Development

```sh
cd server
npm install
npm run build
npm test
```

Then validate the repository layout (plugin sync, skills, MCP config):

```powershell
pwsh -File scripts/validate-repo.ps1
```

See [AGENTS.md](AGENTS.md) for the repo conventions.

## 📄 License

[MIT](LICENSE)
