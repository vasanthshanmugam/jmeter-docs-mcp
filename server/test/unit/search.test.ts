import { describe, expect, it } from "vitest";

import { matchRank, truncate } from "../../src/docs/library.js";
import { SearchIndex, bestExcerpt, tokenize } from "../../src/docs/search.js";

const docs = [
  { title: "Constant Timer", breadcrumbs: ["Timers"], body: "Pause each thread for the same amount of time between requests." },
  { title: "Uniform Random Timer", breadcrumbs: ["Timers"], body: "Pause each thread for a random amount of time." },
  { title: "JSON Extractor", breadcrumbs: ["Post-Processors"], body: "Extract data from JSON responses using JSON-PATH syntax." },
  { title: "Regular Expression Extractor", breadcrumbs: ["Post-Processors"], body: "Extract values from a response using a regular expression." },
];

describe("tokenize", () => {
  it("lowercases, drops stop words, and stems plurals", () => {
    expect(tokenize("How do I use Timers in JMeter?")).toEqual(["timer"]);
    expect(tokenize("__Random")).toEqual(["random"]);
  });
});

describe("SearchIndex", () => {
  const index = new SearchIndex(docs);

  it("ranks title matches first", () => {
    const [first] = index.search("json extractor");
    expect(first.doc.title).toBe("JSON Extractor");
  });

  it("matches plural queries against singular titles", () => {
    const titles = index.search("timers").map((hit) => hit.doc.title);
    expect(titles.slice(0, 2).sort()).toEqual(["Constant Timer", "Uniform Random Timer"]);
  });

  it("returns nothing for queries made only of stop words", () => {
    expect(index.search("how to use jmeter")).toEqual([]);
  });

  it("supports filtering", () => {
    const hits = index.search("extract", 5, (doc) => doc.title.startsWith("Regular"));
    expect(hits.map((hit) => hit.doc.title)).toEqual(["Regular Expression Extractor"]);
  });
});

describe("bestExcerpt", () => {
  it("returns short bodies unchanged", () => {
    expect(bestExcerpt("## Title\n\nShort body.", "body")).toBe("Short body.");
  });

  it("centres long bodies on the query terms", () => {
    const body = `${"filler text. ".repeat(200)}The ramp-up period tells JMeter how long to take.${" more filler.".repeat(200)}`;
    const excerpt = bestExcerpt(body, "ramp-up period", 200);
    expect(excerpt).toContain("ramp-up period");
    expect(excerpt.startsWith("…")).toBe(true);
  });
});

describe("matchRank", () => {
  it("prefers exact matches, then prefixes, then substrings", () => {
    expect(matchRank("httprequest", ["HTTP Request"])).toBe(3);
    expect(matchRank("random", ["__Random"])).toBe(3);
    expect(matchRank("httprequest", ["HTTP Request Defaults"])).toBe(2);
    expect(matchRank("extractor", ["JSON Extractor"])).toBe(1);
    expect(matchRank("zzz", ["JSON Extractor"])).toBe(0);
  });
});

describe("truncate", () => {
  it("cuts on a line break and marks the output", () => {
    const { text, truncated } = truncate("line one\nline two\nline three", 20);
    expect(truncated).toBe(true);
    expect(text).toBe("line one\nline two\n\n…(truncated)");
  });
});
