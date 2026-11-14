import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import healthyStore from "../fixtures/healthy-store.json";
import { importNativeJson, importShopifyCsv } from "../src/catalog";

describe("Shopify-style CSV adapter", () => {
  it("combines legacy product rows, variants, options, and images", () => {
    const csv = readFileSync(new URL("../fixtures/shopify-style.csv", import.meta.url), "utf8");
    const result = importShopifyCsv(csv, "shopify-style.csv");

    expect(result.issues.filter((issue) => issue.level === "error")).toEqual([]);
    expect(result.metadata).toMatchObject({
      adapterId: "shopify-product-csv",
      adapterVersion: 3,
      sourceFormat: "shopify-product-csv",
    });
    expect(result.catalog.products).toHaveLength(2);
    expect(result.catalog.products[0]).toMatchObject({ handle: "ridge-bottle", title: "Ridge Bottle" });
    expect(result.catalog.products[0].variants).toHaveLength(2);
    expect(result.catalog.products[0].options.map((option) => option.name)).toEqual(["Color", "Size"]);
    expect(result.catalog.products[0].images).toHaveLength(1);
  });

  it("preserves source row and every raw CSV column on variants", () => {
    const csv = readFileSync(new URL("../fixtures/shopify-style.csv", import.meta.url), "utf8");
    const variant = importShopifyCsv(csv, "shopify-style.csv").catalog.products[0].variants[1];

    expect(variant.provenance[0].rowNumber).toBe(3);
    expect(variant.provenance[0].sourceName).toBe("shopify-style.csv");
    expect(variant.provenance[0].rawValues["Variant SKU"]).toBe("BOTTLE-20-MOSS");
  });

  it("derives a local handle from Title without discarding partial variant data", () => {
    const result = importShopifyCsv("Title,Variant SKU,Variant Price\nBroken,ABC,12", "partial.csv");
    expect(result.catalog.products).toHaveLength(1);
    expect(result.catalog.products[0].handle).toBe("broken");
    expect(result.catalog.products[0].variants[0].sku).toBe("ABC");
    expect(result.issues.map((issue) => issue.code)).toContain("CSV_HANDLE_DERIVED");
  });
});

describe("native JSON v1 adapter", () => {
  it("normalizes products, variants, images, metadata, and JSON provenance", () => {
    const result = importNativeJson(healthyStore, "healthy-store.json", "fixture");
    const product = result.catalog.products[0];
    const variant = product.variants[0];

    expect(result.issues).toEqual([]);
    expect(result.metadata.schemaVersion).toBe("catalog-qa.catalog.v1");
    expect(result.metadata.normalizedCounts).toEqual({ products: 3, variants: 5, images: 4 });
    expect(product.status).toBe("active");
    expect(variant.price.value).toBe(24);
    expect(variant.provenance[0].jsonPath).toBe("$.products[0].variants[0]");
    expect(variant.provenance[0].rawValues.sku).toBe("MUG-CANYON");
  });

  it("reports parse and missing-version errors", () => {
    const parseFailure = importNativeJson("{bad json", "broken.json");
    const versionFailure = importNativeJson({ products: [] }, "wrong-version.json");

    expect(parseFailure.issues[0].code).toBe("JSON_PARSE_ERROR");
    expect(versionFailure.issues[0].code).toBe("JSON_SCHEMA_VERSION_MISSING");
    expect(parseFailure.catalog.products).toEqual([]);
    expect(versionFailure.catalog.products).toEqual([]);
  });

  it("retains valid products while reporting invalid v1 entities with JSON paths", () => {
    const result = importNativeJson({
      schemaVersion: "catalog-qa.catalog.v1",
      products: [
        { id: "bad", handle: "bad", variants: [], images: [] },
        {
          id: "good", handle: "good", title: "Good product", status: "draft", options: [],
          variants: [{ id: "v1", sku: "GOOD-1", price: 10, options: {} }],
          images: [{ source: "good.jpg", altText: "Good product" }],
        },
      ],
    }, "partial.json");

    expect(result.catalog.products).toHaveLength(1);
    expect(result.catalog.products[0].title).toBe("Good product");
    expect(result.issues.some((issue) => issue.path === "$.products[0].title")).toBe(true);
  });
});
