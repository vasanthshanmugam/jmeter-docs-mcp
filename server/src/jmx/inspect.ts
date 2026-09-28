import { readFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";

export interface JmxElement {
  tag: string;
  testclass: string;
  guiclass: string;
  name: string;
  /** False when this element or any ancestor is disabled. */
  enabled: boolean;
  props: Record<string, string>;
  /** Numeric properties (intProp, longProp, ...) whose value is not a literal number. */
  invalidNumericProps: string[];
  children: JmxElement[];
}

export type Severity = "warning" | "info";

export interface Finding {
  severity: Severity;
  element?: string;
  message: string;
}

export interface JmxInspection {
  jmeterVersion?: string;
  elements: JmxElement[];
  findings: Finding[];
  counts: Record<string, number>;
}

type XmlNode = Record<string, unknown>;

const VALUE_PROP_TAGS = new Set(["stringProp", "intProp", "longProp", "boolProp", "doubleProp", "floatProp"]);
const NUMERIC_PROP_TAGS = new Set(["intProp", "longProp", "doubleProp", "floatProp"]);

const GUI_LISTENERS: Record<string, string> = {
  ViewResultsFullVisualizer: "View Results Tree",
  TableVisualizer: "View Results in Table",
  GraphVisualizer: "Graph Results",
  AssertionVisualizer: "Assertion Results",
  RespTimeGraphVisualizer: "Response Time Graph",
};

export async function inspectJmxFile(path: string): Promise<JmxInspection> {
  if (!/\.jmx$/i.test(path)) {
    throw new Error(`Expected a JMeter test plan (.jmx) file, got: ${path}`);
  }
  return inspectJmx(await readFile(path, "utf8"));
}

export function inspectJmx(xml: string): JmxInspection {
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    processEntities: true,
  });

  let document: XmlNode[];
  try {
    document = parser.parse(xml) as XmlNode[];
  } catch (error) {
    throw new Error(`Not a valid .jmx file: ${error instanceof Error ? error.message : String(error)}`);
  }

  const root = document.find((node) => tagOf(node) === "jmeterTestPlan");
  if (!root) {
    throw new Error("Not a JMeter test plan: missing <jmeterTestPlan> root element.");
  }
  const rootTree = childrenOf(root).find((node) => tagOf(node) === "hashTree");
  const elements = rootTree ? walkHashTree(childrenOf(rootTree), true) : [];
  const counts: Record<string, number> = {};
  forEach(elements, (element) => {
    counts[element.testclass] = (counts[element.testclass] ?? 0) + 1;
  });

  return {
    jmeterVersion: attributesOf(root).jmeter,
    elements,
    findings: lint(elements),
    counts,
  };
}

function tagOf(node: XmlNode): string | undefined {
  return Object.keys(node).find((key) => key !== ":@");
}

function childrenOf(node: XmlNode): XmlNode[] {
  const tag = tagOf(node);
  const value = tag ? node[tag] : undefined;
  return Array.isArray(value) ? (value as XmlNode[]) : [];
}

function attributesOf(node: XmlNode): Record<string, string> {
  return (node[":@"] as Record<string, string> | undefined) ?? {};
}

function textOf(node: XmlNode): string {
  return childrenOf(node)
    .map((child) => (typeof child["#text"] === "string" || typeof child["#text"] === "number" ? String(child["#text"]) : ""))
    .join("");
}

/** A JMX `hashTree` alternates each test element with a `hashTree` holding its children. */
function walkHashTree(items: XmlNode[], parentEnabled: boolean): JmxElement[] {
  const nodes = items.filter((node) => tagOf(node) !== "#text");
  const elements: JmxElement[] = [];

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const tag = tagOf(node);
    if (!tag || tag === "hashTree") {
      continue;
    }
    const attributes = attributesOf(node);
    const enabled = parentEnabled && attributes.enabled !== "false";
    const next = nodes[index + 1];
    const children = next && tagOf(next) === "hashTree" ? walkHashTree(childrenOf(next), enabled) : [];
    const invalidNumericProps: string[] = [];

    elements.push({
      tag,
      testclass: attributes.testclass ?? tag,
      guiclass: attributes.guiclass ?? "",
      name: attributes.testname ?? tag,
      enabled,
      props: collectProps(childrenOf(node), {}, invalidNumericProps),
      invalidNumericProps,
      children,
    });
  }

  return elements;
}

