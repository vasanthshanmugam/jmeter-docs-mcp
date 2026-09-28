import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { extractPropertyEntries, parseDocPage } from "../../src/docs/html.js";

const url = "https://jmeter.apache.org/usermanual/component_reference.html";
const html = readFileSync(new URL("../fixtures/component_reference.html", import.meta.url), "utf8");

describe("parseDocPage", () => {
  const page = parseDocPage(html, url);

  it("cleans the page title", () => {
    expect(page.title).toBe("Component Reference");
  });

  it("drops navigation, section links, screenshots and footer", () => {
    expect(page.markdown).not.toContain("¶");
    expect(page.markdown).not.toContain("Copyright");
    expect(page.markdown).not.toContain("http.png");
    expect(page.markdown).not.toMatch(/^\s*-\s*\[HTTP Request\]/m);
  });

  it("splits into h1/h2 sections with anchored URLs and breadcrumbs", () => {
    // "18.1 Samplers" has no text of its own, so it only appears as a breadcrumb.
    expect(page.sections.map((section) => section.title)).toEqual(["18.0 Introduction", "HTTP Request", "JSON Extractor"]);
    const http = page.sections.find((section) => section.title === "HTTP Request");
    expect(http?.url).toBe(`${url}#HTTP_Request`);
    expect(http?.breadcrumbs).toEqual(["18.1 Samplers"]);
    expect(http?.anchors).toEqual(["HTTP_Request", "HTTP_Request_parms1"]);
  });

  it("keeps nested parameter tables inside the component section", () => {
    const http = page.sections.find((section) => section.title === "HTTP Request");
    expect(http?.markdown).toContain("### Parameters");
    expect(http?.markdown).toContain("**Server Name or IP** *(required: Yes)* — Domain name or IP address");
    expect(http?.markdown).toContain("> **Note:** The default parser is `LagartoBasedHtmlParser`.");
  });

  it("makes links absolute", () => {
    const http = page.sections.find((section) => section.title === "HTTP Request");
    expect(http?.markdown).toContain("(https://jmeter.apache.org/usermanual/component_reference.html#HTTP_Request_Defaults)");
  });

  it("does not escape identifiers", () => {
    const json = page.sections.find((section) => section.title === "JSON Extractor");
    expect(json?.markdown).toContain("$.store.book[*].author");
  });

  it("keeps links clickable when they are wrapped in inline code", () => {
    const json = page.sections.find((section) => section.title === "JSON Extractor");
    expect(json?.markdown).toContain("[`__jexl3()`](https://jmeter.apache.org/usermanual/functions.html#__jexl3)");
  });
});

describe("extractPropertyEntries", () => {
  it("extracts one entry per property with its group", () => {
    const propertiesHtml = `
      <div class="main" id="content">
        <h1 id="results_file_config">19.15 Results file configuration</h1>
        <div class="properties">
          <div class="property title"><div class="name title">Attribute</div></div>
          <div class="property">
            <div class="name req-true">jmeter.save.saveservice.output_format</div>
            <div class="description req-true">Legitimate values: <span class="code">xml</span>, <span class="code">csv</span>.</div>
          </div>
        </div>
      </div>`;
    const entries = extractPropertyEntries(propertiesHtml, "https://jmeter.apache.org/usermanual/properties_reference.html");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("jmeter.save.saveservice.output_format");
    expect(entries[0].url).toBe("https://jmeter.apache.org/usermanual/properties_reference.html#results_file_config");
    expect(entries[0].markdown).toContain("`xml`, `csv`");
  });
});
