---
name: jmeter-docs
description: Answer Apache JMeter questions from the official user manual. Use whenever the user asks how a JMeter feature works, which component to use, what a component or function parameter means, which jmeter.properties setting controls something, or how to run distributed tests, generate the HTML dashboard, correlate dynamic values, or follow JMeter best practices—even if they don't mention "docs."
context: fork
compatibility: Uses the JMeter Docs MCP server (`npx -y jmeter-docs-mcp`); if it is unavailable, fall back to the same package's CLI (`npx jmeter-docs-mcp search "..."`).
---

# JMeter Docs

## Tools

| Tool | Use For |
|------|---------|
| `jmeter_docs_search` | Concepts, how-tos, tutorials, best practices across the whole user manual |
| `jmeter_reference_lookup` | The exact reference entry for one component, function, or property, with every parameter |
| `jmeter_docs_fetch` | A full page or one section when search excerpts are not enough |

## Which Tool First

- **Knows the element name** ("JSON Extractor", "Throughput Controller", `__time`, `jmeter.save.saveservice.output_format`) → `jmeter_reference_lookup`.
- **Describes a goal** ("extract a token from a response", "pace requests to 100 per second", "run tests from several machines") → `jmeter_docs_search`, then look up the component it points to.
- **Needs a whole tutorial** (building a web test plan, remote testing setup, dashboard generation) → search, then `jmeter_docs_fetch` the result URL.

## Query Effectiveness

```
# ❌ Too broad
"jmeter performance"

# ✅ Specific
"constant throughput timer calculate throughput per thread"
"regular expression extractor match number -1"
"remote testing server.rmi.ssl.disable"
```

- Use JMeter vocabulary: *sampler*, *thread group*, *timer*, *post-processor*, *assertion*, *listener*, *property*, *variable*.
- For functions, the `__` prefix is optional: `__Random` and `Random` both work.
- For properties, use the full dotted name.

## Answering

- Quote parameter names exactly as the reference shows them; they match the JMeter GUI labels.
- Say where an element must be placed in the tree when the docs specify it (for example, extractors go under the sampler whose response they read).
- Distinguish **variables** (`${name}`, per thread) from **properties** (`${__P(name)}`, global, settable with `-J`).
- Always include the documentation URLs you used.

## Why Use This

- **Current**: reads the live manual at jmeter.apache.org instead of relying on memory of older versions.
- **Exact**: reference entries list every parameter with its required/optional flag.
- **Linked**: every result carries a deep link to the exact section.

## CLI Alternative

If the MCP server is not available, run the same package as a CLI:

```sh
npx jmeter-docs-mcp search "json extractor multiple values"
npx jmeter-docs-mcp lookup "Constant Throughput Timer"
npx jmeter-docs-mcp fetch "component_reference.html#HTTP_Request"
```

| MCP Tool | CLI Command |
|----------|-------------|
| `jmeter_docs_search(query: "...")` | `jmeter-docs search "..."` |
| `jmeter_reference_lookup(name: "...")` | `jmeter-docs lookup "..."` |
| `jmeter_docs_fetch(url: "...")` | `jmeter-docs fetch "..."` |
