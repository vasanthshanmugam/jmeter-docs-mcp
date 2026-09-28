# Security

Please report security issues privately through [GitHub security advisories](https://github.com/vasanthshanmugam/jmeter-docs-mcp/security/advisories/new) rather than public issues.

Design constraints worth knowing when you report:

- `jmeter_docs_fetch` only requests URLs on `jmeter.apache.org` (or the host in `JMETER_DOCS_BASE_URL`).
- `jmeter_inspect_test_plan` only reads the `.jmx` file it is given. It never executes the plan or any script inside it.
- The server makes no other network calls and stores only cached documentation pages.
