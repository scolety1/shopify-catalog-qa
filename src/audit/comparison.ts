import type { AuditEntitySnapshot, AuditFindingInstance, AuditRun } from "./run";

export const AUDIT_COMPARISON_SCHEMA_VERSION = "catalog-qa.audit-comparison.v1";

export type ComparisonStatus = "still-present" | "verified-resolved" | "new" | "changed" | "uncertain";
export type MatchConfidence = "exact" | "strong" | "ambiguous" | "unmatched";
export type MatchMethod = "stable-source-id" | "logical-identity" | "ambiguous-identity" | "no-safe-match";

export interface FindingComparison {
  comparisonId: string;
  logicalFindingKey: string;
  status: ComparisonStatus;
  confidence: MatchConfidence;
  matchMethod: MatchMethod;
  explanation: string;
  baseline?: AuditFindingInstance;
  current?: AuditFindingInstance;
  workflow: AuditRun["workflow"];
}

export interface AuditComparison {
  schemaVersion: typeof AUDIT_COMPARISON_SCHEMA_VERSION;
  comparedAt: string;
  baseline: Pick<AuditRun, "runId" | "auditedAt" | "source" | "catalogSummary">;
  current: Pick<AuditRun, "runId" | "auditedAt" | "source" | "catalogSummary">;
  summary: {
    baselineFindings: number;
    currentFindings: number;
    verifiedResolved: number;
    stillPresent: number;
    new: number;
    changed: number;
    uncertain: number;
    highResolved: number;
    highRemaining: number;
    highNew: number;
  };
  items: FindingComparison[];
}

function entityCount(entities: AuditEntitySnapshot[], key: string): number {
  return entities.filter((entry) => entry.identity.key === key).length;
}

function findingMaterialSignature(finding: AuditFindingInstance): string {
  return JSON.stringify({
    severity: finding.severity,
    message: finding.message,
    evidence: finding.evidence,
  });
}

function matchMetadata(finding: AuditFindingInstance): {
  confidence: MatchConfidence;
  method: MatchMethod;
  label: string;
} {
  if (finding.logicalEntity.confidence === "exact") {
    return { confidence: "exact", method: "stable-source-id", label: "stable source entity ID" };
  }
  if (finding.logicalEntity.confidence === "strong") {
    return { confidence: "strong", method: "logical-identity", label: finding.logicalEntity.basis.replaceAll("-", " ") };
  }
  return { confidence: "unmatched", method: "no-safe-match", label: "unstable local identity" };
}

function compactRun(run: AuditRun): AuditComparison["baseline"] {
  return {
    runId: run.runId,
    auditedAt: run.auditedAt,
    source: run.source,
    catalogSummary: run.catalogSummary,
  };
}

