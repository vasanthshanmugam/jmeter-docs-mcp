import type { FetchResult, LookupResult, SearchResult } from "./docs/library.js";

export function formatSearchResults(query: string, results: SearchResult[], warnings: string[] = []): string {
  const lines: string[] = [];
  if (results.length === 0) {
    lines.push(`No JMeter documentation matched "${query}". Try different keywords, or a component name with jmeter_reference_lookup.`);
  }
  results.forEach((result, index) => {
    const trail = [result.page, ...result.breadcrumbs].filter(Boolean).join(" › ");
    lines.push(`## ${index + 1}. ${result.title}`, `URL: ${result.url}`, `Location: ${trail}`, "", result.excerpt, "");
  });
  for (const warning of warnings) {
    lines.push(`> Note: ${warning}`);
  }
  return lines.join("\n").trim();
}

export function formatFetchResult(result: FetchResult): string {
  const header = [`Source: ${result.url}`];
  if (result.stale) {
    header.push("Note: served from an expired local cache because jmeter.apache.org could not be reached.");
  }
  if (result.truncated) {
    header.push("Note: content truncated; raise maxChars or fetch a specific section.");
  }
  return `${header.join("\n")}\n\n${result.markdown}`;
}

export function formatLookupResult(result: LookupResult): string {
  const lines = [`Source (${result.kind}): ${result.url}`, "", result.markdown];
  if (result.truncated) {
    lines.push("", "Note: content truncated; fetch the source URL with jmeter_docs_fetch for the full section.");
  }
  if (result.alternatives.length > 0) {
    lines.push("", "Other close matches:");
    for (const alternative of result.alternatives) {
      lines.push(`- ${alternative.title}: ${alternative.url}`);
    }
  }
  return lines.join("\n");
}
