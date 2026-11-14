import type { Finding, LogicalEntityIdentity } from "../audit";
import type { Catalog } from "../catalog";

export const WORKFLOW_SCHEMA_VERSION = "catalog-qa.workflow.v1";
export const WORKFLOW_STORAGE_KEY = "catalog-qa.workflow.v1";

export type WorkflowStatus = "open" | "acknowledged" | "planned" | "accepted-exception";

export interface WorkflowRecord {
  schemaVersion: typeof WORKFLOW_SCHEMA_VERSION;
  workspaceKey: string;
  logicalFindingKey: string;
  ruleId: string;
  affectedEntity: LogicalEntityIdentity;
  affectedLabel: string;
  recommendedRemediation: string;
  status: WorkflowStatus;
  note: string;
  createdAt: string;
  updatedAt: string;
  plannedAt?: string;
}

export interface WorkflowStore {
  schemaVersion: typeof WORKFLOW_SCHEMA_VERSION;
  records: WorkflowRecord[];
}

export const WORKFLOW_STATUSES: WorkflowStatus[] = [
  "open",
  "acknowledged",
  "planned",
  "accepted-exception",
];


export function workflowWorkspaceKey(catalog: Catalog): string {
  const firstStableProduct = catalog.products
    .map((product) => product.sourceProductId?.trim() || product.handle.trim())
    .filter(Boolean)
    .sort()[0];
  return firstStableProduct
    ? `workspace:${catalog.source.adapterId}:${encodeURIComponent(firstStableProduct.toLocaleLowerCase())}`
    : `workspace:${catalog.source.adapterId}:${catalog.source.fingerprint}`;
}
export function workflowRecordKey(workspaceKey: string, logicalFindingKey: string): string {
  return `${workspaceKey}::${logicalFindingKey}`;
}

export function normalizeWorkflowNote(note: string): string {
  return note.replace(/\r\n?/g, "\n").trim().slice(0, 500);
}

export function updateWorkflowRecord(
  finding: Finding,
  workspaceKey: string,
  status: WorkflowStatus,
  note: string,
  existing?: WorkflowRecord,
  timestamp = new Date().toISOString(),
): WorkflowRecord {
  if (!WORKFLOW_STATUSES.includes(status)) {
    throw new Error(`Unsupported workflow status: ${String(status)}`);
  }
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    workspaceKey,
    logicalFindingKey: finding.logicalKey,
    ruleId: finding.ruleId,
    affectedEntity: finding.logicalEntity,
    affectedLabel: finding.productTitle ?? finding.affectedEntityId,
    recommendedRemediation: finding.recommendedFix,
    status,
    note: normalizeWorkflowNote(note),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    plannedAt: status === "planned" ? existing?.plannedAt ?? timestamp : existing?.plannedAt,
  };
}

export function recordForFinding(
  records: WorkflowRecord[],
  workspaceKey: string,
  finding: Finding,
): WorkflowRecord | undefined {
  return records.find((record) =>
    record.workspaceKey === workspaceKey && record.logicalFindingKey === finding.logicalKey);
}
