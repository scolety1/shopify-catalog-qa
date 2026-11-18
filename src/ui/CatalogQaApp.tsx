import { useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  auditRules,
  compareAuditRuns,
  createAuditRun,
  runAudit,
  type AuditComparison,
  type AuditRun,
  type ComparisonStatus,
  type Finding,
  type FindingComparison,
  type Severity,
} from "../audit";
import { importCatalogFile, type ImportIssue, type ImportResult } from "../catalog";
import { catalogFixtures, loadFixture, type FixtureId } from "../fixtures";
import {
  browserDownload,
  buildHtmlAuditReport,
  buildPortableAuditReport,
  parseBaselineReport,
  reportBaseName,
  type BaselineReportDiagnostic,
  type DownloadHandler,
} from "../reports";
import {
  clearWorkflowRecords,
  loadWorkflowRecords,
  recordForFinding,
  saveWorkflowRecords,
  updateWorkflowRecord,
  workflowWorkspaceKey,
  type WorkflowRecord,
  type WorkflowStatus,
} from "../workflow";
import { AuditSummary } from "./AuditSummary";
import { RuleCoverage } from "./RuleCoverage";

const initialImport = loadFixture("messy");

export interface CatalogQaAppProps {
  downloadHandler?: DownloadHandler;
  storage?: Storage | null;
}

function severityLabel(severity: Severity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

function statusLabel(status: WorkflowStatus): string {
  return {
    open: "Open",
    acknowledged: "Acknowledged",
    planned: "Remediation planned",
    "accepted-exception": "Accepted exception",
  }[status];
}

function comparisonLabel(status: ComparisonStatus): string {
  const labels: Record<ComparisonStatus, string> = {
    "still-present": "Still present",
    "verified-resolved": "Verified resolved",
    "new": "New",
    "changed": "Changed evidence",
    "uncertain": "Cannot confidently match",
  };
  return labels[status];
}

function formatRawValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Blank / not supplied";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function diagnosticLocation(issue: ImportIssue): string {
  const location = issue.rowNumber ? `CSV row ${issue.rowNumber}` : issue.path ?? "Source file";
  return issue.field ? `${location} · ${issue.field}` : location;
}

