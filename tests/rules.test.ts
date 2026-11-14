import { describe, expect, it } from "vitest";
import { auditRules, getRule } from "../src/audit";
import { importNativeJson, type Catalog } from "../src/catalog";
import { loadFixture } from "../src/fixtures";

interface VariantInput {
  id: string;
  sku?: string | null;
  price?: unknown;
  compareAtPrice?: unknown;
  options?: Record<string, string | null>;
  inventory?: { quantity?: number | null; tracked?: boolean | null; policy?: string | null };
  available?: boolean | null;
}

interface ProductOverrides {
  status?: string;
  options?: { name: string; values: string[] }[];
  variants?: VariantInput[];
  images?: { source: string; altText?: string | null }[];
}

function catalog(overrides: ProductOverrides = {}): Catalog {
  return importNativeJson({
    schemaVersion: "catalog-qa.catalog.v1",
    products: [{
      id: "p1",
      handle: "test-product",
      title: "Test product",
      status: overrides.status ?? "active",
      options: overrides.options ?? [],
      variants: overrides.variants ?? [{ id: "v1", sku: "SKU-1", price: 10, options: {} }],
      images: overrides.images ?? [{ source: "image.jpg", altText: "Test product" }],
    }],
  }, "rule-test.json").catalog;
}

function evaluate(ruleId: string, input: Catalog) {
  const rule = getRule(ruleId);
  if (!rule) throw new Error(`Missing rule ${ruleId}`);
  return rule.evaluate(input);
}

