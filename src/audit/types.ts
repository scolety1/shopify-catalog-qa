import type { Catalog, SourceProvenance } from "../catalog";
import type { LogicalEntityIdentity } from "./identity";

export type Severity = "high" | "medium" | "low";
export type FindingClassification = "deterministic" | "heuristic";
export type AffectedEntityType = "catalog" | "product" | "variant" | "image";

export interface EvidenceItem {
  label: string;
  value: string | number | boolean | null;
}

export interface Finding {
  id: string;
  logicalKey: string;
  logicalEntity: LogicalEntityIdentity;
  findingDiscriminator: string | null;
  ruleId: string;
  severity: Severity;
  category: RuleCategory;
  classification: FindingClassification;
  affectedEntityType: AffectedEntityType;
  affectedEntityId: string;
  productId: string | null;
  productTitle: string | null;
  message: string;
  evidence: EvidenceItem[];
  provenance: SourceProvenance[];
  recommendedFix: string;
}

export type RuleCategory = "SKU" | "Media" | "Variant integrity" | "Price" | "Inventory" | "Product integrity";

export interface RuleApplicability {
  scope: AffectedEntityType;
  appliesWhen: string;
  abstainsWhen: string;
}

export interface AuditRule {
  id: string;
  version: number;
  title: string;
  description: string;
  category: RuleCategory;
  defaultSeverity: Severity;
  rationale: string;
  recommendedFix: string;
  applicability: RuleApplicability;
  classification: FindingClassification;
  evaluate: (catalog: Catalog) => Finding[];
}

export interface AuditResult {
  findings: Finding[];
  rulesExecuted: string[];
  rulesSkipped: Array<{ id: string; reason: string }>;
}
