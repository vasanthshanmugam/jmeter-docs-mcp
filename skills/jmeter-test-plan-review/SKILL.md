---
name: jmeter-test-plan-review
description: Review, explain, or troubleshoot an existing Apache JMeter test plan (.jmx). Use when the user shares or points to a .jmx file and asks what it does, why results look wrong, why JMeter runs out of memory or cannot generate enough load, or whether the plan follows best practices.
compatibility: Uses `jmeter_inspect_test_plan` from the JMeter Docs MCP server (`npx -y jmeter-docs-mcp`); CLI fallback is `npx jmeter-docs-mcp inspect <file.jmx>`.
---

# JMeter Test Plan Review

## Workflow

1. **Inspect first.** Call `jmeter_inspect_test_plan` with the .jmx path. It returns the element tree with key settings (threads, ramp-up, loops, duration, HTTP method and URL, timers, extractors) and a list of findings. Do not try to read raw JMX XML by eye first; the tree is far easier to reason about.
2. **Explain the flow** in plain language: which thread groups run, what each user does per iteration, where data comes from (CSV Data Set, variables, properties), and how the load is shaped.
3. **Triage findings** by impact on the user's goal:
   - *Result accuracy*: missing assertions, missing timers, functional test mode, wrong scoping of extractors or timers.
   - *Load generator health*: GUI listeners (View Results Tree), BeanShell, JSR223 scripts with inline `${...}`, Debug elements.
   - *Portability*: hard-coded hosts, absolute CSV paths, values that should be `${__P(...)}` properties.
4. **Back each recommendation with the docs.** Use `jmeter_reference_lookup` for the component involved, or `jmeter_docs_search` (for example "best practices reducing resource requirements"), and link the section.
5. **Propose concrete edits**: name the element, the field, and the new value as they appear in the JMeter GUI. If you edit the .jmx directly, keep the `element` + `<hashTree>` pairing intact and re-run the inspection afterwards.

## Scoping Rules to Check

JMeter applies timers, assertions, pre/post-processors, and config elements to every sampler **in their scope**:

- As a child of a sampler, they apply only to that sampler.
- As a child of a controller or thread group, they apply to every sampler below it. A timer at thread-group level delays **every** request.
- Config elements (HTTP Request Defaults, Header Manager, Cookie Manager) are inherited downward, and the closest one wins.

Look up "scoping rules" in the docs when the user's issue is about an element applying too often or not at all.

## Running the Test

This server does not run tests. Recommend non-GUI mode:

```sh
jmeter -n -t plan.jmx -l results.jtl -e -o report/ -Jthreads=50 -Jduration=600
```
