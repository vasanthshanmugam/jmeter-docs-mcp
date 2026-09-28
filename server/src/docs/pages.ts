/**
 * The Apache JMeter user manual pages that make up the searchable index.
 * Paths are relative to the user manual base URL.
 */
export const DEFAULT_BASE_URL = "https://jmeter.apache.org/usermanual/";

export const ALLOWED_HOSTS = new Set(["jmeter.apache.org"]);

export const MANUAL_PAGES = [
  "get-started.html",
  "build-test-plan.html",
  "test_plan.html",
  "build-web-test-plan.html",
  "build-adv-web-test-plan.html",
  "build-db-test-plan.html",
  "build-ftp-test-plan.html",
  "build-ldap-test-plan.html",
  "build-ldapext-test-plan.html",
  "build-ws-test-plan.html",
  "build-jms-point-to-point-test-plan.html",
  "build-jms-topic-test-plan.html",
  "build-programmatic-test-plan.html",
  "listeners.html",
  "remote-test.html",
  "generating-dashboard.html",
  "realtime-results.html",
  "best-practices.html",
  "boss.html",
  "component_reference.html",
  "properties_reference.html",
  "functions.html",
  "regular_expressions.html",
  "glossary.html",
  "curl.html",
  "hints_and_tips.html",
  "jmeter_proxy_step_by_step.html",
] as const;

/** Pages whose h2 sections are individual reference entries (components, functions). */
export const REFERENCE_PAGES = {
  component: "component_reference.html",
  function: "functions.html",
  property: "properties_reference.html",
} as const;

export type ReferenceKind = keyof typeof REFERENCE_PAGES;

export function getBaseUrl(): string {
  const configured = process.env.JMETER_DOCS_BASE_URL?.trim();
  const base = configured || DEFAULT_BASE_URL;
  return base.endsWith("/") ? base : `${base}/`;
}

export function pageUrl(page: string): string {
  return new URL(page, getBaseUrl()).toString();
}

/**
 * Accepts absolute URLs on an allowed host, or paths relative to the user manual
 * (for example `component_reference.html#HTTP_Request`).
 */
export function resolveDocUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("A URL or user manual page name is required.");
  }
  const url = new URL(trimmed, getBaseUrl());
  const baseHost = new URL(getBaseUrl()).host;
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported URL scheme: ${url.protocol}`);
  }
  if (!ALLOWED_HOSTS.has(url.host) && url.host !== baseHost) {
    throw new Error(
      `Only Apache JMeter documentation URLs can be fetched (host must be ${[...ALLOWED_HOSTS].join(", ")}). Got: ${url.host}`,
    );
  }
  return url;
}
