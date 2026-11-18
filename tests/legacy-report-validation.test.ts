import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBaselineReport } from "../src/reports";

const fixture = JSON.parse(readFileSync("fixtures/mission2-audit-report-v1.json", "utf8"));

describe("legacy report metadata validation", () => {
  it("preserves valid legacy migration", () => {
    const result = parseBaselineReport(fixture);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.run.findings.length).toBe(fixture.findings.length);
  });

  it.each(["application", "importDiagnostics", "generatedAt", "rulesExecuted"])("rejects missing %s rather than throwing or accepting an incomplete run", (field) => {
    const broken = structuredClone(fixture);
    delete broken[field];
    expect(parseBaselineReport(broken)).toMatchObject({ ok: false, diagnostics: [{ code: "REPORT_SHAPE_INVALID" }] });
  });

  it.each([null, {}, { provenance: null }, { evidence: null }])("rejects malformed legacy finding %j without throwing", (finding) => {
    const broken = structuredClone(fixture);
    broken.findings = [finding];
    expect(parseBaselineReport(broken)).toMatchObject({ ok: false, diagnostics: [{ code: "REPORT_SHAPE_INVALID" }] });
  });

  it("rejects invalid nested provenance identifiers", () => {
    const broken = structuredClone(fixture);
    broken.findings[0].provenance[0].sourceVariantId = 123;
    expect(parseBaselineReport(broken).ok).toBe(false);
  });

  it("reports unencodable legacy identity text instead of throwing URIError", () => {
    const broken = structuredClone(fixture);
    broken.findings[0].logicalEntity = undefined;
    broken.findings[0].affectedEntityType = "product";
    broken.findings[0].provenance[0].sourceProductId = "\ud800";
    expect(parseBaselineReport(broken)).toMatchObject({ ok: false, diagnostics: [{ code: "REPORT_SHAPE_INVALID" }] });
  });
});