function IssueBanner({ issues }: { issues: ImportIssue[] }) {
  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");
  if (errors.length === 0 && warnings.length === 0) return null;
  const important = issues.filter((issue) => issue.level !== "info");
  return (
    <div className={`issue-banner ${errors.length ? "issue-banner--error" : "issue-banner--warning"}`} role="status">
      <strong>{errors.length ? "Import needs attention" : "Imported with warnings"}</strong>
      <span>{errors.length} errors · {warnings.length} warnings</span>
      <ul>
        {important.slice(0, 4).map((issue, index) => (
          <li key={`${issue.code}-${index}`}>
            {issue.rowNumber ? `Row ${issue.rowNumber}: ` : ""}{issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ImportDiagnostics({ issues }: { issues: ImportIssue[] }) {
  const counts = issues.reduce(
    (result, issue) => ({ ...result, [issue.level]: result[issue.level] + 1 }),
    { info: 0, warning: 0, error: 0 },
  );
  return (
    <section className="diagnostics-card" aria-label="Import diagnostics">
      <div className="diagnostics-heading">
        <div><p className="eyebrow">Import diagnostics</p><h2>What the adapter understood</h2></div>
        <div className="diagnostic-counts" aria-label="Diagnostic counts">
          <span className="diagnostic-count diagnostic-count--error">{counts.error} errors</span>
          <span className="diagnostic-count diagnostic-count--warning">{counts.warning} warnings</span>
          <span className="diagnostic-count diagnostic-count--info">{counts.info} info</span>
        </div>
      </div>
      {issues.length === 0 ? (
        <p className="diagnostics-empty">No import diagnostics. The adapter normalized this source without uncertainty.</p>
      ) : (
        <details open={counts.error > 0}>
          <summary>Inspect {issues.length} diagnostic{issues.length === 1 ? "" : "s"}</summary>
          <ol className="diagnostic-list">
            {issues.map((issue, index) => (
              <li className={`diagnostic-item diagnostic-item--${issue.level}`} key={`${issue.code}-${index}`}>
                <div className="diagnostic-item-topline">
                  <span>{issue.level}</span><code>{issue.code}</code><small>{issue.type}</small>
                </div>
                <p>{issue.message}</p>
                <small>{diagnosticLocation(issue)}</small>
                {issue.rawValue !== undefined ? <pre>{formatRawValue(issue.rawValue)}</pre> : null}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

interface FindingDetailProps {
  finding: Finding | null;
  workflow?: WorkflowRecord;
  note: string;
  onNoteChange: (note: string) => void;
  onWorkflow: (status: WorkflowStatus) => void;
  onSaveNote: () => void;
}

function FindingDetail({
  finding,
  workflow,
  note,
  onNoteChange,
  onWorkflow,
  onSaveNote,
}: FindingDetailProps) {
  if (!finding) {
    return (
      <aside className="finding-detail finding-detail--empty">
        <div className="empty-mark">✓</div>
        <h2>No finding selected</h2>
        <p>Choose a finding to inspect its factual evidence and source trail.</p>
      </aside>
    );
  }

  const rule = auditRules.find((candidate) => candidate.id === finding.ruleId);
  const status = workflow?.status ?? "open";
  return (
    <aside className="finding-detail" aria-label="Finding detail">
      <div className="detail-topline">
        <span className={`severity-chip severity-chip--${finding.severity}`}>{severityLabel(finding.severity)}</span>
        <span className="classification-chip">Deterministic fact</span>
        <span className="workflow-chip">{statusLabel(status)}</span>
      </div>
      <p className="eyebrow">{finding.ruleId}</p>
      <h2>{rule?.title ?? finding.ruleId}</h2>
      <p className="detail-message">{finding.message}</p>

      <section className="detail-section fact-section">
        <div className="section-label"><span aria-hidden="true">01</span> Detected fact</div>
        <dl className="evidence-list">
          {finding.evidence.map((item) => (
            <div key={item.label}><dt>{item.label}</dt><dd>{formatRawValue(item.value)}</dd></div>
          ))}
        </dl>
        {rule?.rationale ? <p className="rationale"><strong>Why it matters:</strong> {rule.rationale}</p> : null}
      </section>

      <section className="detail-section remediation-section">
        <div className="section-label"><span aria-hidden="true">02</span> Recommended remediation</div>
        <p>{finding.recommendedFix}</p>
        <div className="workflow-actions" aria-label="Merchant workflow actions">
          <button type="button" onClick={() => onWorkflow("acknowledged")}>Acknowledge</button>
          <button type="button" className="workflow-primary" onClick={() => onWorkflow("planned")}>Plan remediation</button>
          <button type="button" onClick={() => onWorkflow("accepted-exception")}>Accept exception</button>
          {status !== "open" ? <button type="button" onClick={() => onWorkflow("open")}>Restore to Open</button> : null}
        </div>
        <label className="workflow-note">
          <span>Merchant note <small>Optional · plain text · local only</small></span>
          <textarea
            value={note}
            maxLength={500}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="Waiting on photographer"
          />
        </label>
        <button type="button" className="note-save" onClick={onSaveNote}>Save note</button>
        <div className="safety-note">
          <span aria-hidden="true">↳</span> Planning records external action only. SHOPIFY CATALOG QA has not changed your store; re-import after the external fix to verify resolution.
        </div>
      </section>

      <section className="detail-section source-section">
        <div className="section-label"><span aria-hidden="true">03</span> Source provenance</div>
        <p className="identity-line"><strong>Logical finding key:</strong> <code>{finding.logicalKey}</code></p>
        {finding.provenance.map((source, index) => (
          <details key={`${source.sourceName}-${source.rowNumber ?? source.jsonPath}-${index}`} open={index === 0}>
            <summary>
              <span>{source.sourceName}</span>
              <small>{source.rowNumber ? `CSV row ${source.rowNumber}` : source.jsonPath ?? "Source record"}</small>
            </summary>
            <div className="source-meta">
              {source.sourceProductId ? <span>Product ID: {source.sourceProductId}</span> : null}
              {source.sourceVariantId ? <span>Variant ID: {source.sourceVariantId}</span> : null}
            </div>
            <pre>{JSON.stringify(source.rawValues, null, 2)}</pre>
          </details>
        ))}
      </section>
    </aside>
  );
}

const comparisonStatuses: ComparisonStatus[] = [
  "uncertain",
  "still-present",
  "changed",
  "verified-resolved",
  "new",
];

export function ComparisonDashboard({
  comparison,
  selected,
  onSelect,
}: {
  comparison: AuditComparison;
  selected: FindingComparison | null;
  onSelect: (id: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<ComparisonStatus | "all">("all");
  const visibleItems = statusFilter === "all"
    ? comparison.items
    : comparison.items.filter((item) => item.status === statusFilter);
  const visibleSelected = visibleItems.find((item) => item.comparisonId === selected?.comparisonId)
    ?? visibleItems[0]
    ?? null;
  const metrics = [
    ["Baseline findings", comparison.summary.baselineFindings],
    ["Current findings", comparison.summary.currentFindings],
    ["Verified resolved", comparison.summary.verifiedResolved],
    ["Still present", comparison.summary.stillPresent],
    ["Changed", comparison.summary.changed],
    ["New", comparison.summary.new],
    ["Cannot confidently match", comparison.summary.uncertain],
    ["High resolved", comparison.summary.highResolved],
    ["High remaining", comparison.summary.highRemaining],
    ["High new", comparison.summary.highNew],
  ] as const;
  return (
    <section className="comparison-card" aria-label="Audit comparison">
      <div className="comparison-heading">
        <div>
          <p className="eyebrow">Before / after verification</p>
          <h2>{comparison.baseline.source.filename} → {comparison.current.source.filename}</h2>
          <p>Baseline {comparison.baseline.source.fingerprint} · Current {comparison.current.source.fingerprint}</p>
        </div>
        <span className="comparison-ready">Comparison available</span>
      </div>
      <div className="comparison-metrics">
        {metrics.map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
      </div>
      <div className="comparison-review-tools">
        <button
          type="button"
          className={`uncertain-queue ${statusFilter === "uncertain" ? "uncertain-queue--active" : ""}`}
          aria-pressed={statusFilter === "uncertain"}
          aria-label={`Show Cannot confidently match queue (${comparison.summary.uncertain})`}
          onClick={() => setStatusFilter("uncertain")}
        >
          <strong>{comparison.summary.uncertain}</strong>
          <span>Cannot confidently match</span>
          <small>Review uncertainty queue</small>
        </button>
        <div className="comparison-filters" role="group" aria-label="Comparison status filters">
          <button type="button" aria-pressed={statusFilter === "all"} onClick={() => setStatusFilter("all")}>Show all ({comparison.items.length})</button>
          {comparisonStatuses.map((status) => {
            const count = comparison.items.filter((item) => item.status === status).length;
            return (
              <button
                type="button"
                key={status}
                aria-pressed={statusFilter === status}
                aria-label={`Show ${comparisonLabel(status)} results (${count})`}
                onClick={() => setStatusFilter(status)}
              >
                {comparisonLabel(status)} ({count})
              </button>
            );
          })}
        </div>
      </div>
      <div className="comparison-layout">
        <div className="comparison-list" aria-label="Comparison results">
          {visibleItems.length === 0 ? (
            <div className="comparison-empty" role="status">
              <strong>No results in this queue</strong>
              <span>Choose another status to continue reviewing this comparison.</span>
            </div>
          ) : visibleItems.map((item) => (
            <button
              type="button"
              key={item.comparisonId}
              className={`comparison-row comparison-row--${item.status} ${visibleSelected?.comparisonId === item.comparisonId ? "comparison-row--selected" : ""}`}
              aria-pressed={visibleSelected?.comparisonId === item.comparisonId}
              onClick={() => onSelect(item.comparisonId)}
            >
              <span>{comparisonLabel(item.status)}</span>
              <strong>{item.baseline?.ruleId ?? item.current?.ruleId}</strong>
              <small>{item.baseline?.productTitle ?? item.current?.productTitle ?? item.logicalFindingKey}</small>
            </button>
          ))}
        </div>
        <aside className="comparison-detail" aria-label="Comparison detail">
          {visibleSelected ? (
            <>
              <span className={`comparison-status comparison-status--${visibleSelected.status}`}>{comparisonLabel(visibleSelected.status)}</span>
              <h3>{visibleSelected.baseline?.message ?? visibleSelected.current?.message}</h3>
              {visibleSelected.status === "uncertain" ? <h4>Why matching is uncertain</h4> : null}
              <p>{visibleSelected.explanation}</p>
              <dl>
                <div><dt>Match method</dt><dd>{visibleSelected.matchMethod.replaceAll("-", " ")}</dd></div>
                <div><dt>Confidence</dt><dd>{visibleSelected.confidence}</dd></div>
              </dl>
              <div className="comparison-evidence-columns">
                <section><h4>Baseline evidence</h4>{visibleSelected.baseline ? <><p>{visibleSelected.baseline.severity} · {visibleSelected.baseline.ruleId}</p>
                  <dl>{visibleSelected.baseline.evidence.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{formatRawValue(item.value)}</dd></div>)}</dl>
                  {visibleSelected.workflow[0] ? <p><strong>Triage:</strong> {statusLabel(visibleSelected.workflow[0].status)}{visibleSelected.workflow[0].note ? ` — ${visibleSelected.workflow[0].note}` : ""}</p> : null}</> : <p>No baseline finding is available for this comparison item.</p>}</section>
                <section><h4>Current evidence</h4>{visibleSelected.current ? <><p>{visibleSelected.current.severity} · {visibleSelected.current.ruleId}</p>
                  <dl>{visibleSelected.current.evidence.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{formatRawValue(item.value)}</dd></div>)}</dl></> : <p>No current finding is available; absence alone is not treated as resolution.</p>}</section>
              </div>
            </>
          ) : <p>No comparison result matches this status filter.</p>}
        </aside>
      </div>
    </section>
  );
}

export function CatalogQaApp({
  downloadHandler = browserDownload,
  storage: suppliedStorage,
}: CatalogQaAppProps) {
  const requestedStorage = useMemo(() => {
    if (suppliedStorage !== undefined) return suppliedStorage;
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return null;
    }
  }, [suppliedStorage]);
  const initialWorkflow = useMemo(() => loadWorkflowRecords(requestedStorage), [requestedStorage]);
  // Never overwrite previously saved records if their initial read failed.
  const storage = initialWorkflow.unavailable ? null : requestedStorage;
  const sessionOnlyDiagnostic = "Local workflow storage is unavailable. Changes are kept in this session only; existing saved data was not changed.";
  const [activeFixture, setActiveFixture] = useState<FixtureId | "upload">("messy");
  const [importResult, setImportResult] = useState<ImportResult>(initialImport);
  const [auditedAt, setAuditedAt] = useState(() => new Date().toISOString());
  const [workflowRecords, setWorkflowRecords] = useState<WorkflowRecord[]>(initialWorkflow.records);
  const [workflowDiagnostic, setWorkflowDiagnostic] = useState(initialWorkflow.diagnostic ?? (storage ? "" : sessionOnlyDiagnostic));
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");
  const [workflowFilter, setWorkflowFilter] = useState<WorkflowStatus | "all">("all");
  const [ruleFilter, setRuleFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [baselineRun, setBaselineRun] = useState<AuditRun | null>(null);
  const [baselineDiagnostic, setBaselineDiagnostic] = useState<BaselineReportDiagnostic | null>(null);
  const [selectedComparisonId, setSelectedComparisonId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const baselineInputRef = useRef<HTMLInputElement>(null);

  const audit = useMemo(() => runAudit(importResult.catalog), [importResult.catalog]);
  const workspaceKey = useMemo(() => workflowWorkspaceKey(importResult.catalog), [importResult.catalog]);
  const currentWorkflow = useMemo(
    () => workflowRecords.filter((record) => record.workspaceKey === workspaceKey),
    [workflowRecords, workspaceKey],
  );
  const currentRun = useMemo(
    () => createAuditRun(importResult, audit, currentWorkflow, auditedAt),
    [audit, auditedAt, currentWorkflow, importResult],
  );
  const comparison = useMemo(
    () => baselineRun ? compareAuditRuns(baselineRun, currentRun) : null,
    [baselineRun, currentRun],
  );
  const comparisonByCurrentKey = useMemo(() => new Map(
    comparison?.items.filter((item) => item.current).map((item) => [item.current!.logicalKey, item.status]) ?? [],
  ), [comparison]);

  const products = importResult.catalog.products;
  const filteredFindings = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return audit.findings.filter((finding) => {
      const workflow = recordForFinding(workflowRecords, workspaceKey, finding);
      if (severityFilter !== "all" && finding.severity !== severityFilter) return false;
      if (workflowFilter !== "all" && (workflow?.status ?? "open") !== workflowFilter) return false;
      if (ruleFilter !== "all" && finding.ruleId !== ruleFilter) return false;
      if (entityFilter !== "all" && finding.productId !== entityFilter && finding.affectedEntityId !== entityFilter) return false;
      if (!normalizedSearch) return true;
      return [finding.message, finding.productTitle, finding.affectedEntityId, finding.ruleId, workflow?.note]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(normalizedSearch));
    });
  }, [audit.findings, entityFilter, ruleFilter, search, severityFilter, workflowFilter, workflowRecords, workspaceKey]);

  const selectedFinding = filteredFindings.find((finding) => finding.id === selectedFindingId)
    ?? filteredFindings[0] ?? null;
  const selectedWorkflow = selectedFinding
    ? recordForFinding(workflowRecords, workspaceKey, selectedFinding)
    : undefined;
  const selectedComparison = comparison?.items.find((item) => item.comparisonId === selectedComparisonId)
    ?? comparison?.items.find((item) => item.status === "verified-resolved")
    ?? comparison?.items[0] ?? null;
  const noteDraft = selectedFinding
    ? noteDrafts[selectedFinding.logicalKey] ?? selectedWorkflow?.note ?? ""
    : "";


  const counts = importResult.metadata.normalizedCounts;
  const issueCounts = importResult.issues.reduce(
    (result, issue) => ({ ...result, [issue.level]: result[issue.level] + 1 }),
    { info: 0, warning: 0, error: 0 },
  );

  function resetFilters() {
    setSeverityFilter("all");
    setWorkflowFilter("all");
    setRuleFilter("all");
    setEntityFilter("all");
    setSearch("");
    setSelectedFindingId(null);
  }

  function chooseFixture(id: FixtureId) {
    setIsImporting(true);
    setImportResult(loadFixture(id));
    setAuditedAt(new Date().toISOString());
    setActiveFixture(id);
    resetFilters();
    setIsImporting(false);
  }

  async function handleCatalogFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const text = await file.text();
      setImportResult(importCatalogFile(text, file.name));
      setAuditedAt(new Date().toISOString());
      setActiveFixture("upload");
      resetFilters();
    } catch (error) {
      const failed = importCatalogFile("", file.name);
      failed.issues = [{
        level: "error", type: "parse", code: "FILE_READ_ERROR",
        message: error instanceof Error ? error.message : "The selected file could not be read.",
      }];
      setImportResult(failed);
      setActiveFixture("upload");
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  }

  async function handleBaselineFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = parseBaselineReport(await file.text());
    if (parsed.ok) {
      setBaselineRun(parsed.run);
      setBaselineDiagnostic(parsed.upgradedFrom ? {
        code: "REPORT_SHAPE_INVALID",
        message: `Loaded and upgraded ${parsed.upgradedFrom} as the visible baseline.`,
        path: "$.schemaVersion",
      } : null);
      setSelectedComparisonId(null);
    } else {
      setBaselineRun(null);
      setBaselineDiagnostic(parsed.diagnostics[0]);
    }
    event.target.value = "";
  }

  function persistWorkflow(next: WorkflowRecord[]) {
    setWorkflowRecords(next);
    saveWorkflowRecords(storage, next);
    setWorkflowDiagnostic(storage ? "" : sessionOnlyDiagnostic);
  }

  function setFindingWorkflow(status: WorkflowStatus) {
    if (!selectedFinding) return;
    const existing = recordForFinding(workflowRecords, workspaceKey, selectedFinding);
    const nextRecord = updateWorkflowRecord(selectedFinding, workspaceKey, status, noteDraft, existing);
    const next = workflowRecords.filter((record) =>
      !(record.workspaceKey === workspaceKey && record.logicalFindingKey === selectedFinding.logicalKey));
    persistWorkflow([...next, nextRecord]);
  }

  function saveNote() {
    if (!selectedFinding) return;
    setFindingWorkflow(selectedWorkflow?.status ?? "open");
  }

  function clearLocalWorkflow() {
    clearWorkflowRecords(storage);
    setWorkflowRecords([]);
    setNoteDrafts({});
    setWorkflowDiagnostic(storage
      ? "Local workflow data cleared. Imported catalogs were never stored."
      : "Session workflow data cleared. Local storage remains unavailable; existing saved data was not changed.");
  }

  function downloadReport(format: "json" | "html") {
    const report = buildPortableAuditReport(currentRun, comparison ?? undefined);
    const baseName = `${reportBaseName(importResult.metadata.sourceName)}-catalog-qa-report`;
    downloadHandler({
      filename: `${baseName}.${format}`,
      mimeType: format === "json" ? "application/json;charset=utf-8" : "text/html;charset=utf-8",
      content: format === "json" ? `${JSON.stringify(report, null, 2)}\n` : buildHtmlAuditReport(report),
    });
  }

  const currentName = activeFixture === "upload"
    ? importResult.catalog.source.name
    : catalogFixtures.find((fixture) => fixture.id === activeFixture)?.name;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Catalog QA home">
          <span className="brand-mark" aria-hidden="true">CQ</span>
          <span><strong>Catalog QA</strong><small>Shopify-style audit</small></span>
        </a>
        <div className="read-only-pill"><span aria-hidden="true">◉</span> Read-only · local analysis</div>
      </header>

      <div className="workspace" id="top">
        <aside className="input-rail">
          <div className="rail-heading">
            <p className="eyebrow">Catalog input</p>
            <h1>Audit, plan, re-import</h1>
            <p>Compare a later catalog snapshot with an explicit saved baseline.</p>
          </div>
          <div className="fixture-list" role="group" aria-label="Bundled catalogs">
            {catalogFixtures.map((fixture) => (
              <button
                className={`fixture-button ${activeFixture === fixture.id ? "fixture-button--active" : ""}`}
                key={fixture.id}
                onClick={() => chooseFixture(fixture.id)}
                type="button"
              >
                <span className="fixture-icon" aria-hidden="true">{fixture.id === "healthy" ? "✓" : fixture.id === "messy" ? "!" : "◇"}</span>
                <span><strong>{fixture.name}</strong><small>{fixture.description}</small></span>
                <span className="fixture-arrow" aria-hidden="true">→</span>
              </button>
            ))}
          </div>

          <div className="rail-divider"><span>or import</span></div>
          <input ref={fileInputRef} className="visually-hidden" type="file" accept=".csv,.json,text/csv,application/json" onChange={handleCatalogFile} />
          <button className={`upload-button ${activeFixture === "upload" ? "upload-button--active" : ""}`} type="button" onClick={() => fileInputRef.current?.click()}>
            <span className="upload-icon" aria-hidden="true">↑</span>
            <span><strong>Upload current catalog</strong><small>CSV or native catalog JSON</small></span>
          </button>

          <section className="baseline-card" aria-label="Baseline audit">
            <p className="eyebrow">Saved baseline</p>
            <input ref={baselineInputRef} className="visually-hidden" type="file" accept=".json,application/json" onChange={handleBaselineFile} />
            <button type="button" onClick={() => baselineInputRef.current?.click()}>Load baseline audit report</button>
            {baselineRun ? (
              <dl>
                <div><dt>Baseline</dt><dd>{baselineRun.source.filename}</dd></div>
                <div><dt>Generated</dt><dd>{baselineRun.auditedAt}</dd></div>
                <div><dt>Fingerprint</dt><dd>{baselineRun.source.fingerprint}</dd></div>
                <div><dt>Findings</dt><dd>{baselineRun.findings.length}</dd></div>
              </dl>
            ) : <p>No baseline loaded. Comparison is never automatic or hidden.</p>}
            {baselineDiagnostic ? <p className="baseline-diagnostic" role="status"><code>{baselineDiagnostic.code}</code> {baselineDiagnostic.message}</p> : null}
          </section>

          <section className="import-card" aria-label="Import summary">
            <div className="import-card-title"><span aria-hidden="true">↳</span><strong>Current import</strong></div>
            <dl>
              <div><dt>Filename</dt><dd>{importResult.metadata.sourceName}</dd></div>
              <div><dt>Detected format</dt><dd>{importResult.metadata.sourceFormat}</dd></div>
              <div><dt>Adapter</dt><dd>{importResult.metadata.adapterId} v{importResult.metadata.adapterVersion}</dd></div>
              <div><dt>Products</dt><dd>{counts.products}</dd></div>
              <div><dt>Variants</dt><dd>{counts.variants}</dd></div>
              <div><dt>Images</dt><dd>{counts.images}</dd></div>
              <div><dt>Warnings / errors</dt><dd>{issueCounts.warning} / {issueCounts.error}</dd></div>
            </dl>
          </section>

          <button type="button" className="clear-workflow" onClick={clearLocalWorkflow}>Clear local workflow data</button>
          {workflowDiagnostic ? <p className="workflow-diagnostic" role="status">{workflowDiagnostic}</p> : null}
          <p className="privacy-note"><span aria-hidden="true">⌁</span> Only workflow status, notes, and logical keys persist locally. Raw catalogs are not stored. No telemetry or remote persistence.</p>
        </aside>

        <section className="main-content">
          <div className="content-heading">
            <div>
              <p className="eyebrow">Current audit</p>
              <h1>{currentName}</h1>
              <p>SHOPIFY CATALOG QA is read-only and has not changed your store.</p>
            </div>
            <div className="heading-actions">
              <div className="audit-state"><span className="pulse-dot" />{isImporting ? "Importing…" : "Audit complete"}</div>
              <div className="report-actions" aria-label="Download audit report">
                <button type="button" onClick={() => downloadReport("json")}>Download JSON</button>
                <button type="button" onClick={() => downloadReport("html")}>Download HTML</button>
              </div>
            </div>
          </div>

          <IssueBanner issues={importResult.issues} />
          <AuditSummary catalog={importResult.catalog} audit={audit} />
          <RuleCoverage audit={audit} />
          {comparison ? <ComparisonDashboard comparison={comparison} selected={selectedComparison} onSelect={setSelectedComparisonId} /> : null}
          <ImportDiagnostics issues={importResult.issues} />

          <section className="findings-section">
            <div className="findings-heading">
              <div>
                <p className="eyebrow">Catalog QA findings</p>
                <h2>Review and plan</h2>
                <span>{filteredFindings.length} of {audit.findings.length} shown</span>
              </div>
              <div className="filters" aria-label="Finding filters">
                <label><span>Severity</span><select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as Severity | "all")}>
                  <option value="all">All severities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                </select></label>
                <label><span>Workflow</span><select value={workflowFilter} onChange={(event) => setWorkflowFilter(event.target.value as WorkflowStatus | "all")}>
                  <option value="all">All workflow states</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="planned">Remediation planned</option><option value="accepted-exception">Accepted exception</option>
                </select></label>
                <label><span>Rule</span><select value={ruleFilter} onChange={(event) => setRuleFilter(event.target.value)}>
                  <option value="all">All rules</option>{auditRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.id}</option>)}
                </select></label>
                <label><span>Affected product</span><select value={entityFilter} onChange={(event) => setEntityFilter(event.target.value)}>
                  <option value="all">All products</option>{products.map((product) => <option key={product.id} value={product.id}>{product.title}</option>)}
                </select></label>
                <label className="search-label"><span>Find item</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="SKU, product, note…" /></label>
              </div>
            </div>

            <div className="findings-layout">
              <div className="findings-list" aria-live="polite">
                {filteredFindings.length === 0 ? (
                  <div className="findings-empty"><div className="empty-mark">✓</div><h3>{audit.findings.length === 0 ? "No deterministic problems found" : "No findings match these filters"}</h3></div>
                ) : filteredFindings.map((finding) => {
                  const rule = auditRules.find((candidate) => candidate.id === finding.ruleId);
                  const workflow = recordForFinding(workflowRecords, workspaceKey, finding);
                  const compareStatus = comparisonByCurrentKey.get(finding.logicalKey);
                  return (
                    <button
                      type="button"
                      key={finding.id}
                      className={`finding-row ${finding.id === selectedFinding?.id ? "finding-row--selected" : ""}`}
                      onClick={() => setSelectedFindingId(finding.id)}
                    >
                      <span className={`severity-bar severity-bar--${finding.severity}`} />
                      <span className="finding-copy">
                        <span className="finding-meta"><span>{finding.ruleId}</span><span>{finding.affectedEntityType}</span></span>
                        <strong>{rule?.title ?? finding.ruleId}</strong>
                        <small>{finding.productTitle ?? finding.affectedEntityId}</small>
                        <span className="finding-statuses"><em>{statusLabel(workflow?.status ?? "open")}</em>{compareStatus ? <em>{comparisonLabel(compareStatus)}</em> : null}</span>
                      </span>
                      <span className={`severity-text severity-text--${finding.severity}`}>{severityLabel(finding.severity)}</span>
                      <span className="row-arrow" aria-hidden="true">›</span>
                    </button>
                  );
                })}
              </div>
              <FindingDetail
                finding={selectedFinding}
                workflow={selectedWorkflow}
                note={noteDraft}
                onNoteChange={(note) => selectedFinding && setNoteDrafts((current) => ({ ...current, [selectedFinding.logicalKey]: note }))}
                onWorkflow={setFindingWorkflow}
                onSaveNote={saveNote}
              />
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
