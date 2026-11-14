import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runAudit } from "../src/audit";
import { importShopifyCsv } from "../src/catalog";

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

describe("Shopify CSV compatibility envelope", () => {
  it("imports a current simple product with two images and one real variant", () => {
    const result = importShopifyCsv(fixture("shopify-current-simple.csv"), "shopify-current-simple.csv");
    expect(result.issues.filter((issue) => issue.level === "error")).toEqual([]);
    expect(result.metadata.normalizedCounts).toEqual({ products: 1, variants: 1, images: 2 });
    expect(result.catalog.products[0]).toMatchObject({
      handle: "river-candle",
      title: "River Candle",
      vendor: "Northline Goods",
      status: "active",
      publishedOnOnlineStore: true,
    });
    expect(result.catalog.products[0].options).toEqual([]);
    expect(result.catalog.products[0].images.map((image) => image.altText)).toEqual([
      "River Candle in an amber jar",
      "River Candle beside its packaging",
    ]);
  });

  it("reconstructs continuation variants with one, two, and three options", () => {
    const result = importShopifyCsv(fixture("shopify-current-variants.csv"), "shopify-current-variants.csv");
    expect(result.issues.filter((issue) => issue.level === "error")).toEqual([]);
    expect(result.metadata.normalizedCounts.products).toBe(3);
    expect(result.metadata.normalizedCounts.variants).toBe(6);
    expect(result.catalog.products.map((product) => product.options.length)).toEqual([1, 2, 3]);
    expect(result.catalog.products[1].variants[1].optionValues).toEqual({ Size: "Medium", Color: "Ink" });
    expect(result.catalog.products[2].variants[1].optionValues).toEqual({ Capacity: "30L", Color: "Black", Material: "Canvas" });
    expect(result.catalog.products[1].title).toBe("Linen Shirt");
    expect(result.catalog.products[1].vendor).toBe("Field Loom");
  });

  it("does not manufacture variants from image-only continuation rows", () => {
    const result = importShopifyCsv(fixture("shopify-image-continuation.csv"), "shopify-image-continuation.csv");
    const product = result.catalog.products[0];
    expect(result.catalog.products).toHaveLength(1);
    expect(product.variants).toHaveLength(1);
    expect(product.images).toHaveLength(3);
    expect(product.images.map((image) => image.provenance[0].rowNumber)).toEqual([2, 3, 4]);
    expect(runAudit(result.catalog).findings.filter((finding) => finding.ruleId === "VARIANT_OPTION_DUPLICATE")).toEqual([]);
  });

  it("normalizes supported legacy aliases equivalently to current core fields", () => {
    const current = importShopifyCsv(fixture("shopify-current-simple.csv"), "current.csv").catalog.products[0];
    const legacy = importShopifyCsv(fixture("shopify-legacy-headers.csv"), "legacy.csv").catalog.products[0];
    const core = (product: typeof current) => ({
      handle: product.handle,
      title: product.title,
      description: product.description,
      vendor: product.vendor,
      productType: product.productType,
      tags: product.tags,
      status: product.status,
      published: product.publishedOnOnlineStore,
      variants: product.variants.map((variant) => ({ sku: variant.sku, barcode: variant.barcode, price: variant.price.value })),
      images: product.images.map((image) => ({ source: image.source, position: image.position, altText: image.altText })),
    });
    expect(core(legacy)).toEqual(core(current));
  });

  it("preserves extension and unknown columns without interpreting them", () => {
    const result = importShopifyCsv(fixture("shopify-extension-columns.csv"), "shopify-extension-columns.csv");
    expect(result.metadata.extensionColumns).toEqual([
      "Price / Europe",
      "Included / International",
      "Fabric (product.metafields.custom.fabric)",
    ]);
    expect(result.issues.map((issue) => issue.code)).toContain("CSV_EXTENSION_COLUMNS_PRESERVED");
    expect(result.issues.map((issue) => issue.code)).toContain("CSV_UNKNOWN_COLUMNS_PRESERVED");
    const raw = result.catalog.products[0].variants[0].provenance[0].rawValues;
    expect(raw["Fabric (product.metafields.custom.fabric)"]).toBe("organic cotton");
    expect(raw["Mystery Partner Field"]).toBe("preserved-value");
  });

  it("keeps partial analysis usable and explains malformed records", () => {
    const result = importShopifyCsv(fixture("shopify-malformed.csv"), "shopify-malformed.csv");
    const codes = result.issues.map((issue) => issue.code);
    expect(result.catalog.products).toHaveLength(1);
    expect(result.catalog.products[0].variants).toHaveLength(2);
    expect(codes).toContain("CSV_ROW_PRODUCT_IDENTITY_MISSING");
    expect(codes).toContain("CSV_STATUS_UNKNOWN");
    expect(codes).toContain("CSV_NUMBER_INVALID");
    expect(codes).toContain("CSV_PRODUCT_FIELD_CONFLICT");
    expect(codes).toContain("CSV_OPTION_SCHEMA_CONFLICT");
    expect(codes).toContain("CSV_IMAGE_PRODUCT_UNKNOWN");
    expect(result.issues.every((issue) => issue.rowNumber || issue.rowNumber === 1)).toBe(true);
  });

  it("parses Unicode, quoted commas, embedded quotes, and multiline descriptions", () => {
    const result = importShopifyCsv(fixture("shopify-unicode-and-quotes.csv"), "shopify-unicode-and-quotes.csv");
    const product = result.catalog.products[0];
    expect(product.title).toBe('Café "Nébula" — édition');
    expect(product.description).toContain("Une tasse, brillante");
    expect(product.description).toContain('\nInscription: "bonjour" — 東京.');
    expect(product.tags).toEqual(["café", "édition limitée"]);
    expect(product.variants[0].sku).toBe("MUG-NÉBULA");
  });

  it("normalizes CRLF and LF record endings equivalently", () => {
    const crlf = fixture("shopify-current-simple.csv");
    const lf = crlf.replace(/\r\n/g, "\n");
    const first = importShopifyCsv(crlf, "crlf.csv");
    const second = importShopifyCsv(lf, "lf.csv");
    expect(second.metadata.normalizedCounts).toEqual(first.metadata.normalizedCounts);
    expect(second.catalog.products[0].variants[0].sku).toBe(first.catalog.products[0].variants[0].sku);
  });

  it("retains logical source-row provenance on repeated-handle variants", () => {
    const result = importShopifyCsv(fixture("shopify-current-variants.csv"), "shopify-current-variants.csv");
    expect(result.catalog.products[0].variants[0].provenance[0].rowNumber).toBe(2);
    expect(result.catalog.products[0].variants[1].provenance[0].rowNumber).toBe(3);
    expect(result.catalog.products[2].variants[1].provenance[0].rowNumber).toBe(7);
  });

  it("does not turn an unparseable inventory quantity into a factual inventory conflict", () => {
    const result = importShopifyCsv(fixture("shopify-malformed.csv"), "shopify-malformed.csv");
    const firstVariant = result.catalog.products[0].variants[0];
    expect(firstVariant.inventoryQuantity).toBeNull();
    expect(runAudit(result.catalog).findings.some((finding) => finding.ruleId === "INVENTORY_AVAILABILITY_CONFLICT")).toBe(false);
  });
});