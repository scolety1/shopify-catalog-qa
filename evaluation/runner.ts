import Ajv2020 from "ajv/dist/2020";
import { auditRules, runAudit, type Finding } from "../src/audit";
import { importNativeJson, importShopifyCsv, type ImportResult } from "../src/catalog";
import schema from "./adversarial-manifest.v1.schema.json";
import { adversarialManifest } from "./scenarios";
import type { AdversarialScenario, EvaluationReport, ExpectedFinding, FindingTarget, RuleMetric, ScenarioResult } from "./types";

function round(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }
function metric(numerator: number, denominator: number): number | null { return denominator === 0 ? null : round(numerator / denominator); }

function targetKey(target: FindingTarget): string {
  if (target.sourceId) return `${target.type}:source:${target.sourceId.trim()}`;
  if (target.handle) return `${target.type}:handle:${target.handle.trim().toLocaleLowerCase()}`;
  if (target.mediaSource) return `${target.type}:media:${target.mediaSource.trim()}`;
  return target.type;
}

function findingTargetKey(finding: Finding): string {
  if (finding.logicalEntity.sourceId) return `${finding.affectedEntityType}:source:${finding.logicalEntity.sourceId.trim()}`;
  if (finding.affectedEntityType === "image" && finding.logicalEntity.mediaSource) return `image:media:${finding.logicalEntity.mediaSource.trim()}`;
  if (finding.affectedEntityType === "product" && finding.logicalEntity.handle) return `product:handle:${finding.logicalEntity.handle.trim().toLocaleLowerCase()}`;
  if (finding.affectedEntityType === "catalog") return "catalog";
  return `${finding.affectedEntityType}:local:${finding.affectedEntityId}`;
}

function expectedKey(item: ExpectedFinding): string { return `${item.ruleId}|${targetKey(item.target)}|${item.severity}`; }
function actualKey(item: Finding): string { return `${item.ruleId}|${findingTargetKey(item)}|${item.severity}`; }

function multisetDifference(left: string[], right: string[]): string[] {
  const remaining = [...right];
  return left.filter((value) => { const index = remaining.indexOf(value); if (index < 0) return true; remaining.splice(index, 1); return false; });
}

function multisetIntersection(left: string[], right: string[]): string[] {
  const remaining = [...right];
  return left.filter((value) => { const index = remaining.indexOf(value); if (index < 0) return false; remaining.splice(index, 1); return true; });
}

function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) return current[Number(segment)];
    if (typeof current === "object") return (current as Record<string, unknown>)[segment];
    return undefined;
  }, value);
}

function importScenario(scenario: AdversarialScenario): ImportResult {
  return scenario.source.format === "shopify-product-csv"
    ? importShopifyCsv(scenario.source.value, scenario.source.filename)
    : importNativeJson(scenario.source.value, scenario.source.filename);
}

function evaluateScenario(scenario: AdversarialScenario): ScenarioResult {
  const imported = importScenario(scenario);
  const audit = runAudit(imported.catalog);
  const expectedFindingKeys = scenario.expectedFindings.map(expectedKey);
  const actualFindingKeys = audit.findings.map(actualKey);
  const truePositives = multisetIntersection(actualFindingKeys, expectedFindingKeys);
  const falsePositives = multisetDifference(actualFindingKeys, expectedFindingKeys);
  const falseNegatives = multisetDifference(expectedFindingKeys, actualFindingKeys);
  const diagnosticCodes = imported.issues.map((issue) => issue.code);
  const diagnosticFailures = [
    ...(scenario.expectedDiagnostics?.required ?? []).filter((code) => !diagnosticCodes.includes(code)).map((code) => `Missing required diagnostic ${code}`),
    ...(scenario.expectedDiagnostics?.forbidden ?? []).filter((code) => diagnosticCodes.includes(code)).map((code) => `Forbidden diagnostic ${code} was emitted`),
    ...(scenario.forbiddenRuleIds ?? []).filter((ruleId) => audit.findings.some((item) => item.ruleId === ruleId)).map((ruleId) => `Explicitly forbidden finding ${ruleId} was emitted`),
  ];
  const factRoot = { catalog: imported.catalog, metadata: imported.metadata, issues: imported.issues };
  const normalizationFailures = (scenario.expectedFacts ?? []).flatMap((fact) => {
    const actual = readPath(factRoot, fact.path);
    return JSON.stringify(actual) === JSON.stringify(fact.equals) ? [] : [`${fact.path}: expected ${JSON.stringify(fact.equals)}, received ${JSON.stringify(actual)}`];
  });
  return {
    id: scenario.id, family: scenario.family,
    passed: falsePositives.length === 0 && falseNegatives.length === 0 && diagnosticFailures.length === 0 && normalizationFailures.length === 0,
    expectedFindingKeys, actualFindingKeys, truePositives, falsePositives, falseNegatives,
    diagnosticFailures, normalizationFailures, importerDiagnostics: diagnosticCodes,
  };
}

