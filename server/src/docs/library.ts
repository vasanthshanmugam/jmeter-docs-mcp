import { extractPropertyEntries, parseDocPage, type DocSection, type ParsedPage, type PropertyEntry } from "./html.js";
import { fetchPage, mapWithConcurrency } from "./fetcher.js";
import { MANUAL_PAGES, REFERENCE_PAGES, pageUrl, resolveDocUrl, type ReferenceKind } from "./pages.js";
import { SearchIndex, bestExcerpt, normalizeTitle } from "./search.js";

const FETCH_CONCURRENCY = 6;

interface IndexedSection extends DocSection {
  body: string;
}

export interface DocsIndex {
  sections: IndexedSection[];
  properties: PropertyEntry[];
  search: SearchIndex<IndexedSection>;
  failures: string[];
  stalePages: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  page: string;
  breadcrumbs: string[];
  excerpt: string;
  score: number;
}

export interface FetchResult {
  url: string;
  title: string;
  markdown: string;
  truncated: boolean;
  stale: boolean;
}

export interface LookupResult {
  kind: ReferenceKind;
  title: string;
  url: string;
  markdown: string;
  truncated: boolean;
  alternatives: { title: string; url: string }[];
}

let indexPromise: Promise<DocsIndex> | undefined;

export function resetIndex(): void {
  indexPromise = undefined;
}

export function loadIndex(): Promise<DocsIndex> {
  indexPromise ??= buildIndex().catch((error) => {
    indexPromise = undefined;
    throw error;
  });
  return indexPromise;
}

async function buildIndex(): Promise<DocsIndex> {
  const results = await mapWithConcurrency(MANUAL_PAGES, FETCH_CONCURRENCY, async (page) => {
    const fetched = await fetchPage(pageUrl(page));
    const parsed = parseDocPage(fetched.html, fetched.url);
    const properties = page === REFERENCE_PAGES.property ? extractPropertyEntries(fetched.html, fetched.url) : [];
    return { page, parsed, properties, stale: fetched.stale };
  });

  const sections: IndexedSection[] = [];
  const properties: PropertyEntry[] = [];
  const failures: string[] = [];
  const stalePages: string[] = [];

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failures.push(`${MANUAL_PAGES[index]}: ${reason}`);
      return;
    }
    const { parsed, stale } = result.value;
    if (stale) {
      stalePages.push(result.value.page);
    }
    for (const section of parsed.sections) {
      sections.push({ ...section, body: section.markdown });
    }
    properties.push(...result.value.properties);
  });

  if (sections.length === 0) {
    throw new Error(
      `Could not load any JMeter documentation pages. Check network access to jmeter.apache.org.\n${failures.join("\n")}`,
    );
  }

  return { sections, properties, search: new SearchIndex(sections), failures, stalePages };
}

export async function searchDocs(query: string, limit = 5): Promise<{ results: SearchResult[]; warnings: string[] }> {
  const index = await loadIndex();
  const hits = index.search.search(query, clamp(limit, 1, 20));
  return {
    results: hits.map(({ doc, score }) => ({
      title: doc.title,
      url: doc.url,
      page: doc.pageTitle,
      breadcrumbs: doc.breadcrumbs,
      excerpt: bestExcerpt(doc.body, query),
      score: Math.round(score * 100) / 100,
    })),
    warnings: indexWarnings(index),
  };
}

