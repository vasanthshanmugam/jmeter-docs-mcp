import * as cheerio from "cheerio";
import TurndownService from "turndown";

export interface DocSection {
  /** Absolute URL of the section, including its primary anchor when it has one. */
  url: string;
  /** Page file name, e.g. `component_reference.html`. */
  page: string;
  pageTitle: string;
  title: string;
  level: number;
  /** Primary anchor first, followed by any nested anchors folded into this section. */
  anchors: string[];
  /** Titles of enclosing headings, outermost first. */
  breadcrumbs: string[];
  markdown: string;
}

export interface ParsedPage {
  url: string;
  page: string;
  title: string;
  markdown: string;
  sections: DocSection[];
}

export interface PropertyEntry {
  name: string;
  url: string;
  group: string;
  markdown: string;
}

const CONTENT_SELECTORS = ["#content", "div.main", "main", "body"];
const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "a.sectionlink",
  "div.go-top",
  "div.clear",
  "div.screenshot",
  "div.share-links",
  "div.social-media",
  "img",
];

// Private-use markers survive turndown untouched and never appear in the docs.
const ANCHOR_OPEN = "";
const ANCHOR_CLOSE = "";
const ANCHOR_PATTERN = new RegExp(`${ANCHOR_OPEN}(\\d+)${ANCHOR_CLOSE}`, "g");

/** Headings at or above this level start a new section; deeper headings stay inside their parent. */
const SECTION_SPLIT_LEVEL = 2;

let turndown: TurndownService | undefined;

function getTurndown(): TurndownService {
  if (turndown) {
    return turndown;
  }
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  // The docs are consumed by agents, so readable identifiers (`__Random`, `jmeter.save.*`)
  // matter more than escaping every markdown-significant character.
  service.escape = (text: string) => text;
  service.addRule("definitionTerm", {
    filter: ["dt"],
    replacement: (content) => `\n**${content.trim()}**\n`,
  });
  service.addRule("definitionDescription", {
    filter: ["dd"],
    replacement: (content) => `: ${content.trim()}\n`,
  });
  turndown = service;
  return service;
}

function pageNameFromUrl(url: string): string {
  const { pathname } = new URL(url);
  return pathname.split("/").filter(Boolean).pop() ?? "index.html";
}

