import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { fetchDoc, lookupReference, searchDocs } from "./docs/library.js";
import { formatFetchResult, formatLookupResult, formatSearchResults } from "./format.js";
import { formatInspection, inspectJmxFile } from "./jmx/inspect.js";
import { VERSION } from "./version.js";

export const SERVER_INSTRUCTIONS = `# JMeter Docs MCP Server

Gives structured access to the official Apache JMeter user manual (https://jmeter.apache.org/usermanual/)
and inspects local JMeter test plans.

## Tools

- jmeter_docs_search: search the whole user manual (getting started, test plan building, component
  reference, functions, properties, best practices, distributed testing, dashboards). Start here.
- jmeter_reference_lookup: get the full reference entry for one component (e.g. "JSON Extractor",
  "Throughput Controller"), function (e.g. "__Random", "__time") or property
  (e.g. "jmeter.save.saveservice.output_format"), including every parameter.
- jmeter_docs_fetch: fetch a full user manual page, or one section of it, as markdown.
- jmeter_inspect_test_plan: outline a local .jmx file and flag common problems that affect
  load-test results (GUI listeners left on, BeanShell, missing timers or assertions, and more).

## Workflow

1. Use jmeter_docs_search for concepts and how-to questions.
2. Use jmeter_reference_lookup when you know the component or function name and need exact parameters.
3. Use jmeter_docs_fetch when you need a complete tutorial or the search excerpt is cut off.
4. Use jmeter_inspect_test_plan before reviewing, editing, or explaining a user's .jmx file.

Always cite the documentation URLs you relied on.`;

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "jmeter-docs", version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "jmeter_docs_search",
    {
      title: "Search the JMeter user manual",
      description:
        "Search the official Apache JMeter user manual and return the most relevant sections with title, URL, and excerpt. Use first for any JMeter concept, configuration, or how-to question.",
      inputSchema: {
        query: z.string().min(1).describe("What to search for, e.g. 'extract value from JSON response' or 'distributed testing firewall ports'."),
        limit: z.number().int().min(1).max(20).optional().describe("Maximum number of results (default 5)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit }) => {
      try {
        const { results, warnings } = await searchDocs(query, limit ?? 5);
        return textResult(formatSearchResults(query, results, warnings));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "jmeter_reference_lookup",
    {
      title: "Look up a JMeter component, function, or property",
      description:
        "Return the complete official reference entry for a JMeter test element (sampler, controller, config element, timer, assertion, pre/post processor, listener), a built-in function such as __Random or __time, or a jmeter.properties setting.",
      inputSchema: {
        name: z.string().min(1).describe("Name to look up, e.g. 'HTTP Request', 'JSON Extractor', '__CSVRead', 'jmeter.save.saveservice.output_format'."),
        kind: z.enum(["component", "function", "property"]).optional().describe("Restrict the lookup to one kind of reference entry."),
        maxChars: z.number().int().min(500).optional().describe("Truncate the entry to about this many characters (default 15000)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name, kind, maxChars }) => {
      try {
        return textResult(formatLookupResult(await lookupReference(name, kind, maxChars ?? 15_000)));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "jmeter_docs_fetch",
    {
      title: "Fetch a JMeter documentation page",
      description:
        "Fetch a page from jmeter.apache.org as markdown. Accepts a full URL or a user manual page name (e.g. 'best-practices.html' or 'component_reference.html#HTTP_Request'). A #anchor or the section parameter returns just that section.",
      inputSchema: {
        url: z.string().min(1).describe("jmeter.apache.org URL or user manual page name, optionally with #anchor."),
        section: z.string().optional().describe("Return only the section whose heading or anchor matches this text."),
        maxChars: z.number().int().min(500).optional().describe("Truncate output to about this many characters (default 40000)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ url, section, maxChars }) => {
      try {
        return textResult(formatFetchResult(await fetchDoc(url, { section, maxChars: maxChars ?? 40_000 })));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "jmeter_inspect_test_plan",
    {
      title: "Inspect a JMeter test plan",
      description:
        "Parse a local .jmx test plan and return its element tree (thread groups, samplers, timers, extractors, listeners with key settings) plus best-practice findings. Read-only; never runs the test.",
      inputSchema: {
        path: z.string().min(1).describe("Path to the .jmx file."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path }) => {
      try {
        return textResult(formatInspection(await inspectJmxFile(path)));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}

export async function startStdioServer(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