export async function fetchDoc(input: string, options: { section?: string; maxChars?: number } = {}): Promise<FetchResult> {
  const url = resolveDocUrl(input);
  const anchor = decodeURIComponent(url.hash.replace(/^#/, ""));
  url.hash = "";
  const fetched = await fetchPage(url.toString());
  const parsed = parseDocPage(fetched.html, url.toString());

  let title = parsed.title;
  let markdown = parsed.markdown;
  let resolvedUrl = parsed.url;

  const section = selectSection(parsed, anchor, options.section);
  if (section) {
    title = section.title;
    markdown = section.markdown;
    resolvedUrl = section.url;
  } else if (options.section) {
    const available = parsed.sections.map((entry) => entry.title).slice(0, 40).join("; ");
    throw new Error(`No section matching "${options.section}" on ${parsed.url}. Sections include: ${available}`);
  }

  const { text, truncated } = truncate(markdown, options.maxChars);
  return { url: resolvedUrl, title, markdown: text, truncated, stale: fetched.stale };
}

function selectSection(parsed: ParsedPage, anchor: string, heading?: string): DocSection | undefined {
  if (heading) {
    const wanted = normalizeTitle(heading);
    return (
      parsed.sections.find((section) => normalizeTitle(section.title) === wanted) ??
      parsed.sections.find((section) => section.anchors.some((entry) => normalizeTitle(entry) === wanted)) ??
      parsed.sections.find((section) => normalizeTitle(section.title).includes(wanted))
    );
  }
  if (anchor) {
    return parsed.sections.find((section) => section.anchors.includes(anchor));
  }
  return undefined;
}

export async function lookupReference(name: string, kind?: ReferenceKind, maxChars?: number): Promise<LookupResult> {
  const index = await loadIndex();
  const kinds: ReferenceKind[] = kind ? [kind] : ["component", "function", "property"];
  const wanted = normalizeTitle(name);
  if (!wanted) {
    throw new Error("A component, function, or property name is required.");
  }

  type Candidate = { kind: ReferenceKind; title: string; url: string; markdown: string; rank: number };
  const candidates: Candidate[] = [];

  for (const entryKind of kinds) {
    if (entryKind === "property") {
      for (const property of index.properties) {
        const rank = matchRank(wanted, [property.name]);
        if (rank > 0) {
          candidates.push({ kind: entryKind, title: property.name, url: property.url, markdown: property.markdown, rank });
        }
      }
      continue;
    }
    const page = REFERENCE_PAGES[entryKind];
    for (const section of index.sections) {
      if (section.page !== page || section.level !== 2) {
        continue;
      }
      const rank = matchRank(wanted, [section.title, ...section.anchors.slice(0, 1)]);
      if (rank > 0) {
        candidates.push({ kind: entryKind, title: section.title, url: section.url, markdown: section.markdown, rank });
      }
    }
  }

  if (candidates.length === 0) {
    const pages = new Set<string>(kinds.filter((entry) => entry !== "property").map((entry) => REFERENCE_PAGES[entry]));
    const fallback = index.search.search(name, 5, (doc) => pages.has(doc.page) || (kinds.includes("property") && doc.page === REFERENCE_PAGES.property));
    if (fallback.length === 0) {
      throw new Error(`No JMeter ${kind ?? "component, function, or property"} matching "${name}". Try jmeter_docs_search instead.`);
    }
    const [best, ...rest] = fallback;
    const { text, truncated } = truncate(best.doc.markdown, maxChars);
    return {
      kind: kindForPage(best.doc.page),
      title: best.doc.title,
      url: best.doc.url,
      markdown: text,
      truncated,
      alternatives: rest.map(({ doc }) => ({ title: doc.title, url: doc.url })),
    };
  }

  candidates.sort((left, right) => right.rank - left.rank || left.title.length - right.title.length);
  const [best, ...rest] = candidates;
  const { text, truncated } = truncate(best.markdown, maxChars);
  return {
    kind: best.kind,
    title: best.title,
    url: best.url,
    markdown: text,
    truncated,
    alternatives: rest.slice(0, 8).map((entry) => ({ title: entry.title, url: entry.url })),
  };
}

/**
 * 3 = exact, 2 = prefix, 1 = substring. Names are normalized to lowercase alphanumerics,
 * so `__Random` matches `random` and `JSON Extractor` matches `json-extractor`.
 */
export function matchRank(wanted: string, names: string[]): number {
  let best = 0;
  for (const name of names) {
    const normalized = normalizeTitle(name);
    if (!normalized) {
      continue;
    }
    if (normalized === wanted) {
      return 3;
    }
    if (normalized.startsWith(wanted)) {
      best = Math.max(best, 2);
    } else if (wanted.length >= 4 && normalized.includes(wanted)) {
      best = Math.max(best, 1);
    }
  }
  return best;
}

function kindForPage(page: string): ReferenceKind {
  const entry = Object.entries(REFERENCE_PAGES).find(([, value]) => value === page);
  return (entry?.[0] as ReferenceKind | undefined) ?? "component";
}

export async function listSections(page?: string): Promise<{ page: string; title: string; url: string }[]> {
  const index = await loadIndex();
  return index.sections
    .filter((section) => section.level > 0 && section.level <= 2 && (!page || section.page === page))
    .map((section) => ({ page: section.page, title: section.title, url: section.url }));
}

function indexWarnings(index: DocsIndex): string[] {
  const warnings: string[] = [];
  if (index.failures.length > 0) {
    warnings.push(`Some pages could not be loaded and are missing from results: ${index.failures.join("; ")}`);
  }
  if (index.stalePages.length > 0) {
    warnings.push(`Using cached copies (network unavailable) for: ${index.stalePages.join(", ")}`);
  }
  return warnings;
}

export function truncate(text: string, maxChars?: number): { text: string; truncated: boolean } {
  if (!maxChars || maxChars <= 0 || text.length <= maxChars) {
    return { text, truncated: false };
  }
  const cut = text.lastIndexOf("\n", maxChars);
  const end = cut > maxChars * 0.6 ? cut : maxChars;
  return { text: `${text.slice(0, end).trimEnd()}\n\n…(truncated)`, truncated: true };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}
