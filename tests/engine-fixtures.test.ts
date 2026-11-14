import { describe, expect, it } from "vitest";
import { runAudit } from "../src/audit";
import { loadFixture } from "../src/fixtures";
import mission3Expected from "../fixtures/mission3-messy-expected-v1.json";

describe("full fixture audit pipeline", () => {
  it("runs messy JSON through validation, normalization, registry, and findings", () => {
    const imported = loadFixture("messy");
    const audit = runAudit(imported.catalog);
    const ruleIds = new Set(audit.findings.map((finding) => finding.ruleId));

    expect(imported.issues.map((issue) => issue.code)).toEqual(["JSON_SCHEMA_ONEOF"]);
    expect(imported.issues[0].path).toBe("$.products[0].variants[3].price");
    expect(imported.catalog.products).toHaveLength(4);
    expect(audit.rulesExecuted).toHaveLength(16);
    expect(audit.findings).toHaveLength(15);
    expect(ruleIds).toEqual(new Set([
      "SKU_DUPLICATE",
      "SKU_MISSING",
      "MEDIA_PRODUCT_NO_IMAGE",
      "MEDIA_ALT_MISSING",
      "VARIANT_OPTION_INCOMPLETE",
      "VARIANT_OPTION_SCHEMA_MISMATCH",
      "PRICE_INVALID",
      "PRICE_NEGATIVE",
      "PRICE_COMPARE_AT_BELOW_PRICE",
      "INVENTORY_AVAILABILITY_CONFLICT",
    ]));
    expect(audit.findings.every((finding) => finding.classification === "deterministic")).toBe(true);
    expect(audit.findings.every((finding) => finding.provenance.length > 0)).toBe(true);
  });

  it("keeps the healthy fixture clear of current high-confidence findings", () => {
    const imported = loadFixture("healthy");
    expect(imported.issues).toEqual([]);
    expect(runAudit(imported.catalog).findings).toEqual([]);
  });

  it("freezes and explains the exact 17-to-15 messy baseline change", () => {
    const current = runAudit(loadFixture("messy").catalog).findings;
    const key = (finding: { ruleId: string; severity: string; affectedEntityId: string }) =>
      `${finding.ruleId}|${finding.severity}|${finding.affectedEntityId}`;
    const before = mission3Expected.findings.map(key);
    const after = current.map(key);
    expect(before).toHaveLength(17);
    expect(after).toHaveLength(15);
    expect(before.filter((item) => !after.includes(item))).toEqual([
      "VARIANT_OPTION_DUPLICATE|high|product:gid-shopify-product-2001:variant:gid-shopify-productvariant-2101",
      "VARIANT_OPTION_DUPLICATE|high|product:gid-shopify-product-2001:variant:gid-shopify-productvariant-2102",
      "MEDIA_PRODUCT_NO_IMAGE|low|product:gid-shopify-product-2003",
    ]);
    expect(after.filter((item) => !before.includes(item))).toEqual([
      "VARIANT_OPTION_SCHEMA_MISMATCH|high|product:gid-shopify-product-2001:variant:gid-shopify-productvariant-2102",
    ]);
  });
});
