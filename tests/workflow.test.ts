import { describe, expect, it } from "vitest";
import { runAudit } from "../src/audit";
import { loadFixture } from "../src/fixtures";
import {
  clearWorkflowRecords,
  loadWorkflowRecords,
  normalizeWorkflowNote,
  saveWorkflowRecords,
  updateWorkflowRecord,
  workflowWorkspaceKey,
  WORKFLOW_STATUSES,
  type StorageLike,
} from "../src/workflow";

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe("merchant workflow state", () => {
  it("supports open, acknowledged, planned, and accepted exception but no manual resolved state", () => {
    expect(WORKFLOW_STATUSES).toEqual(["open", "acknowledged", "planned", "accepted-exception"]);
    expect(WORKFLOW_STATUSES).not.toContain("resolved");
  });

  it("preserves recommendation and planning timestamp without claiming a store fix", () => {
    const imported = loadFixture("messy");
    const finding = runAudit(imported.catalog).findings[0];
    const workspace = workflowWorkspaceKey(imported.catalog);
    const planned = updateWorkflowRecord(
      finding,
      workspace,
      "planned",
      "Fix in next catalog update",
      undefined,
      "2026-08-12T01:00:00.000Z",
    );
    expect(planned).toMatchObject({
      logicalFindingKey: finding.logicalKey,
      ruleId: finding.ruleId,
      status: "planned",
      note: "Fix in next catalog update",
      plannedAt: "2026-08-12T01:00:00.000Z",
      recommendedRemediation: finding.recommendedFix,
    });
  });

  it("supports accepted exception and restoring to open", () => {
    const imported = loadFixture("messy");
    const finding = runAudit(imported.catalog).findings[0];
    const workspace = workflowWorkspaceKey(imported.catalog);
    const accepted = updateWorkflowRecord(finding, workspace, "accepted-exception", "Intentional ERP exception");
    const open = updateWorkflowRecord(finding, workspace, "open", accepted.note, accepted);
    expect(accepted.status).toBe("accepted-exception");
    expect(open.status).toBe("open");
    expect(open.note).toBe("Intentional ERP exception");
  });

  it("normalizes and bounds plain-text merchant notes", () => {
    const note = normalizeWorkflowNote(`<script>alert("x")</script>\r\n${"a".repeat(600)}`);
    expect(note).toContain("<script>");
    expect(note).not.toContain("\r");
    expect(note.length).toBe(500);
  });

  it("persists only workflow records and can clear them", () => {
    const storage = new MemoryStorage();
    const imported = loadFixture("messy");
    const finding = runAudit(imported.catalog).findings[0];
    const record = updateWorkflowRecord(
      finding,
      workflowWorkspaceKey(imported.catalog),
      "acknowledged",
      "Waiting on photographer",
    );
    saveWorkflowRecords(storage, [record]);
    expect(loadWorkflowRecords(storage).records).toEqual([record]);
    clearWorkflowRecords(storage);
    expect(loadWorkflowRecords(storage)).toEqual({ records: [] });
  });

  it("fails closed on malformed or unsupported persisted workflow data", () => {
    const storage = new MemoryStorage();
    storage.setItem("catalog-qa.workflow.v1", "{bad");
    expect(loadWorkflowRecords(storage)).toMatchObject({ records: [], diagnostic: expect.any(String) });
    storage.setItem("catalog-qa.workflow.v1", JSON.stringify({ schemaVersion: "future", records: [] }));
    expect(loadWorkflowRecords(storage)).toMatchObject({ records: [], diagnostic: expect.any(String) });
  });
});
