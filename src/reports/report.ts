import { createAuditRun, type AuditComparison, type AuditResult, type AuditRun, type Finding } from "../audit";
import type { ImportIssue, ImportResult } from "../catalog";
import type { WorkflowRecord } from "../workflow";
import { APP_VERSION, AUDIT_ENGINE_VERSION } from "../version";

export const LEGACY_AUDIT_REPORT_SCHEMA_VERSION = "catalog-qa.audit-report.v1";
export const AUDIT_REPORT_SCHEMA_VERSION = "catalog-qa.audit-report.v2";

export interface AuditReportV1 {
  schemaVersion: typeof LEGACY_AUDIT_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  application: {
    name: "Shopify Catalog QA";
    version: string;
    auditEngineVersion: string;
  };
  safety: {
    readOnly: true;
    storeChangesPerformed: false;
    statement: string;
  };
  source: AuditRun["source"];
  catalogSummary: AuditRun["catalogSummary"];
  importDiagnostics: {
    summary: Record<"info" | "warning" | "error", number>;
    items: ImportIssue[];
    extensionColumns: string[];
    ignoredColumns: string[];
  };
  rulesExecuted: Array<{ id: string; version: number }>;
  findings: Finding[];
}

export interface AuditReportV2 {
  schemaVersion: typeof AUDIT_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  application: {
    name: "Shopify Catalog QA";
    version: string;
    auditEngineVersion: string;
  };
  safety: {
    readOnly: true;
    storeChangesPerformed: false;
    statement: string;
  };
  source: AuditRun["source"];
  catalogSummary: AuditRun["catalogSummary"];
  importDiagnostics: AuditRun["diagnostics"];
  rulesExecuted: AuditRun["rulesExecuted"];
  rulesSkipped: AuditRun["rulesSkipped"];
  findings: AuditRun["findings"];
  workflow: WorkflowRecord[];
  auditRun: AuditRun;
  comparison?: AuditComparison;
}

export type AuditReport = AuditReportV1 | AuditReportV2;

const safety = {
  readOnly: true as const,
  storeChangesPerformed: false as const,
  statement: "SHOPIFY CATALOG QA is read-only and has not changed your store.",
};

export function buildPortableAuditReport(run: AuditRun, comparison?: AuditComparison): AuditReportV2 {
  const auditRun = comparison
    ? { ...run, comparisonMetadata: { baselineRunId: comparison.baseline.runId, comparedAt: comparison.comparedAt } }
    : run;
  return {
    schemaVersion: AUDIT_REPORT_SCHEMA_VERSION,
    generatedAt: auditRun.auditedAt,
    application: {
      name: "Shopify Catalog QA",
      version: APP_VERSION,
      auditEngineVersion: AUDIT_ENGINE_VERSION,
    },
    safety,
    source: auditRun.source,
    catalogSummary: auditRun.catalogSummary,
    importDiagnostics: auditRun.diagnostics,
    rulesExecuted: auditRun.rulesExecuted,
    rulesSkipped: auditRun.rulesSkipped,
    findings: auditRun.findings,
    workflow: auditRun.workflow,
    auditRun,
    comparison,
  };
}

export function buildAuditReport(
  imported: ImportResult,
  audit: AuditResult,
  generatedAt = new Date().toISOString(),
  workflow: WorkflowRecord[] = [],
  comparison?: AuditComparison,
): AuditReportV2 {
  return buildPortableAuditReport(createAuditRun(imported, audit, workflow, generatedAt), comparison);
}

