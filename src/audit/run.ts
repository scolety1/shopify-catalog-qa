import { auditRules, type AuditResult, type Finding, type LogicalEntityIdentity, type RuleApplicability } from "../audit";
import type { Catalog, ImportIssue, ImportResult } from "../catalog";
import type { WorkflowRecord } from "../workflow";
import { APP_VERSION, AUDIT_ENGINE_VERSION } from "../version";
import { catalogIdentity, imageIdentity, productIdentity, variantIdentity } from "./identity";

export const AUDIT_RUN_SCHEMA_VERSION = "catalog-qa.audit-run.v1";

export interface AuditEntitySnapshot {
  identity: LogicalEntityIdentity;
  localId: string;
  label: string;
  productKey?: string;
}

export interface AuditFindingInstance extends Finding {
  instanceId: string;
}

export interface AuditRun {
  schemaVersion: typeof AUDIT_RUN_SCHEMA_VERSION;
  runId: string;
  auditedAt: string;
  applicationVersion: string;
  auditEngineVersion: string;
  source: {
    filename: string;
    format: string;
    adapterId: string;
    adapterVersion: number;
    nativeSchemaVersion?: string;
    fingerprint: string;
  };
  catalogSummary: {
    products: number;
    variants: number;
    images: number;
    findings: number;
    severity: Record<"high" | "medium" | "low", number>;
  };
  diagnostics: {
    summary: Record<"info" | "warning" | "error", number>;
    items: ImportIssue[];
    extensionColumns: string[];
    ignoredColumns: string[];
  };
  rulesExecuted: Array<{ id: string; version: number; applicability?: RuleApplicability }>;
  rulesSkipped: Array<{ id: string; reason: string }>;
  entities: AuditEntitySnapshot[];
  findings: AuditFindingInstance[];
  workflow: WorkflowRecord[];
  comparisonMetadata?: {
    baselineRunId: string;
    comparedAt: string;
  };
}

function collectEntities(catalog: Catalog): AuditEntitySnapshot[] {
  const entities: AuditEntitySnapshot[] = [{
    identity: catalogIdentity(catalog),
    localId: catalog.id,
    label: catalog.source.name,
  }];
  for (const product of catalog.products) {
    const productLogical = productIdentity(product);
    entities.push({
      identity: productLogical,
      localId: product.id,
      label: product.title,
    });
    for (const variant of product.variants) {
      entities.push({
        identity: variantIdentity(product, variant),
        localId: variant.id,
        label: `${product.title} / ${variant.title ?? variant.sku ?? variant.id}`,
        productKey: productLogical.key,
      });
    }
    for (const image of product.images) {
      entities.push({
        identity: imageIdentity(product, image),
        localId: image.id,
        label: `${product.title} / ${image.source}`,
        productKey: productLogical.key,
      });
    }
  }
  return entities;
}

export function createAuditRun(
  imported: ImportResult,
  audit: AuditResult,
  workflow: WorkflowRecord[] = [],
  auditedAt = new Date().toISOString(),
): AuditRun {
  const severity = audit.findings.reduce(
    (counts, finding) => ({ ...counts, [finding.severity]: counts[finding.severity] + 1 }),
    { high: 0, medium: 0, low: 0 },
  );
  const diagnosticSummary = imported.issues.reduce(
    (counts, issue) => ({ ...counts, [issue.level]: counts[issue.level] + 1 }),
    { info: 0, warning: 0, error: 0 },
  );
  const runId = `audit:${imported.metadata.sourceFingerprint}:${auditedAt}`;
  const relevantWorkflow = workflow.filter((record) =>
    audit.findings.some((finding) => finding.logicalKey === record.logicalFindingKey));

  return {
    schemaVersion: AUDIT_RUN_SCHEMA_VERSION,
    runId,
    auditedAt,
    applicationVersion: APP_VERSION,
    auditEngineVersion: AUDIT_ENGINE_VERSION,
    source: {
      filename: imported.metadata.sourceName,
      format: imported.metadata.sourceFormat,
      adapterId: imported.metadata.adapterId,
      adapterVersion: imported.metadata.adapterVersion,
      nativeSchemaVersion: imported.metadata.schemaVersion,
      fingerprint: imported.metadata.sourceFingerprint,
    },
    catalogSummary: {
      ...imported.metadata.normalizedCounts,
      findings: audit.findings.length,
      severity,
    },
    diagnostics: {
      summary: diagnosticSummary,
      items: imported.issues,
      extensionColumns: imported.metadata.extensionColumns,
      ignoredColumns: imported.metadata.ignoredColumns,
    },
    rulesExecuted: audit.rulesExecuted.map((id) => {
      const rule = auditRules.find((candidate) => candidate.id === id);
      return { id, version: rule?.version ?? 1, applicability: rule?.applicability };
    }),
    rulesSkipped: audit.rulesSkipped,
    entities: collectEntities(imported.catalog),
    findings: audit.findings.map((finding, index) => ({
      ...finding,
      instanceId: `${runId}:finding:${index + 1}:${finding.logicalKey}`,
    })),
    workflow: relevantWorkflow,
  };
}
