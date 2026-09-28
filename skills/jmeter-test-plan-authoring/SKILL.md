---
name: jmeter-test-plan-authoring
description: Create or extend Apache JMeter test plans (.jmx) for HTTP/REST load tests. Use when the user asks to write a JMeter script, build a load test for an API or website, add a login flow, correlation, CSV-driven users, think time, or assertions to a plan.
compatibility: Uses the JMeter Docs MCP server (`npx -y jmeter-docs-mcp`) for reference lookups and to validate the result with `jmeter_inspect_test_plan`.
---

# JMeter Test Plan Authoring

## Start From the Template

Copy [references/http-load-test-template.jmx](references/http-load-test-template.jmx). It is a working JMeter 5.6 plan with:

- `host`, `protocol`, `threads`, `rampup`, `duration` read from properties with defaults, so the same file runs anywhere: `jmeter -n -t plan.jmx -Jhost=staging.example.com -Jthreads=50`
- HTTP Request Defaults, Cookie Manager, and Header Manager at plan level
- A duration-based Thread Group with ramp-up
- A sampler with a response-code assertion
- A uniform random timer for think time

## JMX Structure Rules

A .jmx file is a tree in which **every test element is followed by a `<hashTree>` holding its children**. Leaf elements still need an empty `<hashTree/>`.

```xml
<HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="GET /api/items">
  ...properties...
</HTTPSamplerProxy>
<hashTree>
  <!-- children: assertions, extractors, timers scoped to this sampler -->
</hashTree>
```

- `testname` is the label that appears in results; make it unique and meaningful (`POST /login`, not `HTTP Request`).
- Set `enabled="false"` to disable an element instead of deleting it.
- Leave `HTTPSampler.domain` and `HTTPSampler.protocol` empty on samplers so they inherit from HTTP Request Defaults.
- Keep XML special characters escaped in property values (`&amp;`, `&lt;`, `&quot;`).

## Building Blocks

Look up exact property names with `jmeter_reference_lookup` before writing an element you have not used before. It returns every parameter with the GUI label. Common patterns:

| Need | Element | Placement |
|------|---------|-----------|
| JSON request body | HTTP Request with `HTTPSampler.postBodyRaw=true` + Header Manager `Content-Type: application/json` | Sampler + child header manager |
| Capture a token | JSON Extractor (`JSONPostProcessor`) or Regular Expression Extractor | Child of the sampler that returns it |
| Per-user test data | CSV Data Set Config with a relative path | Thread Group level |
| Pace to a target RPS | Constant Throughput Timer or Throughput Shaping plugin | Thread Group level |
| Group steps into a transaction | Transaction Controller | Parent of the steps |
| Custom logic | JSR223 element, Groovy, read variables with `vars.get("x")` | Where needed; never BeanShell |

## Before Handing Over

1. Run `jmeter_inspect_test_plan` on the file you wrote. Fix every warning, and fix suggestions unless the user wants otherwise.
2. Tell the user how to run it in non-GUI mode, including the `-J` properties the plan reads.
3. Remind them to open it once in the JMeter GUI if they plan to maintain it visually. JMeter re-saves it in its canonical format.