export function buildHtmlAuditReport(report: AuditReport): string {
  const diagnostics = report.importDiagnostics.items.length === 0
    ? '<p class="empty">No import diagnostics.</p>'
    : `<ol class="diagnostics">${report.importDiagnostics.items.map((issue) => `
      <li class="diagnostic diagnostic--${escapeHtml(issue.level)}">
        <div><strong>${escapeHtml(issue.level.toUpperCase())}</strong> <code>${escapeHtml(issue.code)}</code></div>
        <p>${escapeHtml(issue.message)}</p>
        <small>${escapeHtml(locationForIssue(issue))}</small>
      </li>`).join("")}</ol>`;

  const workflowByKey = new Map(
    ("workflow" in report ? report.workflow : []).map((record) => [record.logicalFindingKey, record]),
  );
  const findings = report.findings.length === 0
    ? '<p class="empty">No deterministic catalog QA findings.</p>'
    : report.findings.map((finding, index) => {
      const workflow = workflowByKey.get("logicalKey" in finding ? finding.logicalKey : "");
      return `
      <article class="finding finding--${escapeHtml(finding.severity)}">
        <header>
          <span class="severity">${escapeHtml(finding.severity.toUpperCase())}</span>
          <code>${escapeHtml(finding.ruleId)}</code>
          <span class="classification">DETERMINISTIC FACT</span>
        </header>
        <h3>${index + 1}. ${escapeHtml(finding.message)}</h3>
        <p><strong>Affected item:</strong> ${escapeHtml(finding.productTitle ?? finding.affectedEntityId)}</p>
        ${workflow ? `<div class="workflow"><strong>Merchant workflow:</strong> ${escapeHtml(workflow.status.replaceAll("-", " "))}${workflow.note ? `<br><strong>Note:</strong> ${escapeHtml(workflow.note)}` : ""}<br><small>Planning records external action only; the store was not changed.</small></div>` : ""}
        <h4>Evidence</h4>
        <dl>${finding.evidence.map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(formatValue(item.value))}</dd></div>`).join("")}</dl>
        <h4>Recommended remediation</h4>
        <p>${escapeHtml(finding.recommendedFix)}</p>
        <h4>Source provenance</h4>
        ${finding.provenance.map((source) => `
          <section class="source">
            <p><strong>${escapeHtml(source.sourceName)}</strong> — ${escapeHtml(source.rowNumber ? `CSV row ${source.rowNumber}` : source.jsonPath ?? "source record")}</p>
            <pre>${escapeHtml(JSON.stringify(source.rawValues, null, 2))}</pre>
          </section>`).join("")}
      </article>`;
    }).join("");

  const comparison = "comparison" in report && report.comparison
    ? renderComparison(report.comparison)
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
  <title>Catalog QA report — ${escapeHtml(report.source.filename)}</title>
  <style>
    :root{color-scheme:light;--ink:#17211b;--muted:#5b665f;--paper:#f5f6f1;--panel:#fff;--line:#dfe4dc;--green:#176f48;--high:#c94332;--medium:#a86812;--low:#356b99}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1040px;margin:auto;padding:48px 24px 80px}h1,h2,h3{line-height:1.15}.eyebrow{color:var(--green);font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.hero,.summary,.finding,.diagnostic,.comparison-item{background:var(--panel);border:1px solid var(--line);border-radius:14px}.hero{padding:32px}.safety{border-left:4px solid var(--green);margin-top:24px;padding:12px 16px;background:#e7f4ec}.summary{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;margin:20px 0;overflow:hidden}.metric{padding:18px;border-right:1px solid var(--line)}.metric:last-child{border:0}.metric strong{display:block;font-size:26px}.metric span{color:var(--muted);font-size:12px}.section{margin-top:38px}.diagnostics{padding:0;list-style:none}.diagnostic,.comparison-item{margin:10px 0;padding:14px}.diagnostic--error{border-left:4px solid var(--high)}.diagnostic--warning{border-left:4px solid var(--medium)}.diagnostic--info{border-left:4px solid var(--low)}.finding{margin:18px 0;padding:24px}.finding header{display:flex;gap:12px;align-items:center}.finding--high{border-left:6px solid var(--high)}.finding--medium{border-left:6px solid var(--medium)}.finding--low{border-left:6px solid var(--low)}.severity,.classification{font-size:11px;font-weight:800;letter-spacing:.08em}.classification{margin-left:auto;color:var(--green)}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}dl div{background:#f8f9f6;padding:10px;border-radius:8px}dt{color:var(--muted);font-size:12px}dd{margin:4px 0 0;font-weight:650;overflow-wrap:anywhere}.source{margin-top:10px}.workflow{background:#eef5f0;border-radius:8px;padding:12px}.status{font-weight:800;text-transform:uppercase;font-size:11px;letter-spacing:.08em}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#13251a;color:#e9f4ed;padding:14px;border-radius:8px;font-size:11px}.empty{color:var(--muted)}@media(max-width:720px){main{padding:24px 14px}.summary{grid-template-columns:1fr 1fr}.metric{border-bottom:1px solid var(--line)}dl{grid-template-columns:1fr}.finding header{align-items:flex-start;flex-wrap:wrap}.classification{margin-left:0}}@media print{body{background:#fff}main{max-width:none;padding:0}.hero,.finding,.diagnostic,.comparison-item{break-inside:avoid;box-shadow:none}.summary{break-inside:avoid}.finding{page-break-inside:avoid}}
  </style>
</head>
<body>
<main>
  <section class="hero">
    <p class="eyebrow">Shopify Catalog QA</p>
    <h1>Read-only catalog audit report</h1>
    <p><strong>Source:</strong> ${escapeHtml(report.source.filename)}<br><strong>Adapter:</strong> ${escapeHtml(report.source.adapterId)} v${report.source.adapterVersion}<br><strong>Fingerprint:</strong> ${escapeHtml(report.source.fingerprint)}<br><strong>Generated:</strong> ${escapeHtml(report.generatedAt)}</p>
    <p class="safety">${escapeHtml(report.safety.statement)}</p>
  </section>
  <section class="summary" aria-label="Audit summary">
    <div class="metric"><strong>${report.catalogSummary.products}</strong><span>Products</span></div>
    <div class="metric"><strong>${report.catalogSummary.variants}</strong><span>Variants</span></div>
    <div class="metric"><strong>${report.catalogSummary.findings}</strong><span>Findings</span></div>
    <div class="metric"><strong>${report.catalogSummary.severity.high}</strong><span>High</span></div>
    <div class="metric"><strong>${report.catalogSummary.severity.medium + report.catalogSummary.severity.low}</strong><span>Medium / Low</span></div>
  </section>
  ${comparison}
  <section class="section">
    <p class="eyebrow">Import diagnostics</p>
    <h2>${report.importDiagnostics.summary.error} errors · ${report.importDiagnostics.summary.warning} warnings · ${report.importDiagnostics.summary.info} info</h2>
    ${diagnostics}
  </section>
  <section class="section">
    <p class="eyebrow">Catalog QA findings</p>
    <h2>${report.findings.length} deterministic findings</h2>
    ${findings}
  </section>
</main>
</body>
</html>`;
}

