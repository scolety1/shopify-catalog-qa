import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importCatalogFile, importNativeJson } from "../src/catalog";

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

describe("catalog-qa.catalog.v1 native JSON contract", () => {
  it("accepts a valid v1 document and records adapter/schema metadata", () => {
    const result = importCatalogFile(fixture("catalog-qa-valid-v1.json"), "catalog-qa-valid-v1.json");
    expect(result.issues).toEqual([]);
    expect(result.metadata).toMatchObject({
      adapterId: "catalog-qa-json-v1",
      adapterVersion: 1,
      sourceFormat: "catalog-qa-json-v1",
      schemaVersion: "catalog-qa.catalog.v1",
      normalizedCounts: { products: 1, variants: 1, images: 1 },
    });
  });

  it("reports invalid v1 values at useful JSON paths while retaining safe partial data", () => {
    const result = importNativeJson(fixture("catalog-qa-invalid-v1.json"), "catalog-qa-invalid-v1.json");
    expect(result.issues.some((issue) => issue.path === "$.products[0].title")).toBe(true);
    expect(result.issues.some((issue) => issue.path === "$.products[0].variants[0].price")).toBe(true);
    expect(result.catalog.products).toEqual([]);
  });

  it("rejects an unknown future schema version without guessing", () => {
    const result = importNativeJson(fixture("catalog-qa-unknown-version.json"), "catalog-qa-unknown-version.json");
    expect(result.catalog.products).toEqual([]);
    expect(result.issues[0]).toMatchObject({
      level: "error",
      code: "JSON_SCHEMA_VERSION_UNSUPPORTED",
      path: "$.schemaVersion",
      rawValue: "catalog-qa.catalog.v2",
    });
  });

  it("rejects an unversioned native document", () => {
    const result = importNativeJson({ products: [] }, "unversioned.json");
    expect(result.catalog.products).toEqual([]);
    expect(result.issues[0].code).toBe("JSON_SCHEMA_VERSION_MISSING");
  });

  it("preserves source JSON paths and raw values after schema validation", () => {
    const result = importNativeJson(fixture("catalog-qa-valid-v1.json"), "catalog-qa-valid-v1.json");
    const variant = result.catalog.products[0].variants[0];
    expect(variant.provenance[0].jsonPath).toBe("$.products[0].variants[0]");
    expect(variant.provenance[0].rawValues).toMatchObject({ sku: "EXAMPLE-MUG", price: 18 });
  });
});