function collectProps(nodes: XmlNode[], into: Record<string, string>, invalidNumeric: string[]): Record<string, string> {
  for (const node of nodes) {
    const tag = tagOf(node);
    if (!tag) {
      continue;
    }
    const name = attributesOf(node).name;
    if (VALUE_PROP_TAGS.has(tag) && name) {
      const value = textOf(node);
      into[name] = value;
      if (NUMERIC_PROP_TAGS.has(tag) && value.trim() !== "" && !Number.isFinite(Number(value))) {
        invalidNumeric.push(`${tag} ${name}="${value}"`);
      }
    } else if (tag === "elementProp") {
      collectProps(childrenOf(node), into, invalidNumeric);
    } else if (tag === "collectionProp" && name) {
      into[name] = `[${childrenOf(node).filter((child) => tagOf(child) !== "#text").length} items]`;
    }
  }
  return into;
}

export function forEach(elements: JmxElement[], visit: (element: JmxElement, depth: number) => void, depth = 0): void {
  for (const element of elements) {
    visit(element, depth);
    forEach(element.children, visit, depth + 1);
  }
}

function isThreadGroup(element: JmxElement): boolean {
  return /ThreadGroup$/.test(element.testclass) && element.testclass !== "SetupThreadGroup" && element.testclass !== "PostThreadGroup";
}

function isAbsolutePath(path: string): boolean {
  return /^([a-zA-Z]:[\\/]|\/|\\\\)/.test(path);
}

