import {
  WORKFLOW_SCHEMA_VERSION,
  WORKFLOW_STORAGE_KEY,
  WORKFLOW_STATUSES,
  type WorkflowRecord,
  type WorkflowStore,
} from "./model";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WorkflowLoadResult {
  records: WorkflowRecord[];
  diagnostic?: string;
}

function isWorkflowRecord(value: unknown): value is WorkflowRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<WorkflowRecord>;
  return record.schemaVersion === WORKFLOW_SCHEMA_VERSION
    && typeof record.workspaceKey === "string"
    && typeof record.logicalFindingKey === "string"
    && typeof record.ruleId === "string"
    && !!record.affectedEntity
    && typeof record.affectedLabel === "string"
    && typeof record.recommendedRemediation === "string"
    && typeof record.status === "string"
    && WORKFLOW_STATUSES.includes(record.status as WorkflowRecord["status"])
    && typeof record.note === "string"
    && typeof record.createdAt === "string"
    && typeof record.updatedAt === "string";
}

export function loadWorkflowRecords(storage: StorageLike | null | undefined): WorkflowLoadResult {
  if (!storage) return { records: [] };
  const raw = storage.getItem(WORKFLOW_STORAGE_KEY);
  if (!raw) return { records: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<WorkflowStore>;
    if (parsed.schemaVersion !== WORKFLOW_SCHEMA_VERSION || !Array.isArray(parsed.records)) {
      return { records: [], diagnostic: "Local workflow data uses an unsupported schema version." };
    }
    const records = parsed.records.filter(isWorkflowRecord);
    return {
      records,
      diagnostic: records.length === parsed.records.length
        ? undefined
        : "Some invalid local workflow records were ignored.",
    };
  } catch {
    return { records: [], diagnostic: "Local workflow data could not be parsed and was ignored." };
  }
}

export function saveWorkflowRecords(storage: StorageLike | null | undefined, records: WorkflowRecord[]): void {
  if (!storage) return;
  const store: WorkflowStore = { schemaVersion: WORKFLOW_SCHEMA_VERSION, records };
  storage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(store));
}

export function clearWorkflowRecords(storage: StorageLike | null | undefined): void {
  storage?.removeItem(WORKFLOW_STORAGE_KEY);
}
