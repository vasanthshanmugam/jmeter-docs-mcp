#!/usr/bin/env node
import { Command, InvalidArgumentError, Option } from "commander";

import { clearCache, getCacheDir } from "./docs/cache.js";
import { fetchDoc, listSections, lookupReference, searchDocs } from "./docs/library.js";
import type { ReferenceKind } from "./docs/pages.js";
import { formatFetchResult, formatLookupResult, formatSearchResults } from "./format.js";
import { formatInspection, inspectJmxFile } from "./jmx/inspect.js";
import { startStdioServer } from "./server.js";
import { VERSION } from "./version.js";

function positiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("Expected a positive integer.");
  }
  return parsed;
}

async function run(action: () => Promise<string>): Promise<void> {
  try {
    process.stdout.write(`${await action()}\n`);
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name("jmeter-docs")
    .description("Search the Apache JMeter user manual and inspect .jmx test plans. Run with no command to start the MCP server over stdio.")
    .version(VERSION);

  program
    .command("serve", { isDefault: true })
    .description("Start the MCP server over stdio (default when no command is given)")
    .action(async () => {
      if (process.stdin.isTTY) {
        process.stderr.write("jmeter-docs MCP server running on stdio. Configure it in an MCP client, or run `jmeter-docs --help` for CLI commands.\n");
      }
      await startStdioServer();
    });

  program
    .command("search")
    .description("Search the JMeter user manual")
    .argument("<query...>", "search terms")
    .option("-n, --limit <number>", "maximum number of results", positiveInt, 5)
    .option("--json", "print JSON")
    .action((query: string[], options: { limit: number; json?: boolean }) =>
      run(async () => {
        const text = query.join(" ");
        const { results, warnings } = await searchDocs(text, options.limit);
        return options.json ? JSON.stringify({ results, warnings }, null, 2) : formatSearchResults(text, results, warnings);
      }),
    );

  program
    .command("lookup")
    .description("Show the reference entry for a component, function, or property")
    .argument("<name...>", "e.g. \"JSON Extractor\", __Random, jmeter.save.saveservice.output_format")
    .addOption(new Option("-k, --kind <kind>", "restrict to one kind").choices(["component", "function", "property"]))
    .option("--max-chars <number>", "truncate output", positiveInt)
    .option("--json", "print JSON")
    .action((name: string[], options: { kind?: ReferenceKind; maxChars?: number; json?: boolean }) =>
      run(async () => {
        const result = await lookupReference(name.join(" "), options.kind, options.maxChars);
        return options.json ? JSON.stringify(result, null, 2) : formatLookupResult(result);
      }),
    );

  program
    .command("fetch")
    .description("Fetch a jmeter.apache.org page (or one section) as markdown")
    .argument("<url>", "URL or user manual page, e.g. best-practices.html or component_reference.html#HTTP_Request")
    .option("-s, --section <heading>", "only return the section with this heading or anchor")
    .option("--max-chars <number>", "truncate output", positiveInt)
    .option("--json", "print JSON")
    .action((url: string, options: { section?: string; maxChars?: number; json?: boolean }) =>
      run(async () => {
        const result = await fetchDoc(url, options);
        return options.json ? JSON.stringify(result, null, 2) : formatFetchResult(result);
      }),
    );

  program
    .command("sections")
    .description("List indexed sections, optionally for one page (e.g. functions.html)")
    .argument("[page]", "user manual page file name")
    .action((page?: string) =>
      run(async () => {
        const sections = await listSections(page);
        return sections.map((section) => `${section.title}\t${section.url}`).join("\n");
      }),
    );

  program
    .command("inspect")
    .description("Outline a .jmx test plan and report best-practice findings")
    .argument("<file>", "path to a .jmx file")
    .option("--json", "print JSON")
    .action((file: string, options: { json?: boolean }) =>
      run(async () => {
        const result = await inspectJmxFile(file);
        return options.json ? JSON.stringify(result, null, 2) : formatInspection(result);
      }),
    );

  program
    .command("clear-cache")
    .description(`Delete cached documentation pages (${getCacheDir()})`)
    .action(() => run(async () => `Removed ${await clearCache()}`));

  return program;
}

await createProgram().parseAsync(process.argv);