function lint(elements: JmxElement[]): Finding[] {
  const findings: Finding[] = [];
  const enabled: JmxElement[] = [];
  let disabledCount = 0;
  forEach(elements, (element) => {
    if (element.enabled) {
      enabled.push(element);
    } else {
      disabledCount += 1;
    }
  });

  const has = (predicate: (element: JmxElement) => boolean) => enabled.some(predicate);
  const threadGroups = enabled.filter(isThreadGroup);
  const httpSamplers = enabled.filter((element) => element.testclass === "HTTPSamplerProxy");

  if (threadGroups.length === 0) {
    findings.push({ severity: "warning", message: "No enabled Thread Group: the plan will not generate any load." });
  }

  // JMeter refuses to load the whole file, so check disabled elements too.
  forEach(elements, (element) => {
    if (element.invalidNumericProps.length > 0) {
      findings.push({
        severity: "warning",
        element: `${element.name} [${element.testclass}]`,
        message: `JMeter will fail to open this plan: ${element.invalidNumericProps.join(", ")} is not a number. Use <stringProp> for values that contain \${...} expressions.`,
      });
    }
  });

  for (const element of enabled) {
    const label = `${element.name} [${element.testclass}]`;

    if (element.testclass === "TestPlan" && element.props["TestPlan.functional_mode"] === "true") {
      findings.push({
        severity: "warning",
        element: label,
        message: "Functional Test Mode is on. It saves every response to the results file and seriously hurts performance; turn it off for load tests.",
      });
    }

    if (element.testclass === "ResultCollector" && GUI_LISTENERS[element.guiclass]) {
      findings.push({
        severity: element.guiclass === "ViewResultsFullVisualizer" ? "warning" : "info",
        element: label,
        message: `${GUI_LISTENERS[element.guiclass]} listener is enabled. GUI listeners use a lot of memory and CPU under load; disable it and run in non-GUI mode with -l results.jtl -e -o report/.`,
      });
    }

    if (element.testclass === "DebugSampler" || element.testclass === "DebugPostProcessor") {
      findings.push({
        severity: "warning",
        element: label,
        message: "Debug element is enabled. Keep it for scripting only and disable it before running load.",
      });
    }

    if (element.testclass.startsWith("BeanShell")) {
      findings.push({
        severity: "warning",
        element: label,
        message: "BeanShell elements are slow under load. Migrate to the matching JSR223 element with the Groovy language.",
      });
    }

    if (element.testclass.startsWith("JSR223")) {
      const language = (element.props.scriptLanguage ?? "groovy").toLowerCase();
      const script = element.props.script ?? "";
      if (language && language !== "groovy") {
        findings.push({
          severity: "info",
          element: label,
          message: `JSR223 element uses "${language}". Groovy is the recommended language because it compiles and caches scripts.`,
        });
      }
      if (/\$\{[^}]+\}/.test(script)) {
        findings.push({
          severity: "warning",
          element: label,
          message: "Script embeds ${...} variables directly. That defeats compilation caching and can cause code injection; read values with vars.get(\"name\") instead.",
        });
      }
      if (element.props.cacheKey === "false") {
        findings.push({
          severity: "info",
          element: label,
          message: "\"Cache compiled script if available\" is unchecked; enable it so the script is not recompiled on every iteration.",
        });
      }
    }

    if (isThreadGroup(element)) {
      const loops = element.props["LoopController.loops"];
      const scheduler = element.props["ThreadGroup.scheduler"] === "true";
      const duration = element.props["ThreadGroup.duration"];
      if (element.testclass === "ThreadGroup" && loops === "-1" && !(scheduler && duration)) {
        findings.push({
          severity: "warning",
          element: label,
          message: "Loops forever with no duration set, so the test only stops when interrupted. Set Duration (scheduler) or a loop count.",
        });
      }
      const threads = Number(element.props["ThreadGroup.num_threads"]);
      const ramp = Number(element.props["ThreadGroup.ramp_time"]);
      if (Number.isFinite(threads) && threads >= 50 && Number.isFinite(ramp) && ramp === 0) {
        findings.push({
          severity: "info",
          element: label,
          message: `Starts all ${threads} threads at once (ramp-up 0). Consider a ramp-up so the system under test warms up gradually.`,
        });
      }
    }

    if (element.testclass === "CSVDataSet") {
      const filename = element.props.filename ?? "";
      if (filename && isAbsolutePath(filename) && !filename.includes("${")) {
        findings.push({
          severity: "info",
          element: label,
          message: `CSV file uses an absolute path (${filename}). Use a path relative to the .jmx or a property like \${__P(dataDir)} so the plan runs on other machines and load generators.`,
        });
      }
    }
  }

  if (threadGroups.length > 0 && !has((element) => /Timer$/.test(element.testclass))) {
    findings.push({
      severity: "info",
      message: "No timers: each thread sends requests back to back with no think time, which usually overstates load per user.",
    });
  }

  if (threadGroups.length > 0 && !has((element) => /Assertion$/.test(element.testclass))) {
    findings.push({
      severity: "info",
      message: "No assertions: only transport-level failures count as errors. Add a Response Assertion or JSON Assertion so functional failures show up.",
    });
  }

  if (httpSamplers.length > 0) {
    const hasDefaults = has((element) => element.testclass === "ConfigTestElement" && element.guiclass === "HttpDefaultsGui");
    const literalHosts = new Set(
      httpSamplers
        .map((sampler) => sampler.props["HTTPSampler.domain"] ?? "")
        .filter((domain) => domain && !domain.includes("${")),
    );
    if (!hasDefaults && literalHosts.size > 0 && httpSamplers.length > 1) {
      findings.push({
        severity: "info",
        message: `HTTP samplers hard-code ${[...literalHosts].join(", ")}. Put protocol/host/port in HTTP Request Defaults, ideally from a property such as \${__P(host,${[...literalHosts][0]})}, so you can switch environments from the command line.`,
      });
    }
    if (!has((element) => element.testclass === "CookieManager")) {
      findings.push({
        severity: "info",
        message: "HTTP samplers but no HTTP Cookie Manager: session cookies will not be kept between requests.",
      });
    }
  }

  if (disabledCount > 0) {
    findings.push({ severity: "info", message: `${disabledCount} element(s) are disabled (directly or through a disabled parent).` });
  }

  return findings;
}