describe("independent deterministic rules", () => {
  it("SKU_DUPLICATE finds the same non-empty SKU on distinct variants", () => {
    const findings = evaluate("SKU_DUPLICATE", catalog({ variants: [
      { id: "v1", sku: "DUP-1", price: 10, options: {} },
      { id: "v2", sku: "DUP-1", price: 12, options: {} },
    ] }));
    expect(findings).toHaveLength(2);
    expect(findings[0].evidence[1].value).toContain("Test product");
  });

  it("SKU_MISSING treats blank SKU as a quality warning", () => {
    const findings = evaluate("SKU_MISSING", catalog({ variants: [
      { id: "v1", sku: "  ", price: 10, options: {} },
    ] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("medium");
  });

  it("MEDIA_PRODUCT_NO_IMAGE applies only to active products", () => {
    const active = evaluate("MEDIA_PRODUCT_NO_IMAGE", catalog({ images: [] }));
    const draft = evaluate("MEDIA_PRODUCT_NO_IMAGE", catalog({ status: "draft", images: [] }));
    expect(active[0].severity).toBe("high");
    expect(draft).toEqual([]);
  });

  it("MEDIA_ALT_MISSING finds blank alt text with image evidence", () => {
    const findings = evaluate("MEDIA_ALT_MISSING", catalog({ images: [{ source: "raw.jpg", altText: "" }] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence[0].value).toBe("raw.jpg");
  });

  it("VARIANT_OPTION_DUPLICATE trims transport whitespace without folding merchant-authored case", () => {
    const whitespace = evaluate("VARIANT_OPTION_DUPLICATE", catalog({
      options: [{ name: "Color", values: ["Blue"] }],
      variants: [
        { id: "v1", sku: "ONE", price: 10, options: { Color: "Blue" } },
        { id: "v2", sku: "TWO", price: 10, options: { Color: " Blue " } },
      ],
    }));
    const caseDistinct = evaluate("VARIANT_OPTION_DUPLICATE", catalog({
      options: [{ name: "Code", values: ["US", "us"] }],
      variants: [
        { id: "v1", sku: "ONE", price: 10, options: { Code: "US" } },
        { id: "v2", sku: "TWO", price: 10, options: { Code: "us" } },
      ],
    }));
    expect(whitespace).toHaveLength(2);
    expect(caseDistinct).toEqual([]);
  });

  it("VARIANT_OPTION_INCOMPLETE finds a missing required selection", () => {
    const findings = evaluate("VARIANT_OPTION_INCOMPLETE", catalog({
      options: [{ name: "Size", values: ["S"] }, { name: "Color", values: ["Blue"] }],
      variants: [{ id: "v1", sku: "ONE", price: 10, options: { Size: "S", Color: "" } }],
    }));
    expect(findings[0].evidence[0].value).toBe("Color");
  });

  it("VARIANT_OPTION_SCHEMA_MISMATCH finds unknown names and proven invalid values", () => {
    const findings = evaluate("VARIANT_OPTION_SCHEMA_MISMATCH", catalog({
      options: [{ name: "Color", values: ["Blue"] }],
      variants: [{ id: "v1", sku: "ONE", price: 10, options: { Color: "Green", Finish: "Gloss" } }],
    }));
    const evidence = findings[0].evidence.map((item) => String(item.value)).join(" ");
    expect(findings).toHaveLength(1);
    expect(evidence).toContain("Finish");
    expect(evidence).toContain("Color=Green");
  });

  it("PRICE_INVALID finds non-numeric and missing prices", () => {
    const malformed = evaluate("PRICE_INVALID", catalog({ variants: [{ id: "v1", sku: "ONE", price: "ten", options: {} }] }));
    const missing = evaluate("PRICE_INVALID", catalog({ variants: [{ id: "v1", sku: "ONE", options: {} }] }));
    expect(malformed).toHaveLength(1);
    expect(missing).toHaveLength(1);
  });

  it("PRICE_NEGATIVE finds negative selling or compare-at amounts", () => {
    const findings = evaluate("PRICE_NEGATIVE", catalog({ variants: [
      { id: "v1", sku: "ONE", price: -1, compareAtPrice: -2, options: {} },
    ] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence[0].value).toContain("price=-1");
  });

  it("PRICE_COMPARE_AT_BELOW_PRICE ignores zero sentinel but flags a positive inversion", () => {
    const inverted = evaluate("PRICE_COMPARE_AT_BELOW_PRICE", catalog({ variants: [
      { id: "v1", sku: "ONE", price: 20, compareAtPrice: 10, options: {} },
    ] }));
    const zero = evaluate("PRICE_COMPARE_AT_BELOW_PRICE", catalog({ variants: [
      { id: "v1", sku: "ONE", price: 20, compareAtPrice: 0, options: {} },
    ] }));
    expect(inverted).toHaveLength(1);
    expect(zero).toHaveLength(0);
  });

  it("INVENTORY_AVAILABILITY_CONFLICT requires all conservative evidence", () => {
    const conflicting = evaluate("INVENTORY_AVAILABILITY_CONFLICT", catalog({ variants: [{
      id: "v1", sku: "ONE", price: 10, options: {},
      inventory: { quantity: 0, tracked: true, policy: "deny" }, available: true,
    }] }));
    const backorder = evaluate("INVENTORY_AVAILABILITY_CONFLICT", catalog({ variants: [{
      id: "v1", sku: "ONE", price: 10, options: {},
      inventory: { quantity: 0, tracked: true, policy: "continue" }, available: true,
    }] }));
    const unknown = evaluate("INVENTORY_AVAILABILITY_CONFLICT", catalog({ variants: [{
      id: "v1", sku: "ONE", price: 10, options: {}, available: true,
    }] }));
    expect(conflicting).toHaveLength(1);
    expect(backorder).toHaveLength(0);
    expect(unknown).toHaveLength(0);
  });

  it("new product and source identity rules have positive and negative boundaries", () => {
    const duplicates = importNativeJson({
      schemaVersion: "catalog-qa.catalog.v1",
      products: [
        { id: "same-product", handle: "shared", title: "First", status: "active", options: [], variants: [{ id: "v1", sku: "ONE", price: 10, options: {} }], images: [{ source: "one.jpg", altText: "One" }] },
        { id: "same-product", handle: "SHARED", title: "Second", status: "active", options: [], variants: [{ id: "v2", sku: "TWO", price: 10, options: {} }], images: [{ source: "two.jpg", altText: "Two" }] },
      ],
    }, "identity-rules.json").catalog;
    const clean = importNativeJson({
      schemaVersion: "catalog-qa.catalog.v1",
      products: [
        { id: "p1", handle: "first", title: "First", status: "active", options: [], variants: [{ id: "v1", sku: "ONE", price: 10, options: {} }], images: [{ source: "one.jpg", altText: "One" }] },
        { id: "p2", handle: "second", title: "Second", status: "active", options: [], variants: [{ id: "v2", sku: "TWO", price: 10, options: {} }], images: [{ source: "two.jpg", altText: "Two" }] },
      ],
    }, "identity-clean.json").catalog;
    expect(evaluate("PRODUCT_HANDLE_DUPLICATE", duplicates)).toHaveLength(2);
    expect(evaluate("PRODUCT_ID_DUPLICATE", duplicates)).toHaveLength(2);
    expect(evaluate("PRODUCT_HANDLE_DUPLICATE", clean)).toEqual([]);
    expect(evaluate("PRODUCT_ID_DUPLICATE", clean)).toEqual([]);
  });

  it("VARIANT_ID_DUPLICATE detects exact source collisions and ignores distinct IDs", () => {
    const duplicate = catalog({ variants: [
      { id: "same", sku: "ONE", price: 10, options: {} },
      { id: "same", sku: "TWO", price: 10, options: {} },
    ] });
    const distinct = catalog({ variants: [
      { id: "one", sku: "ONE", price: 10, options: {} },
      { id: "two", sku: "TWO", price: 10, options: {} },
    ] });
    expect(evaluate("VARIANT_ID_DUPLICATE", duplicate)).toHaveLength(2);
    expect(evaluate("VARIANT_ID_DUPLICATE", distinct)).toEqual([]);
  });

  it("PRODUCT_NO_VARIANTS applies to active products and abstains for drafts", () => {
    expect(evaluate("PRODUCT_NO_VARIANTS", catalog({ variants: [] }))).toHaveLength(1);
    expect(evaluate("PRODUCT_NO_VARIANTS", catalog({ status: "draft", variants: [] }))).toEqual([]);
  });

  it("PRODUCT_OPTION_VALUES_MISSING requires an active declared empty value set", () => {
    expect(evaluate("PRODUCT_OPTION_VALUES_MISSING", catalog({ options: [{ name: "Color", values: [] }] }))).toHaveLength(1);
    expect(evaluate("PRODUCT_OPTION_VALUES_MISSING", catalog({ options: [{ name: "Color", values: ["Blue"] }] }))).toEqual([]);
  });

  it("every deterministic rule documents applicability and abstention", () => {
    expect(auditRules.every((rule) => rule.applicability.appliesWhen && rule.applicability.abstainsWhen)).toBe(true);
  });

  it("all rules remain quiet on healthy and legal-looking edge fixtures", () => {
    for (const fixtureId of ["healthy", "edge"] as const) {
      const input = loadFixture(fixtureId).catalog;
      for (const rule of auditRules) {
        expect(rule.evaluate(input), `${rule.id} flagged ${fixtureId}`).toEqual([]);
      }
    }
  });
});