export function compareAuditRuns(
  baseline: AuditRun,
  current: AuditRun,
  comparedAt = new Date().toISOString(),
): AuditComparison {
  const baselineByKey = new Map<string, AuditFindingInstance[]>();
  const currentByKey = new Map<string, AuditFindingInstance[]>();
  for (const finding of baseline.findings) {
    baselineByKey.set(finding.logicalKey, [...(baselineByKey.get(finding.logicalKey) ?? []), finding]);
  }
  for (const finding of current.findings) {
    currentByKey.set(finding.logicalKey, [...(currentByKey.get(finding.logicalKey) ?? []), finding]);
  }

  const keys = [...new Set([...baselineByKey.keys(), ...currentByKey.keys()])].sort();
  const items: FindingComparison[] = [];

  for (const key of keys) {
    const before = baselineByKey.get(key) ?? [];
    const after = currentByKey.get(key) ?? [];
    if (before.length > 1 || after.length > 1) {
      const count = Math.max(before.length, after.length);
      for (let index = 0; index < count; index += 1) {
        const prior = before[index];
        const next = after[index];
        items.push({
          comparisonId: `comparison:${key}:${index + 1}`,
          logicalFindingKey: key,
          status: "uncertain",
          confidence: "ambiguous",
          matchMethod: "ambiguous-identity",
          explanation: "Multiple finding instances share this logical identity, so continuity cannot be determined safely.",
          baseline: prior,
          current: next,
          workflow: baseline.workflow.filter((record) => record.logicalFindingKey === key),
        });
      }
      continue;
    }

    const prior = before[0];
    const next = after[0];
    if (prior && next) {
      const match = matchMetadata(prior);
      if (match.confidence === "unmatched") {
        items.push({
          comparisonId: `comparison:${key}`,
          logicalFindingKey: key,
          status: "uncertain",
          confidence: "unmatched",
          matchMethod: "no-safe-match",
          explanation: "The finding uses an unstable local entity identity and cannot be reconciled safely across audit runs.",
          baseline: prior,
          current: next,
          workflow: baseline.workflow.filter((record) => record.logicalFindingKey === key),
        });
        continue;
      }
      const changed = findingMaterialSignature(prior) !== findingMaterialSignature(next);
      items.push({
        comparisonId: `comparison:${key}`,
        logicalFindingKey: key,
        status: changed ? "changed" : "still-present",
        confidence: match.confidence,
        matchMethod: match.method,
        explanation: changed
          ? `The same rule and entity matched by ${match.label}; severity, evidence, or finding details changed materially.`
          : `The same rule and entity matched by ${match.label}, and its material evidence is unchanged.`,
        baseline: prior,
        current: next,
        workflow: baseline.workflow.filter((record) => record.logicalFindingKey === key),
      });
      continue;
    }

    if (prior) {
      const identity = prior.logicalEntity;
      const currentEntityCount = entityCount(current.entities, identity.key);
      if (identity.confidence !== "unmatched" && currentEntityCount === 1) {
        const match = matchMetadata(prior);
        items.push({
          comparisonId: `comparison:${key}`,
          logicalFindingKey: key,
          status: "verified-resolved",
          confidence: match.confidence,
          matchMethod: match.method,
          explanation: `The affected entity matched by ${match.label} is still present, and rule ${prior.ruleId} no longer emits this finding.`,
          baseline: prior,
          workflow: baseline.workflow.filter((record) => record.logicalFindingKey === key),
        });
      } else {
        const ambiguous = currentEntityCount > 1;
        items.push({
          comparisonId: `comparison:${key}`,
          logicalFindingKey: key,
          status: "uncertain",
          confidence: ambiguous ? "ambiguous" : "unmatched",
          matchMethod: ambiguous ? "ambiguous-identity" : "no-safe-match",
          explanation: ambiguous
            ? "More than one current entity matches the prior logical identity; the finding is not declared resolved."
            : "The affected entity is absent or cannot be reconciled confidently; deletion and resolution are not treated as the same fact.",
          baseline: prior,
          workflow: baseline.workflow.filter((record) => record.logicalFindingKey === key),
        });
      }
      continue;
    }

    if (next) {
      const duplicateEntityCount = entityCount(current.entities, next.logicalEntity.key);
      const safe = next.logicalEntity.confidence !== "unmatched" && duplicateEntityCount === 1;
      items.push({
        comparisonId: `comparison:${key}`,
        logicalFindingKey: key,
        status: safe ? "new" : "uncertain",
        confidence: safe ? matchMetadata(next).confidence : duplicateEntityCount > 1 ? "ambiguous" : "unmatched",
        matchMethod: safe ? matchMetadata(next).method : duplicateEntityCount > 1 ? "ambiguous-identity" : "no-safe-match",
        explanation: safe
          ? "This logical finding did not exist in the baseline audit and is newly introduced in the current audit."
          : "This current finding has no safely matchable entity identity, so prior continuity is uncertain.",
        current: next,
        workflow: [],
      });
    }
  }

  const count = (status: ComparisonStatus) => items.filter((item) => item.status === status).length;
  return {
    schemaVersion: AUDIT_COMPARISON_SCHEMA_VERSION,
    comparedAt,
    baseline: compactRun(baseline),
    current: compactRun(current),
    summary: {
      baselineFindings: baseline.findings.length,
      currentFindings: current.findings.length,
      verifiedResolved: count("verified-resolved"),
      stillPresent: count("still-present"),
      new: count("new"),
      changed: count("changed"),
      uncertain: count("uncertain"),
      highResolved: items.filter((item) => item.status === "verified-resolved" && item.baseline?.severity === "high").length,
      highRemaining: items.filter((item) =>
        (item.status === "still-present" || item.status === "changed") && item.current?.severity === "high").length,
      highNew: items.filter((item) => item.status === "new" && item.current?.severity === "high").length,
    },
    items,
  };
}
