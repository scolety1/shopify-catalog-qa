import type { Severity } from "../src/audit";

export const ADVERSARIAL_MANIFEST_VERSION = "catalog-qa.adversarial-manifest.v1" as const;

export type ScenarioSource =
  | { format: "catalog-qa-json-v1"; filename: string; value: unknown }
  | { format: "shopify-product-csv"; filename: string; value: string };

export interface FindingTarget {
  type: "catalog" | "product" | "variant" | "image";
  sourceId?: string;
  handle?: string;
  mediaSource?: string;
}

export interface ExpectedFinding {
  ruleId: string;
  target: FindingTarget;
  severity: Severity;
  rationale: string;
}

export interface ExpectedFact {
  path: string;
  equals: unknown;
  rationale: string;
}

export interface AdversarialScenario {
  id: string;
  family: string;
  description: string;
  tags: string[];
  rationale: string;
  source: ScenarioSource;
  expectedFindings: ExpectedFinding[];
  forbiddenRuleIds?: string[];
  expectedDiagnostics?: { required?: string[]; forbidden?: string[] };
  expectedFacts?: ExpectedFact[];
  policy?: Record<string, string>;
}

export interface AdversarialManifest {
  schemaVersion: typeof ADVERSARIAL_MANIFEST_VERSION;
  description: string;
  scenarios: AdversarialScenario[];
}

export interface RuleMetric {
  ruleId: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number | null;
  recall: number | null;
}

export interface ScenarioResult {
  id: string;
  family: string;
  passed: boolean;
  expectedFindingKeys: string[];
  actualFindingKeys: string[];
  truePositives: string[];
  falsePositives: string[];
  falseNegatives: string[];
  diagnosticFailures: string[];
  normalizationFailures: string[];
  importerDiagnostics: string[];
}

export interface EvaluationReport {
  schemaVersion: "catalog-qa.adversarial-evaluation.v1";
  label: string;
  manifestVersion: typeof ADVERSARIAL_MANIFEST_VERSION;
  scenarioFamilies: number;
  totalScenarios: number;
  exactScenarioPasses: number;
  exactScenarioPassRate: number;
  expectedFindings: number;
  actualFindings: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number | null;
  recall: number | null;
  diagnosticFailures: number;
  normalizationFailures: number;
  ruleMetrics: RuleMetric[];
  scenarios: ScenarioResult[];
  gates: { zeroFalsePositives: boolean; zeroFalseNegatives: boolean; allScenariosExact: boolean; passed: boolean };
}