/** A one-line description of the settings that matter most for each element type. */
export function describeElement(element: JmxElement): string {
  const props = element.props;
  switch (element.testclass) {
    case "ThreadGroup":
    case "SetupThreadGroup":
    case "PostThreadGroup": {
      const loops = props["LoopController.loops"];
      const parts = [`threads=${props["ThreadGroup.num_threads"] ?? "?"}`, `ramp-up=${props["ThreadGroup.ramp_time"] ?? "?"}s`];
      if (loops !== undefined) {
        parts.push(`loops=${loops === "-1" ? "infinite" : loops}`);
      }
      if (props["ThreadGroup.scheduler"] === "true" && props["ThreadGroup.duration"]) {
        parts.push(`duration=${props["ThreadGroup.duration"]}s`);
      }
      return parts.join(", ");
    }
    case "HTTPSamplerProxy": {
      const protocol = props["HTTPSampler.protocol"] || "";
      const domain = props["HTTPSampler.domain"] || "";
      const port = props["HTTPSampler.port"] ? `:${props["HTTPSampler.port"]}` : "";
      const host = domain ? `${protocol ? `${protocol}://` : ""}${domain}${port}` : "";
      return `${props["HTTPSampler.method"] || "GET"} ${host}${props["HTTPSampler.path"] ?? ""}`.trim();
    }
    case "CSVDataSet":
      return `file=${props.filename ?? "?"}, variables=${props.variableNames || "(from header)"}`;
    case "ConstantTimer":
      return `delay=${props["ConstantTimer.delay"] ?? "?"}ms`;
    case "UniformRandomTimer":
    case "GaussianRandomTimer":
      return `delay=${props["ConstantTimer.delay"] ?? "?"}ms, range=${props["RandomTimer.range"] ?? "?"}ms`;
    case "ConstantThroughputTimer":
      return `throughput=${props.throughput ?? "?"}/min`;
    case "RegexExtractor":
      return `var=${props["RegexExtractor.refname"] ?? "?"}, regex=${props["RegexExtractor.regex"] ?? "?"}`;
    case "JSONPostProcessor":
      return `vars=${props["JSONPostProcessor.referenceNames"] ?? "?"}, path=${props["JSONPostProcessor.jsonPathExprs"] ?? "?"}`;
    case "ResponseAssertion":
      return `field=${props["Assertion.test_field"] ?? "?"}`;
    default:
      if (element.testclass.startsWith("JSR223")) {
        return `language=${props.scriptLanguage || "groovy"}${props.filename ? `, file=${props.filename}` : ""}`;
      }
      return "";
  }
}

export function formatInspection(result: JmxInspection): string {
  const lines: string[] = [];
  lines.push(`# Test plan outline${result.jmeterVersion ? ` (saved by JMeter ${result.jmeterVersion})` : ""}`, "");

  forEach(result.elements, (element, depth) => {
    const details = describeElement(element);
    const state = element.enabled ? "" : " (disabled)";
    lines.push(`${"  ".repeat(depth)}- **${element.name}** [${element.testclass}]${state}${details ? ` — ${details}` : ""}`);
  });

  const warnings = result.findings.filter((finding) => finding.severity === "warning");
  const infos = result.findings.filter((finding) => finding.severity === "info");
  lines.push("", `# Findings (${warnings.length} warning(s), ${infos.length} suggestion(s))`, "");
  if (result.findings.length === 0) {
    lines.push("No issues found.");
  }
  for (const finding of [...warnings, ...infos]) {
    const prefix = finding.severity === "warning" ? "⚠️ Warning" : "💡 Suggestion";
    lines.push(`- ${prefix}${finding.element ? ` — ${finding.element}` : ""}: ${finding.message}`);
  }
  return lines.join("\n");
}
