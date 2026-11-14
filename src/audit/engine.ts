import type { Catalog } from "../catalog";
import { auditRules } from "./rules";
import type { AuditResult, AuditRule, Finding, Severity } from "./types";

const severityOrder: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function runAudit(catalog: Catalog, rules: AuditRule[] = auditRules): AuditResult {
  const findings: Finding[] = rules.flatMap((rule) => rule.evaluate(catalog));
  findings.sort((left, right) => {
    const severityDifference = severityOrder[left.severity] - severityOrder[right.severity];
    if (severityDifference !== 0) return severityDifference;
    const ruleDifference = left.ruleId.localeCompare(right.ruleId);
    if (ruleDifference !== 0) return ruleDifference;
    return left.affectedEntityId.localeCompare(right.affectedEntityId);
  });
  return { findings, rulesExecuted: rules.map((rule) => rule.id), rulesSkipped: [] };
}