export function evaluateAdversarialCorpus(label = "current"): EvaluationReport {
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  if (!validate(adversarialManifest)) throw new Error(`Adversarial manifest schema validation failed: ${JSON.stringify(validate.errors)}`);
  const ids = adversarialManifest.scenarios.map((scenario) => scenario.id);
  if (new Set(ids).size !== ids.length) throw new Error("Adversarial scenario IDs must be unique.");
  const scenarios = adversarialManifest.scenarios.map(evaluateScenario);
  const allExpected = scenarios.flatMap((scenario) => scenario.expectedFindingKeys);
  const allActual = scenarios.flatMap((scenario) => scenario.actualFindingKeys);
  const truePositives = scenarios.reduce((total, scenario) => total + scenario.truePositives.length, 0);
  const falsePositives = scenarios.reduce((total, scenario) => total + scenario.falsePositives.length, 0);
  const falseNegatives = scenarios.reduce((total, scenario) => total + scenario.falseNegatives.length, 0);
  const ruleIds = [...new Set([...auditRules.map((rule) => rule.id), ...allExpected.map((key) => key.split("|", 1)[0]), ...allActual.map((key) => key.split("|", 1)[0])])].sort();
  const ruleMetrics: RuleMetric[] = ruleIds.map((ruleId) => {
    const prefix = `${ruleId}|`;
    const tp = scenarios.reduce((total, scenario) => total + scenario.truePositives.filter((key) => key.startsWith(prefix)).length, 0);
    const fp = scenarios.reduce((total, scenario) => total + scenario.falsePositives.filter((key) => key.startsWith(prefix)).length, 0);
    const fn = scenarios.reduce((total, scenario) => total + scenario.falseNegatives.filter((key) => key.startsWith(prefix)).length, 0);
    return { ruleId, truePositives: tp, falsePositives: fp, falseNegatives: fn, precision: metric(tp, tp + fp), recall: metric(tp, tp + fn) };
  });
  const exactScenarioPasses = scenarios.filter((scenario) => scenario.passed).length;
  const diagnosticFailures = scenarios.reduce((total, scenario) => total + scenario.diagnosticFailures.length, 0);
  const normalizationFailures = scenarios.reduce((total, scenario) => total + scenario.normalizationFailures.length, 0);
  const allScenariosExact = exactScenarioPasses === scenarios.length;
  const zeroFalsePositives = falsePositives === 0;
  const zeroFalseNegatives = falseNegatives === 0;
  return {
    schemaVersion: "catalog-qa.adversarial-evaluation.v1", label, manifestVersion: adversarialManifest.schemaVersion,
    scenarioFamilies: new Set(scenarios.map((scenario) => scenario.family)).size,
    totalScenarios: scenarios.length, exactScenarioPasses, exactScenarioPassRate: metric(exactScenarioPasses, scenarios.length) ?? 0,
    expectedFindings: allExpected.length, actualFindings: allActual.length, truePositives, falsePositives, falseNegatives,
    precision: metric(truePositives, truePositives + falsePositives), recall: metric(truePositives, truePositives + falseNegatives),
    diagnosticFailures, normalizationFailures, ruleMetrics, scenarios,
    gates: { zeroFalsePositives, zeroFalseNegatives, allScenariosExact, passed: zeroFalsePositives && zeroFalseNegatives && allScenariosExact && diagnosticFailures === 0 && normalizationFailures === 0 },
  };
}

export function formatEvaluationSummary(report: EvaluationReport): string {
  const percent = (value: number | null) => value === null ? "n/a" : `${(value * 100).toFixed(2)}%`;
  const lines = [
    `Adversarial evaluation: ${report.label}`,
    `${report.totalScenarios} scenarios across ${report.scenarioFamilies} families`,
    `Exact scenarios: ${report.exactScenarioPasses}/${report.totalScenarios} (${percent(report.exactScenarioPassRate)})`,
    `Findings: expected ${report.expectedFindings}, actual ${report.actualFindings}, TP ${report.truePositives}, FP ${report.falsePositives}, FN ${report.falseNegatives}`,
    `Precision ${percent(report.precision)} | Recall ${percent(report.recall)}`,
    `Importer diagnostic failures ${report.diagnosticFailures} | Normalization failures ${report.normalizationFailures}`, "", "Rule metrics:",
    ...report.ruleMetrics.map((rule) => `- ${rule.ruleId}: TP ${rule.truePositives}, FP ${rule.falsePositives}, FN ${rule.falseNegatives}, precision ${percent(rule.precision)}, recall ${percent(rule.recall)}`),
  ];
  const failures = report.scenarios.filter((scenario) => !scenario.passed);
  if (failures.length > 0) {
    lines.push("", `Failed scenarios (${failures.length}):`);
    for (const scenario of failures) lines.push(`- ${scenario.id}: FP [${scenario.falsePositives.join(", ")}] FN [${scenario.falseNegatives.join(", ")}] diagnostics [${scenario.diagnosticFailures.join("; ")}] normalization [${scenario.normalizationFailures.join("; ")}]`);
  }
  lines.push("", `Hard gates: ${report.gates.passed ? "PASS" : "FAIL"}`);
  return lines.join("\n");
}
