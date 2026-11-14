import type { Finding, LogicalEntityIdentity } from "../audit";
import type { AuditRun } from "../audit/run";
import { AUDIT_RUN_SCHEMA_VERSION } from "../audit/run";
import type { AuditReportV1, AuditReportV2 } from "./report";

export type BaselineReportDiagnosticCode =
  | "REPORT_PARSE_ERROR"
  | "REPORT_SHAPE_INVALID"
  | "REPORT_VERSION_UNSUPPORTED";

export interface BaselineReportDiagnostic {
  code: BaselineReportDiagnosticCode;
  message: string;
  path: string;
}

export type BaselineReportResult =
  | { ok: true; run: AuditRun; upgradedFrom?: string }
  | { ok: false; diagnostics: BaselineReportDiagnostic[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function legacyEncode(value: string): string {
  return encodeURIComponent(value.trim().normalize("NFKC").toLocaleLowerCase());
}

function legacySlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function variantSourceForFinding(finding: Finding) {
  return finding.provenance.find((source) =>
    source.sourceVariantId
    && finding.affectedEntityId.includes(legacySlug(source.sourceVariantId)))
    ?? finding.provenance.find((source) => source.sourceVariantId);
}
function legacyEntity(finding: Finding): LogicalEntityIdentity {
  const source = finding.provenance?.[0];
  const variantSource = variantSourceForFinding(finding);
  if (finding.affectedEntityType === "product" && source?.sourceProductId) {
    return {
      key: `product:source:${legacyEncode(source.sourceProductId)}`,
      type: "product",
      basis: "stable-source-id",
      confidence: "exact",
      sourceId: source.sourceProductId,
    };
  }
  if (finding.affectedEntityType === "variant" && variantSource?.sourceVariantId) {
    return {
      key: `variant:source:${legacyEncode(variantSource.sourceVariantId)}`,
      type: "variant",
      basis: "stable-source-id",
      confidence: "exact",
      sourceId: variantSource.sourceVariantId,
    };
  }
  if (finding.affectedEntityType === "image") {
    const media = finding.evidence.find((entry) => entry.label === "Image source")?.value;
    const productId = source?.sourceProductId;
    if (typeof media === "string" && productId) {
      const productKey = `product:source:${legacyEncode(productId)}`;
      return {
        key: `image:product:${legacyEncode(productKey)}:source:${legacyEncode(media)}`,
        type: "image",
        basis: "media-source",
        confidence: "strong",
        productKey,
        mediaSource: media,
      };
    }
  }
  return {
    key: `${finding.affectedEntityType}:local:${legacyEncode(finding.affectedEntityId)}`,
    type: finding.affectedEntityType,
    basis: "unstable-local-id",
    confidence: "unmatched",
  };
}

function upgradeLegacyFinding(finding: Finding): AuditRun["findings"][number] {
  const entity = finding.logicalEntity ?? legacyEntity(finding);
  const logicalKey = finding.logicalKey ?? `${finding.ruleId}:${entity.key}`;
  return {
    ...finding,
    logicalEntity: entity,
    logicalKey,
    findingDiscriminator: finding.findingDiscriminator ?? null,
    instanceId: `legacy:${finding.id}`,
  };
}

function upgradeMission2(report: AuditReportV1): AuditRun {
  const findings = report.findings.map(upgradeLegacyFinding);
  const entities = findings.map((finding) => ({
    identity: finding.logicalEntity,
    localId: finding.affectedEntityId,
    label: finding.productTitle ?? finding.affectedEntityId,
    productKey: finding.logicalEntity.productKey,
  }));
  return {
    schemaVersion: AUDIT_RUN_SCHEMA_VERSION,
    runId: `legacy-report:${report.source.fingerprint}:${report.generatedAt}`,
    auditedAt: report.generatedAt,
    applicationVersion: report.application.version,
    auditEngineVersion: report.application.auditEngineVersion,
    source: report.source,
    catalogSummary: report.catalogSummary,
    diagnostics: {
      summary: report.importDiagnostics.summary,
      items: report.importDiagnostics.items,
      extensionColumns: report.importDiagnostics.extensionColumns,
      ignoredColumns: report.importDiagnostics.ignoredColumns,
    },
    rulesExecuted: report.rulesExecuted,
    rulesSkipped: [],
    entities,
    findings,
    workflow: [],
  };
}

function validateRun(run: unknown): run is AuditRun {
  return isRecord(run)
    && run.schemaVersion === AUDIT_RUN_SCHEMA_VERSION
    && typeof run.runId === "string"
    && typeof run.auditedAt === "string"
    && Array.isArray(run.findings)
    && Array.isArray(run.entities)
    && isRecord(run.source);
}

export function parseBaselineReport(input: string | unknown): BaselineReportResult {
  let parsed = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch (error) {
      return {
        ok: false,
        diagnostics: [{
          code: "REPORT_PARSE_ERROR",
          message: error instanceof Error ? error.message : "Baseline report JSON could not be parsed.",
          path: "$",
        }],
      };
    }
  }
  if (!isRecord(parsed) || typeof parsed.schemaVersion !== "string") {
    return {
      ok: false,
      diagnostics: [{
        code: "REPORT_SHAPE_INVALID",
        message: "Expected a versioned Catalog QA audit report object.",
        path: "$.schemaVersion",
      }],
    };
  }
  if (parsed.schemaVersion === AUDIT_RUN_SCHEMA_VERSION) {
    return validateRun(parsed)
      ? { ok: true, run: parsed }
      : { ok: false, diagnostics: [{ code: "REPORT_SHAPE_INVALID", message: "Audit run is missing findings, entities, or source metadata.", path: "$" }] };
  }
  if (parsed.schemaVersion === "catalog-qa.audit-report.v2") {
    const report = parsed as unknown as AuditReportV2;
    return validateRun(report.auditRun)
      ? { ok: true, run: report.auditRun }
      : { ok: false, diagnostics: [{ code: "REPORT_SHAPE_INVALID", message: "Version 2 report is missing its complete auditRun.", path: "$.auditRun" }] };
  }
  if (parsed.schemaVersion === "catalog-qa.audit-report.v1") {
    if (!Array.isArray(parsed.findings) || !isRecord(parsed.source) || !isRecord(parsed.catalogSummary)) {
      return {
        ok: false,
        diagnostics: [{
          code: "REPORT_SHAPE_INVALID",
          message: "Mission 2 report is missing findings or audit metadata.",
          path: "$",
        }],
      };
    }
    return {
      ok: true,
      run: upgradeMission2(parsed as unknown as AuditReportV1),
      upgradedFrom: "catalog-qa.audit-report.v1",
    };
  }
  return {
    ok: false,
    diagnostics: [{
      code: "REPORT_VERSION_UNSUPPORTED",
      message: `Report schema ${parsed.schemaVersion} is not supported.`,
      path: "$.schemaVersion",
    }],
  };
}