function cleanPageTitle(raw: string): string {
  return raw
    .replace(/^Apache JMeter\s*-\s*/i, "")
    .replace(/^User'?s Manual:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Rewrites JMeter's reference-specific markup into plain HTML that converts cleanly:
 * attribute tables become definition-style lists, notes become blockquotes, and inline
 * `span.code` becomes `<code>`.
 */
function simplifyMarkup($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>, baseUrl: string): void {
  root.find(NOISE_SELECTORS.join(",")).remove();

  convertInlineCode($, root);

  root.find("div.property.title").remove();
  root.find("div.property").each((_, el) => {
    const property = $(el);
    const name = normalizeWhitespace(property.children(".name").text());
    const description = property.children(".description").html()?.trim() ?? "";
    const required = normalizeWhitespace(property.children(".required").text());
    const requiredText = required ? ` <em>(required: ${required})</em>` : "";
    property.replaceWith(`<li><strong>${name}</strong>${requiredText} — ${description}</li>`);
  });
  root.find("div.properties").each((_, el) => {
    const block = $(el);
    const items = block.children("li");
    if (items.length > 0) {
      items.wrapAll("<ul></ul>");
    }
  });

  root.find("div.note").each((_, el) => {
    const note = $(el);
    note.replaceWith(`<blockquote><p><strong>Note:</strong> ${note.html() ?? ""}</p></blockquote>`);
  });
  root.find("div.example").each((_, el) => {
    const example = $(el);
    example.replaceWith(`<blockquote>${example.html() ?? ""}</blockquote>`);
  });

  root.find("a[href]").each((_, el) => {
    const link = $(el);
    const href = link.attr("href") ?? "";
    if (!href || href === "#") {
      link.replaceWith(link.text());
      return;
    }
    try {
      link.attr("href", new URL(href, baseUrl).toString());
    } catch {
      // Leave unparseable hrefs as-is.
    }
  });
}

/**
 * Turns `span.code` into `<code>`. A link inside inline code would render as literal
 * markdown, so `<span class="code"><a>x</a></span>` becomes `<a><code>x</code></a>`.
 */
function convertInlineCode($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>): void {
  root.find("span.code").each((_, el) => {
    const span = $(el);
    const link = span.children("a[href]");
    if (link.length === 1 && span.contents().length === 1) {
      const code = $("<code></code>").text(link.text());
      link.empty().append(code);
      span.replaceWith(link);
      return;
    }
    if (span.find("a").length > 0) {
      return;
    }
    el.tagName = "code";
  });
}

function headingAnchor($: cheerio.CheerioAPI, heading: cheerio.Cheerio<any>): string | undefined {
  const own = heading.attr("id");
  if (own) {
    return own;
  }
  const named = heading.find("a[name], a[id]").first();
  const fromChild = named.attr("name") ?? named.attr("id");
  if (fromChild) {
    return fromChild;
  }
  const previous = heading.prev();
  if (previous.is("a[name]") && !previous.text().trim()) {
    return previous.attr("name");
  }
  const parent = heading.parent();
  if (parent.attr("id") && parent.children().first().is(heading)) {
    return parent.attr("id");
  }
  return undefined;
}

/**
 * Converts a JMeter documentation page into markdown and splits it into sections.
 * Headings are tagged with their HTML anchors before conversion so that each
 * section can link back to the exact place in the live docs.
 */
export function parseDocPage(html: string, url: string): ParsedPage {
  const $ = cheerio.load(html);
  const pageTitle = cleanPageTitle($("title").first().text()) || pageNameFromUrl(url);

  let root = $(CONTENT_SELECTORS[0]).first();
  for (const selector of CONTENT_SELECTORS) {
    root = $(selector).first();
    if (root.length > 0) {
      break;
    }
  }

  simplifyMarkup($, root, url);

  const anchors: string[] = [];
  root.find("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const heading = $(el);
    const anchor = headingAnchor($, heading);
    if (anchor) {
      anchors.push(anchor);
      heading.prepend(`${ANCHOR_OPEN}${anchors.length - 1}${ANCHOR_CLOSE}`);
    }
  });

  const rawMarkdown = getTurndown().turndown(root.html() ?? "");
  const markdown = tidyMarkdown(rawMarkdown);
  const page = pageNameFromUrl(url);
  const sections = splitSections(markdown, anchors, { url, page, pageTitle });

  return {
    url,
    page,
    title: pageTitle,
    markdown: stripAnchorMarkers(markdown),
    sections,
  };
}

function tidyMarkdown(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripAnchorMarkers(text: string): string {
  return text.replace(ANCHOR_PATTERN, "").replace(/^(#{1,6})\s+/gm, "$1 ");
}

interface SectionContext {
  url: string;
  page: string;
  pageTitle: string;
}

interface Heading {
  level: number;
  title: string;
  anchors: string[];
}

function parseHeading(line: string, anchors: string[]): Heading | undefined {
  const match = /^(#{1,6})\s+(.*)$/.exec(line);
  if (!match) {
    return undefined;
  }
  const found: string[] = [];
  const title = match[2]
    .replace(ANCHOR_PATTERN, (_, index: string) => {
      const anchor = anchors[Number(index)];
      if (anchor) {
        found.push(anchor);
      }
      return "";
    })
    .trim();
  return { level: match[1].length, title, anchors: found };
}

export function splitSections(markdown: string, anchors: string[], context: SectionContext): DocSection[] {
  const sections: DocSection[] = [];
  const stack: Heading[] = [];
  const baseUrl = context.url.split("#")[0];

  let current: { heading: Heading; breadcrumbs: string[]; lines: string[]; anchors: string[] } | undefined;
  let preamble: string[] = [];
  let inFence = false;

  const flush = () => {
    if (!current) {
      return;
    }
    const body = tidyMarkdown(current.lines.join("\n"));
    const primary = current.anchors[0] ?? nearestAnchor(stack);
    sections.push({
      url: primary ? `${baseUrl}#${primary}` : baseUrl,
      page: context.page,
      pageTitle: context.pageTitle,
      title: current.heading.title,
      level: current.heading.level,
      anchors: current.anchors,
      breadcrumbs: current.breadcrumbs,
      markdown: body,
    });
    current = undefined;
  };

  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
    }
    const heading = inFence ? undefined : parseHeading(line, anchors);

    if (heading && heading.level <= SECTION_SPLIT_LEVEL) {
      flush();
      while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
        stack.pop();
      }
      current = {
        heading,
        breadcrumbs: stack.map((entry) => entry.title),
        lines: [`${"#".repeat(heading.level)} ${heading.title}`],
        anchors: [...heading.anchors],
      };
      stack.push(heading);
      continue;
    }

    const cleanLine = heading ? `${"#".repeat(heading.level)} ${heading.title}` : line;
    if (current) {
      current.lines.push(cleanLine);
      if (heading) {
        current.anchors.push(...heading.anchors);
      }
    } else {
      preamble.push(cleanLine);
    }
  }
  flush();

  const intro = tidyMarkdown(preamble.join("\n"));
  if (intro) {
    sections.unshift({
      url: baseUrl,
      page: context.page,
      pageTitle: context.pageTitle,
      title: context.pageTitle,
      level: 0,
      anchors: [],
      breadcrumbs: [],
      markdown: intro,
    });
  }

  return sections.filter((section) => section.markdown.replace(/^#.*$/m, "").trim().length > 0);
}

function nearestAnchor(stack: Heading[]): string | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const anchor = stack[index].anchors[0];
    if (anchor) {
      return anchor;
    }
  }
  return undefined;
}

/**
 * Extracts individual property definitions from `properties_reference.html`, so a single
 * property such as `jmeter.save.saveservice.output_format` can be looked up directly.
 */
export function extractPropertyEntries(html: string, url: string): PropertyEntry[] {
  const $ = cheerio.load(html);
  const entries: PropertyEntry[] = [];
  const service = getTurndown();
  const baseUrl = url.split("#")[0];

  $("div.property")
    .not(".title")
    .each((_, el) => {
      const property = $(el);
      const name = normalizeWhitespace(property.children(".name").text());
      if (!name) {
        return;
      }
      const descriptionElement = property.children(".description").clone();
      convertInlineCode($, descriptionElement);
      const description = tidyMarkdown(service.turndown(descriptionElement.html() ?? ""));
      const groupHeading = property.closest("div.properties").prevAll("h1, h2, h3").first();
      const sectionHeading = property.closest("div.section, div.subsection").find("h1, h2").first();
      const heading = groupHeading.length > 0 ? groupHeading : sectionHeading;
      const anchor = heading.attr("id") ?? property.parents("[id]").first().attr("id");
      const group = normalizeWhitespace(heading.text().replace("¶", "")) || "Properties";

      entries.push({
        name,
        url: anchor ? `${baseUrl}#${anchor}` : baseUrl,
        group,
        markdown: `### ${name}\n\nGroup: ${group}\n\n${description}`,
      });
    });

  return entries;
}
