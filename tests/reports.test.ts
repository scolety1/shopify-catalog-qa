import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compareAuditRuns, createAuditRun, runAudit } from "../src/audit";
import { importNativeJson } from "../src/catalog";
import { loadFixture } from "../src/fixtures";
import {
  AUDIT_REPORT_SCHEMA_VERSION,
  buildAuditReport,
  buildHtmlAuditReport,
  buildPortableAuditReport,
  parseBaselineReport,
} from "../src/reports";
import { updateWorkflowRecord, workflowWorkspaceKey } from "../src/workflow";

describe("portable read-only audit reports", () => {
  it("builds the versioned machine-readable report and first-class audit run", () => {
    const imported = loadFixture("messy");
    const report = buildAuditReport(imported, runAudit(imported.catalog), "2026-08-12T00:00:00.000Z");
    expect(report.schemaVersion).toBe(AUDIT_REPORT_SCHEMA_VERSION);
    expect(report.auditRun.schemaVersion).toBe("catalog-qa.audit-run.v1");
    expect(report.source).toMatchObject({
      filename: "messy-store.json",
      adapterId: "catalog-qa-json-v1",
      adapterVersion: 1,
      nativeSchemaVersion: "catalog-qa.catalog.v1",
    });
    expect(report.catalogSummary).toMatchObject({ products: 4, variants: 8, findings: 15 });
    expect(report.safety).toEqual({
      readOnly: true,
      storeChangesPerformed: false,
      statement: "SHOPIFY CATALOG QA is read-only and has not changed your store.",
    });
  });

  it("keeps logical finding identity stable while audit instance identity changes by run", () => {
    const imported = loadFixture("messy");
    const audit = runAudit(imported.catalog);
    const first = buildAuditReport(imported, audit, "2026-08-12T00:00:00.000Z");
    const second = buildAuditReport(imported, audit, "2026-08-12T01:00:00.000Z");
    expect(first.generatedAt).not.toBe(second.generatedAt);
    expect(first.findings.map((finding) => finding.logicalKey))
      .toEqual(second.findings.map((finding) => finding.logicalKey));
    expect(first.findings.map((finding) => finding.instanceId))
      .not.toEqual(second.findings.map((finding) => finding.instanceId));
    expect(first.source.fingerprint).toBe(second.source.fingerprint);
  });

  it("retains evidence, remediation, source provenance, workflow, and comparison metadata", () => {
    const baselineImport = loadFixture("messy");
    const audit = runAudit(baselineImport.catalog);
    const finding = audit.findings[0];
    const workflow = updateWorkflowRecord(
      finding,
      workflowWorkspaceKey(baselineImport.catalog),
      "planned",
      "Waiting on photographer",
      undefined,
      "2026-08-12T00:30:00.000Z",
    );
    const baseline = createAuditRun(baselineImport, audit, [workflow], "2026-08-12T00:00:00.000Z");
    const currentImport = loadFixture("improved");
    const current = createAuditRun(currentImport, runAudit(currentImport.catalog), [], "2026-08-13T00:00:00.000Z");
    const comparison = compareAuditRuns(baseline, current, "2026-08-13T01:00:00.000Z");
    const report = buildPortableAuditReport(current, comparison);
    expect(report.comparison?.summary.verifiedResolved).toBe(12);
    expect(report.comparison?.baseline.source.filename).toBe("messy-store.json");
    expect(report.comparison?.current.source.filename).toBe("improved-store.json");
    expect(report.comparison?.items.some((item) => item.workflow[0]?.note === "Waiting on photographer")).toBe(true);
    expect(report.findings[0].evidence.length).toBeGreaterThan(0);
    expect(report.findings[0].recommendedFix.length).toBeGreaterThan(0);
  });

  it("generates standalone comparison HTML with escaped merchant notes", () => {
    const baselineImport = loadFixture("messy");
    const audit = runAudit(baselineImport.catalog);
    const workflow = updateWorkflowRecord(
      audit.findings[0],
      workflowWorkspaceKey(baselineImport.catalog),
      "planned",
      `<img src=x onerror=alert("merchant")>`,
    );
    const baseline = createAuditRun(baselineImport, audit, [workflow], "2026-08-12T00:00:00.000Z");
    const currentImport = loadFixture("improved");
    const current = createAuditRun(currentImport, runAudit(currentImport.catalog), [], "2026-08-13T00:00:00.000Z");
    const html = buildHtmlAuditReport(buildPortableAuditReport(current, compareAuditRuns(baseline, current)));
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Before / after verification");
    expect(html).toContain("Verified resolved");
    expect(html).toContain("&lt;img src=x onerror=alert(&quot;merchant&quot;)&gt;");
    expect(html).not.toContain('<img src=x onerror=alert("merchant")>');
    expect(html).toContain("Content-Security-Policy");
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<img\b[^>]+src=["']https?:/i);
  });

  it("HTML-escapes imported merchant catalog data", () => {
    const imported = importNativeJson({
      schemaVersion: "catalog-qa.catalog.v1",
      products: [{
        id: "xss",
        handle: "xss",
        title: "<script>alert(1)</script>",
        status: "active",
        options: [],
        variants: [{ id: "v1", sku: null, price: 1, options: {} }],
        images: [],
      }],
    }, "<unsafe>.json");
    const html = buildHtmlAuditReport(buildAuditReport(imported, runAudit(imported.catalog)));
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("upgrades the frozen Mission 2 report as an explicit compatible baseline", () => {
    const source = readFileSync(resolve(process.cwd(), "fixtures/mission2-audit-report-v1.json"), "utf8");
    const parsed = parseBaselineReport(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.upgradedFrom).toBe("catalog-qa.audit-report.v1");
    expect(parsed.run.findings).toHaveLength(17);
    expect(parsed.run.workflow).toEqual([]);
    expect(parsed.run.findings.every((finding) => finding.logicalKey.length > 0)).toBe(true);
    const currentImport = loadFixture("improved");
    const current = createAuditRun(currentImport, runAudit(currentImport.catalog), [], "2026-08-13T00:00:00.000Z");
    expect(compareAuditRuns(parsed.run, current).summary).toMatchObject({
      verifiedResolved: 15, stillPresent: 1, changed: 1, new: 1, uncertain: 0,
    });
  });

  it("reports malformed and unsupported baseline versions precisely", () => {
    expect(parseBaselineReport("{bad")).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "REPORT_PARSE_ERROR", path: "$" })],
    });
    expect(parseBaselineReport({ schemaVersion: "catalog-qa.audit-report.v99" })).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "REPORT_VERSION_UNSUPPORTED", path: "$.schemaVersion" })],
    });
  });
});