function renderComparison(comparison: AuditComparison): string {
  const metrics = [
    ["Verified resolved", comparison.summary.verifiedResolved],
    ["Still present", comparison.summary.stillPresent],
    ["Changed", comparison.summary.changed],
    ["New", comparison.summary.new],
    ["Uncertain", comparison.summary.uncertain],
  ];
  return `<section class="section">
    <p class="eyebrow">Before / after verification</p>
    <h2>${escapeHtml(comparison.baseline.source.filename)} → ${escapeHtml(comparison.current.source.filename)}</h2>
    <section class="summary">${metrics.map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${escapeHtml(String(label))}</span></div>`).join("")}</section>
    ${comparison.items.map((item) => `<article class="comparison-item">
      <span class="status">${escapeHtml(item.status.replaceAll("-", " "))}</span>
      <h3>${escapeHtml(item.baseline?.message ?? item.current?.message ?? item.logicalFindingKey)}</h3>
      <p>${escapeHtml(item.explanation)}</p>
      <small>Match: ${escapeHtml(item.matchMethod.replaceAll("-", " "))} · Confidence: ${escapeHtml(item.confidence)}</small>
      ${item.workflow[0]?.note ? `<p><strong>Baseline merchant note:</strong> ${escapeHtml(item.workflow[0].note)}</p>` : ""}
    </article>`).join("")}
  </section>`;
}

function locationForIssue(issue: ImportIssue): string {
  const location = issue.rowNumber ? `CSV row ${issue.rowNumber}` : issue.path ?? "Source file";
  return issue.field ? `${location} · ${issue.field}` : location;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Blank / not supplied";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
