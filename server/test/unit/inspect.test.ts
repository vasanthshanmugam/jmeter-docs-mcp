import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { formatInspection, inspectJmx } from "../../src/jmx/inspect.js";

const template = readFileSync(
  new URL("../../../skills/jmeter-test-plan-authoring/references/http-load-test-template.jmx", import.meta.url),
  "utf8",
);

function plan(threadGroupChildren: string, planChildren = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="Plan">
      <boolProp name="TestPlan.functional_mode">true</boolProp>
    </TestPlan>
    <hashTree>
      ${planChildren}
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Users">
        <stringProp name="ThreadGroup.num_threads">100</stringProp>
        <stringProp name="ThreadGroup.ramp_time">0</stringProp>
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController">
          <stringProp name="LoopController.loops">-1</stringProp>
        </elementProp>
      </ThreadGroup>
      <hashTree>
        ${threadGroupChildren}
      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>`;
}

const sampler = (name: string, domain: string, enabled = true) => `
  <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${name}" enabled="${enabled}">
    <stringProp name="HTTPSampler.domain">${domain}</stringProp>
    <stringProp name="HTTPSampler.path">/${name}</stringProp>
    <stringProp name="HTTPSampler.method">POST</stringProp>
  </HTTPSamplerProxy>
  <hashTree/>`;

describe("inspectJmx", () => {
  it("parses the skill template without warnings", () => {
    const result = inspectJmx(template);
    expect(result.jmeterVersion).toBe("5.6.3");
    expect(result.findings.filter((finding) => finding.severity === "warning")).toEqual([]);
    expect(result.counts.HTTPSamplerProxy).toBe(1);
    expect(result.counts.ResponseAssertion).toBe(1);
    const outline = formatInspection(result);
    expect(outline).toContain("**Users** [ThreadGroup] — threads=${__P(threads,10)}, ramp-up=${__P(rampup,30)}s, loops=infinite, duration=${__P(duration,300)}s");
    expect(outline).toContain("**GET /** [HTTPSamplerProxy] — GET /");
  });

  it("flags common load-test problems", () => {
    const xml = plan(
      `${sampler("login", "shop.example.com")}${sampler("cart", "shop.example.com")}
       <BeanShellPreProcessor guiclass="TestBeanGUI" testclass="BeanShellPreProcessor" testname="Legacy script"/>
       <hashTree/>
       <JSR223PostProcessor guiclass="TestBeanGUI" testclass="JSR223PostProcessor" testname="Parse">
         <stringProp name="scriptLanguage">groovy</stringProp>
         <stringProp name="script">log.info("\${token}")</stringProp>
       </JSR223PostProcessor>
       <hashTree/>
       <CSVDataSet guiclass="TestBeanGUI" testclass="CSVDataSet" testname="Users CSV">
         <stringProp name="filename">C:\\data\\users.csv</stringProp>
       </CSVDataSet>
       <hashTree/>`,
      `<ResultCollector guiclass="ViewResultsFullVisualizer" testclass="ResultCollector" testname="View Results Tree"/>
       <hashTree/>
       <DebugSampler guiclass="TestBeanGUI" testclass="DebugSampler" testname="Debug" enabled="false"/>
       <hashTree/>`,
    );
    const messages = inspectJmx(xml).findings.map((finding) => `${finding.severity}: ${finding.element ?? ""} ${finding.message}`);
    const has = (pattern: RegExp) => expect(messages.some((message) => pattern.test(message)), pattern.source).toBe(true);

    has(/^warning: Plan \[TestPlan\] Functional Test Mode/);
    has(/^warning: View Results Tree .* GUI listeners/);
    has(/^warning: Legacy script .* BeanShell/);
    has(/^warning: Parse .* embeds \$\{\.\.\.\} variables/);
    has(/^warning: Users \[ThreadGroup\] Loops forever/);
    has(/^info: Users \[ThreadGroup\] Starts all 100 threads at once/);
    has(/^info: Users CSV .* absolute path/);
    has(/^info: +No timers/);
    has(/^info: +No assertions/);
    has(/^info: +HTTP samplers hard-code shop.example.com/);
    has(/^info: +HTTP samplers but no HTTP Cookie Manager/);
    has(/^info: +1 element\(s\) are disabled/);
    // The disabled Debug Sampler must not be reported as enabled.
    expect(messages.some((message) => message.includes("Debug element"))).toBe(false);
  });

  it("flags numeric properties holding expressions, which JMeter cannot load", () => {
    const xml = plan("").replace(
      '<stringProp name="ThreadGroup.num_threads">100</stringProp>',
      '<intProp name="ThreadGroup.num_threads">${__P(threads,10)}</intProp>',
    );
    const [finding] = inspectJmx(xml).findings;
    expect(finding.severity).toBe("warning");
    expect(finding.message).toContain('intProp ThreadGroup.num_threads="${__P(threads,10)}" is not a number');
  });

  it("treats children of disabled elements as disabled", () => {
    const xml = plan(`
      <GenericController guiclass="LogicControllerGui" testclass="GenericController" testname="Off" enabled="false"/>
      <hashTree>${sampler("inner", "a.example.com")}</hashTree>`);
    const result = inspectJmx(xml);
    const controller = result.elements[0].children[0].children[0];
    expect(controller.enabled).toBe(false);
    expect(controller.children[0].enabled).toBe(false);
  });

  it("rejects files that are not test plans", () => {
    expect(() => inspectJmx("<project/>")).toThrow(/missing <jmeterTestPlan>/);
  });
});
