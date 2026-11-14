import { describe, expect, it } from "vitest";
import { runAudit } from "../src/audit";
import { importShopifyCsv } from "../src/catalog";

const headers = "Handle,Title,Status,Product ID,Variant ID,Variant SKU,Variant Price,Variant Inventory Qty,Variant Inventory Tracker,Variant Inventory Policy,Available,Image Src,Image Alt Text,Variant Image";

describe("Mission 4 CSV semantic hardening", () => {
  it("preserves distinct source products that collide on handle", () => {
    const result = importShopifyCsv(`${headers}\nshared,First,active,p1,v1,ONE,10,1,shopify,deny,true,one.jpg,One,\nshared,Second,active,p2,v2,TWO,10,1,shopify,deny,true,two.jpg,Two,\n`, "handle-collision.csv");
    expect(result.metadata.normalizedCounts.products).toBe(2);
    expect(result.issues.map((issue) => issue.code)).toContain("CSV_PRODUCT_HANDLE_COLLISION");
    expect(runAudit(result.catalog).findings.filter((finding) => finding.ruleId === "PRODUCT_HANDLE_DUPLICATE")).toHaveLength(2);
  });

  it("starts a title-bearing blank-handle row as a new derived product", () => {
    const result = importShopifyCsv(`${headers}\nfirst,First,active,p1,v1,ONE,10,1,shopify,deny,true,one.jpg,One,\n,Second Product,active,p2,v2,TWO,12,1,shopify,deny,true,two.jpg,Two,\n`, "derived-handle.csv");
    expect(result.metadata.normalizedCounts.products).toBe(2);
    expect(result.catalog.products[1].handle).toBe("second-product");
    expect(result.issues.map((issue) => issue.code)).toContain("CSV_HANDLE_DERIVED");
  });

  it("skips an inventory-only continuation instead of manufacturing a phantom variant", () => {
    const result = importShopifyCsv(`${headers}\nitem,Item,active,p1,v1,ONE,10,1,shopify,deny,true,item.jpg,Item,\nitem,,,,,,,0,shopify,deny,true,,,\n`, "partial-variant.csv");
    expect(result.metadata.normalizedCounts.variants).toBe(1);
    expect(result.issues.map((issue) => issue.code)).toContain("CSV_PARTIAL_VARIANT_ROW_SKIPPED");
  });

  it("keeps an unknown inventory tracker unknown and abstains from availability conflict", () => {
    const result = importShopifyCsv(`${headers}\nitem,Item,active,p1,v1,ONE,10,0,mystery,deny,true,item.jpg,Item,\n`, "unknown-tracker.csv");
    expect(result.catalog.products[0].variants[0].inventoryTracked).toBeNull();
    expect(result.issues.map((issue) => issue.code)).toContain("CSV_INVENTORY_TRACKER_UNKNOWN");
    expect(runAudit(result.catalog).findings.some((finding) => finding.ruleId === "INVENTORY_AVAILABILITY_CONFLICT")).toBe(false);
  });

  it("retains a variant-image continuation as media without adding a variant", () => {
    const result = importShopifyCsv(`${headers}\nitem,Item,active,p1,v1,ONE,10,1,shopify,deny,true,,,,\nitem,,,,,,,,,,,,,variant.jpg\n`, "variant-image.csv");
    expect(result.metadata.normalizedCounts).toEqual({ products: 1, variants: 1, images: 1 });
    expect(runAudit(result.catalog).findings.map((finding) => finding.ruleId)).toContain("MEDIA_ALT_MISSING");
    expect(runAudit(result.catalog).findings.map((finding) => finding.ruleId)).not.toContain("MEDIA_PRODUCT_NO_IMAGE");
  });

  it("diagnoses option position gaps without reordering merchant data", () => {
    const optionHeaders = `${headers},Option1 Name,Option1 Value,Option2 Name,Option2 Value,Option3 Name,Option3 Value`;
    const values = ["item", "Item", "active", "p1", "v1", "ONE", "10", "1", "shopify", "deny", "true", "item.jpg", "Item", "", "", "", "Color", "Blue", "", ""];
    const result = importShopifyCsv(`${optionHeaders}\n${values.join(",")}\n`, "option-gap.csv");
    expect(result.issues.map((issue) => issue.code)).toContain("CSV_OPTION_POSITION_GAP");
    expect(result.catalog.products[0].options[0]).toMatchObject({ name: "Color", position: 2 });
  });
});
