import { describe, expect, it } from "vitest";
import {
  compareAuditRuns,
  createAuditRun,
  runAudit,
  type AuditComparison,
  type AuditRun,
} from "../src/audit";
import { importNativeJson, type ImportResult } from "../src/catalog";
import { loadFixture } from "../src/fixtures";

function run(imported: ImportResult, time: string): AuditRun {
  return createAuditRun(imported, runAudit(imported.catalog), [], time);
}

function native(products: unknown[]): ImportResult {
  return importNativeJson({ schemaVersion: "catalog-qa.catalog.v1", products }, "identity-test.json");
}

function product(
  overrides: Record<string, unknown> = {},
  variantOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sourceProductId: "product-1",
    handle: "identity-product",
    title: "Identity product",
    description: "",
    status: "active",
    options: [],
    variants: [{
      sourceVariantId: "variant-1",
      title: "Default",
      sku: "SKU-1",
      price: "10.00",
      options: {},
      ...variantOverrides,
    }],
    images: [],
    ...overrides,
  };
}

function summary(comparison: AuditComparison) {
  return comparison.summary;
}

describe("logical finding identity", () => {
  it("keeps a finding key stable across unrelated source changes", () => {
    const baseline = loadFixture("messy");
    const changed = structuredClone(baseline);
    changed.catalog.products[0].description = "An unrelated description edit.";
    changed.catalog.products[0].tags.push("new-tag");
    const before = runAudit(baseline.catalog).findings.find((item) => item.ruleId === "PRICE_NEGATIVE");
    const after = runAudit(changed.catalog).findings.find((item) => item.ruleId === "PRICE_NEGATIVE");
    expect(before?.logicalKey).toBe(after?.logicalKey);
  });

  it("keeps negative price identity when the remediation value changes but remains invalid", () => {
    const baseline = run(loadFixture("messy"), "2026-08-12T00:00:00.000Z");
    const improved = run(loadFixture("improved"), "2026-08-13T00:00:00.000Z");
    const item = compareAuditRuns(baseline, improved).items.find((entry) =>
      entry.baseline?.ruleId === "PRICE_NEGATIVE");
    expect(item).toMatchObject({ status: "changed", confidence: "exact", matchMethod: "stable-source-id" });
    expect(item?.baseline?.logicalKey).toBe(item?.current?.logicalKey);
  });

  it("recognizes a duplicate SKU group that shrinks but remains invalid", () => {
    const variants = [1, 2, 3].map((index) => ({
      sourceVariantId: `variant-${index}`,
      title: `Variant ${index}`,
      sku: "DUPLICATE",
      price: "10.00",
      options: {},
    }));
    const baselineImport = native([{ ...product(), variants }]);
    const currentImport = native([{ ...product(), variants: variants.map((variant, index) =>
      index === 2 ? { ...variant, sku: "REPAIRED" } : variant) }]);
    const comparison = compareAuditRuns(
      run(baselineImport, "2026-08-12T00:00:00.000Z"),
      run(currentImport, "2026-08-13T00:00:00.000Z"),
    );
    const duplicateItems = comparison.items.filter((item) => item.baseline?.ruleId === "SKU_DUPLICATE");
    expect(duplicateItems.filter((item) => item.status === "changed")).toHaveLength(2);
    expect(duplicateItems.filter((item) => item.status === "verified-resolved")).toHaveLength(1);
  });
});

describe("deterministic audit comparison", () => {
  it("locks the improved catalog exact comparison summary", () => {
    const comparison = compareAuditRuns(
      run(loadFixture("messy"), "2026-08-12T00:00:00.000Z"),
      run(loadFixture("improved"), "2026-08-13T00:00:00.000Z"),
      "2026-08-13T01:00:00.000Z",
    );
    expect(summary(comparison)).toEqual({
      baselineFindings: 15,
      currentFindings: 3,
      verifiedResolved: 12,
      stillPresent: 1,
      new: 0,
      changed: 2,
      uncertain: 0,
      highResolved: 8,
      highRemaining: 2,
      highNew: 0,
    });
  });

  it("locks the regression catalog exact comparison summary including new defects", () => {
    const comparison = compareAuditRuns(
      run(loadFixture("messy"), "2026-08-12T00:00:00.000Z"),
      run(loadFixture("regression"), "2026-08-13T00:00:00.000Z"),
    );
    expect(summary(comparison)).toEqual({
      baselineFindings: 15,
      currentFindings: 6,
      verifiedResolved: 12,
      stillPresent: 1,
      new: 3,
      changed: 2,
      uncertain: 0,
      highResolved: 8,
      highRemaining: 2,
      highNew: 1,
    });
  });

  it("classifies a severity change as materially changed", () => {
    const baseline = run(native([product({ status: "active" })]), "2026-08-12T00:00:00.000Z");
    const current = run(native([product({ status: "active" })]), "2026-08-13T00:00:00.000Z");
    const currentFinding = current.findings.find((finding) => finding.ruleId === "MEDIA_PRODUCT_NO_IMAGE");
    if (currentFinding) currentFinding.severity = "medium";
    const item = compareAuditRuns(baseline, current).items.find((entry) =>
      entry.baseline?.ruleId === "MEDIA_PRODUCT_NO_IMAGE");
    expect(item).toMatchObject({ status: "changed", confidence: "exact" });
    expect(item?.baseline?.severity).toBe("high");
    expect(item?.current?.severity).toBe("medium");
  });

  it("emits uncertain results when logical entity identity is ambiguous", () => {
    const duplicateHandleProducts = [
      product({ sourceProductId: null, handle: "same-handle", title: "First" }),
      product({ sourceProductId: null, handle: "same-handle", title: "Second" }, { sourceVariantId: null }),
    ];
    const baseline = run(native(duplicateHandleProducts), "2026-08-12T00:00:00.000Z");
    const current = run(native(duplicateHandleProducts), "2026-08-13T00:00:00.000Z");
    const comparison = compareAuditRuns(baseline, current);
    expect(comparison.summary.uncertain).toBeGreaterThan(0);
    expect(comparison.items.filter((item) => item.status === "uncertain"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ confidence: "ambiguous" })]));
  });

  it("treats entity deletion as uncertain rather than verified resolution", () => {
    const baseline = run(native([product()]), "2026-08-12T00:00:00.000Z");
    const current = run(native([]), "2026-08-13T00:00:00.000Z");
    const comparison = compareAuditRuns(baseline, current);
    expect(comparison.summary.verifiedResolved).toBe(0);
    expect(comparison.summary.uncertain).toBe(1);
    expect(comparison.items[0].explanation).toContain("deletion and resolution are not treated as the same fact");
  });

  it("keeps source fingerprint, logical identity, finding instance, workflow, and comparison identities separate", () => {
    const imported = loadFixture("messy");
    const first = run(imported, "2026-08-12T00:00:00.000Z");
    const second = run(imported, "2026-08-12T01:00:00.000Z");
    expect(first.source.fingerprint).toBe(second.source.fingerprint);
    expect(first.findings[0].logicalKey).toBe(second.findings[0].logicalKey);
    expect(first.findings[0].instanceId).not.toBe(second.findings[0].instanceId);
    expect(JSON.stringify(first)).not.toContain("rawSource");
  });
});
