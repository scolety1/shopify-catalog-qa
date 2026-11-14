import { ADVERSARIAL_MANIFEST_VERSION, type AdversarialManifest, type AdversarialScenario, type ExpectedFinding } from "./types";

type JsonRecord = Record<string, unknown>;

const image = (source = "https://cdn.example.test/good.jpg", altText: string | null = "A clear product view") => ({ source, altText });
const variant = (id: string, overrides: JsonRecord = {}): JsonRecord => ({
  sourceVariantId: id,
  title: `Variant ${id}`,
  sku: `SKU-${id.toUpperCase()}`,
  price: 10,
  compareAtPrice: null,
  inventory: { quantity: 4, tracked: true, policy: "deny" },
  available: true,
  options: {},
  ...overrides,
});
const product = (id: string, overrides: JsonRecord = {}): JsonRecord => ({
  sourceProductId: id,
  handle: `product-${id}`,
  title: `Product ${id}`,
  status: "active",
  options: [],
  variants: [variant(`${id}-v1`)],
  images: [image(`https://cdn.example.test/${id}.jpg`)],
  ...overrides,
});
const target = {
  product: (sourceId: string) => ({ type: "product" as const, sourceId }),
  variant: (sourceId: string) => ({ type: "variant" as const, sourceId }),
  image: (mediaSource: string) => ({ type: "image" as const, mediaSource }),
};
const finding = (ruleId: string, entity: ReturnType<(typeof target)[keyof typeof target]>, severity: "high" | "medium" | "low", rationale: string): ExpectedFinding => ({ ruleId, target: entity, severity, rationale });

function native(
  id: string,
  family: string,
  description: string,
  products: JsonRecord[],
  expectedFindings: ExpectedFinding[] = [],
  extra: Partial<AdversarialScenario> = {},
): AdversarialScenario {
  return {
    id,
    family,
    description,
    tags: [family, ...(extra.tags ?? [])],
    rationale: extra.rationale ?? "Ground truth is limited to facts directly represented by the native catalog source.",
    source: { format: "catalog-qa-json-v1", filename: `${id}.json`, value: { schemaVersion: "catalog-qa.catalog.v1", products } },
    expectedFindings,
    ...extra,
  };
}

function csvValue(headers: string[], rows: unknown[][], lineEnding = "\n", finalNewline = true): string {
  const encode = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const text = [headers, ...rows].map((row) => row.map(encode).join(",")).join(lineEnding);
  return finalNewline ? `${text}${lineEnding}` : text;
}

const H = ["Handle", "Title", "Status", "Product ID", "Variant ID", "Variant SKU", "Variant Price", "Variant Compare At Price", "Variant Inventory Qty", "Variant Inventory Tracker", "Variant Inventory Policy", "Available", "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value", "Option3 Name", "Option3 Value", "Image Src", "Image Alt Text", "Variant Image"];
const row = (values: Partial<Record<(typeof H)[number], unknown>>): unknown[] => H.map((header) => values[header] ?? "");
const goodCsvRow = (handle: string, productId: string, variantId: string, overrides: Partial<Record<(typeof H)[number], unknown>> = {}) => row({
  Handle: handle, Title: `Product ${productId}`, Status: "active", "Product ID": productId,
  "Variant ID": variantId, "Variant SKU": `SKU-${variantId}`, "Variant Price": "10.00",
  "Variant Inventory Qty": "4", "Variant Inventory Tracker": "shopify", "Variant Inventory Policy": "deny", Available: "true",
  "Image Src": `https://cdn.example.test/${handle}.jpg`, "Image Alt Text": `Product ${productId}`,
  ...overrides,
});
function csv(
  id: string,
  family: string,
  description: string,
  value: string,
  expectedFindings: ExpectedFinding[] = [],
  extra: Partial<AdversarialScenario> = {},
): AdversarialScenario {
  return {
    id,
    family,
    description,
    tags: [family, "csv", ...(extra.tags ?? [])],
    rationale: extra.rationale ?? "The CSV support contract is evaluated separately from audit-rule output.",
    source: { format: "shopify-product-csv", filename: `${id}.csv`, value },
    expectedFindings,
    ...extra,
  };
}

const sku: AdversarialScenario[] = [
  native("sku-duplicate-across-products", "sku", "Exact SKU reused by active variants on different products", [product("s1", { variants: [variant("s1-v1", { sku: "DUP-1" })] }), product("s2", { variants: [variant("s2-v1", { sku: "DUP-1" })] })], [finding("SKU_DUPLICATE", target.variant("s1-v1"), "high", "Two active variants have the same trimmed, case-sensitive SKU."), finding("SKU_DUPLICATE", target.variant("s2-v1"), "high", "Two active variants have the same trimmed, case-sensitive SKU.")], { policy: { equality: "trimmed exact code-point equality; case-sensitive; no Unicode folding" } }),
  native("sku-duplicate-same-product", "sku", "Exact SKU reused by two variants of one active product", [product("s3", { options: [{ name: "Color", values: ["Blue", "Red"] }], variants: [variant("s3-v1", { sku: "DUP-2", options: { Color: "Blue" } }), variant("s3-v2", { sku: "DUP-2", options: { Color: "Red" } })] })], [finding("SKU_DUPLICATE", target.variant("s3-v1"), "high", "The exact active SKU collides."), finding("SKU_DUPLICATE", target.variant("s3-v2"), "high", "The exact active SKU collides.")]),
  native("sku-case-distinct", "sku", "SKUs differing only by case remain distinct", [product("s4", { options: [{ name: "Color", values: ["Blue", "Red"] }], variants: [variant("s4-v1", { sku: "Case-1", options: { Color: "Blue" } }), variant("s4-v2", { sku: "CASE-1", options: { Color: "Red" } })] })], [], { policy: { equality: "case-sensitive because case folding could merge legitimate merchant identifiers" } }),
  native("sku-whitespace-normalized", "sku", "Outer whitespace does not make a distinct SKU", [product("s5", { options: [{ name: "Color", values: ["Blue", "Red"] }], variants: [variant("s5-v1", { sku: "  SPACE-1", options: { Color: "Blue" } }), variant("s5-v2", { sku: "SPACE-1  ", options: { Color: "Red" } })] })], [finding("SKU_DUPLICATE", target.variant("s5-v1"), "high", "Outer whitespace is transport noise."), finding("SKU_DUPLICATE", target.variant("s5-v2"), "high", "Outer whitespace is transport noise.")]),
  native("sku-unicode-distinct", "sku", "Canonically equivalent-looking Unicode SKUs are not folded", [product("s6", { options: [{ name: "Color", values: ["Blue", "Red"] }], variants: [variant("s6-v1", { sku: "CAFÉ-1", options: { Color: "Blue" } }), variant("s6-v2", { sku: "CAFE\u0301-1", options: { Color: "Red" } })] })], [], { policy: { equality: "no Unicode normalization; visually similar identifiers are not proven equal" } }),
  native("sku-blank-active", "sku", "Blank SKU on an active variant", [product("s7", { variants: [variant("s7-v1", { sku: "" })] })], [finding("SKU_MISSING", target.variant("s7-v1"), "medium", "The active variant factually lacks a SKU used by catalog operations.")]),
  native("sku-whitespace-active", "sku", "Whitespace-only SKU on an active variant", [product("s8", { variants: [variant("s8-v1", { sku: "   " })] })], [finding("SKU_MISSING", target.variant("s8-v1"), "medium", "Whitespace does not supply an identifier.")]),
  native("sku-absent-draft", "sku", "Intentionally absent SKU on a draft variant", [product("s9", { status: "draft", variants: [variant("s9-v1", { sku: null })] })], [], { forbiddenRuleIds: ["SKU_MISSING"], rationale: "A draft item may be incomplete; the engine should abstain until activation." }),
  native("sku-absent-active", "sku", "Absent SKU on an active variant", [product("s10", { variants: [variant("s10-v1", { sku: null })] })], [finding("SKU_MISSING", target.variant("s10-v1"), "medium", "Active item lacks the operational identifier.")]),
  native("sku-two-blanks", "sku", "Two blank SKUs are missing but are not duplicate values", [product("s11", { options: [{ name: "Color", values: ["Blue", "Red"] }], variants: [variant("s11-v1", { sku: "", options: { Color: "Blue" } }), variant("s11-v2", { sku: null, options: { Color: "Red" } })] })], [finding("SKU_MISSING", target.variant("s11-v1"), "medium", "First active variant lacks a SKU."), finding("SKU_MISSING", target.variant("s11-v2"), "medium", "Second active variant lacks a SKU.")], { forbiddenRuleIds: ["SKU_DUPLICATE"] }),
  native("sku-one-missing-among-valid", "sku", "One missing SKU among valid siblings", [product("s12", { options: [{ name: "Color", values: ["Blue", "Red", "Green"] }], variants: [variant("s12-v1", { options: { Color: "Blue" } }), variant("s12-v2", { sku: null, options: { Color: "Red" } }), variant("s12-v3", { options: { Color: "Green" } })] })], [finding("SKU_MISSING", target.variant("s12-v2"), "medium", "Only the missing active SKU is affected.")]),
  native("sku-similar-not-equal", "sku", "Similar SKUs remain distinct", [product("s13", { options: [{ name: "Color", values: ["Blue", "Red"] }], variants: [variant("s13-v1", { sku: "ABC-100", options: { Color: "Blue" } }), variant("s13-v2", { sku: "ABC-10O", options: { Color: "Red" } })] })]),
  native("sku-numeric-looking", "sku", "Numeric-looking SKU remains a string identifier", [product("s14", { options: [{ name: "Color", values: ["Blue", "Red"] }], variants: [variant("s14-v1", { sku: "00123", options: { Color: "Blue" } }), variant("s14-v2", { sku: "123", options: { Color: "Red" } })] })]),
  native("sku-very-long", "sku", "A long non-empty SKU is not judged subjectively", [product("s15", { variants: [variant("s15-v1", { sku: "X".repeat(256) })] })]),
  native("sku-archived-active-reuse", "sku", "Archived and active variants may retain the same SKU", [product("s16a", { status: "archived", variants: [variant("s16a-v1", { sku: "RETIRED-1" })] }), product("s16b", { variants: [variant("s16b-v1", { sku: "RETIRED-1" })] })], [], { forbiddenRuleIds: ["SKU_DUPLICATE"], rationale: "An archived record does not create an active operational collision." }),
];

const options: AdversarialScenario[] = [
  native("option-valid-one", "options", "Valid one-option product", [product("o1", { options: [{ name: "Color", values: ["Blue"] }], variants: [variant("o1-v1", { options: { Color: "Blue" } })] })]),
  native("option-valid-two", "options", "Valid two-option product", [product("o2", { options: [{ name: "Size", values: ["S"] }, { name: "Color", values: ["Blue"] }], variants: [variant("o2-v1", { options: { Size: "S", Color: "Blue" } })] })]),
  native("option-valid-three", "options", "Valid three-option product", [product("o3", { options: [{ name: "Size", values: ["S"] }, { name: "Color", values: ["Blue"] }, { name: "Material", values: ["Linen"] }], variants: [variant("o3-v1", { options: { Size: "S", Color: "Blue", Material: "Linen" } })] })]),
  native("option-exact-duplicate", "options", "Exact duplicate option combination", [product("o4", { options: [{ name: "Color", values: ["Blue"] }], variants: [variant("o4-v1", { options: { Color: "Blue" } }), variant("o4-v2", { options: { Color: "Blue" } })] })], [finding("VARIANT_OPTION_DUPLICATE", target.variant("o4-v1"), "high", "Two variants encode the same exact choice."), finding("VARIANT_OPTION_DUPLICATE", target.variant("o4-v2"), "high", "Two variants encode the same exact choice.")]),
  native("option-whitespace-duplicate", "options", "Option whitespace is transport noise", [product("o5", { options: [{ name: "Color", values: ["Blue"] }], variants: [variant("o5-v1", { options: { Color: " Blue " } }), variant("o5-v2", { options: { Color: "Blue" } })] })], [finding("VARIANT_OPTION_DUPLICATE", target.variant("o5-v1"), "high", "Trimmed values are identical."), finding("VARIANT_OPTION_DUPLICATE", target.variant("o5-v2"), "high", "Trimmed values are identical.")]),
  native("option-case-distinct", "options", "Case-distinct option values are preserved", [product("o6", { options: [{ name: "Code", values: ["US", "us"] }], variants: [variant("o6-v1", { options: { Code: "US" } }), variant("o6-v2", { options: { Code: "us" } })] })], [], { forbiddenRuleIds: ["VARIANT_OPTION_DUPLICATE"], policy: { canonicalization: "trim only; case remains merchant-authored data" } }),
  native("option-missing-second", "options", "Variant missing Option2", [product("o7", { options: [{ name: "Size", values: ["S"] }, { name: "Color", values: ["Blue"] }], variants: [variant("o7-v1", { options: { Size: "S", Color: null } })] })], [finding("VARIANT_OPTION_INCOMPLETE", target.variant("o7-v1"), "high", "Declared Color selection is absent.")]),
  native("option-unknown-name", "options", "Variant supplies undeclared option name", [product("o8", { options: [{ name: "Color", values: ["Blue"] }], variants: [variant("o8-v1", { options: { Color: "Blue", Finish: "Gloss" } })] })], [finding("VARIANT_OPTION_SCHEMA_MISMATCH", target.variant("o8-v1"), "high", "Finish is outside the declared schema.")]),
  native("option-value-outside-schema", "options", "Variant value is outside a non-empty declared set", [product("o9", { options: [{ name: "Color", values: ["Blue"] }], variants: [variant("o9-v1", { options: { Color: "Green" } })] })], [finding("VARIANT_OPTION_SCHEMA_MISMATCH", target.variant("o9-v1"), "high", "Green is not in the explicit allowed set.")]),
  native("option-punctuation", "options", "Punctuation in option values is legitimate", [product("o10", { options: [{ name: "Size", values: ["S/M", "L+XL"] }], variants: [variant("o10-v1", { options: { Size: "S/M" } }), variant("o10-v2", { options: { Size: "L+XL" } })] })]),
  native("option-unicode", "options", "Unicode option values remain legitimate", [product("o11", { options: [{ name: "Finish", values: ["Émaillé", "東京"] }], variants: [variant("o11-v1", { options: { Finish: "Émaillé" } }), variant("o11-v2", { options: { Finish: "東京" } })] })]),
  native("option-unicode-not-folded", "options", "Canonically equivalent Unicode values are not assumed equal", [product("o12", { options: [{ name: "Code", values: ["É", "E\u0301"] }], variants: [variant("o12-v1", { options: { Code: "É" } }), variant("o12-v2", { options: { Code: "E\u0301" } })] })]),
  native("option-default-simple", "options", "A single default variant with no option schema is valid", [product("o13")]),
  native("option-duplicate-default", "options", "Two optionless variants are structurally duplicate defaults", [product("o14", { variants: [variant("o14-v1"), variant("o14-v2")] })], [finding("VARIANT_OPTION_DUPLICATE", target.variant("o14-v1"), "high", "Only one optionless default variant can represent the product."), finding("VARIANT_OPTION_DUPLICATE", target.variant("o14-v2"), "high", "Only one optionless default variant can represent the product.")]),
  native("option-empty-declared-values", "options", "Active product declares an option with no allowed values", [product("o15", { options: [{ name: "Color", values: [] }], variants: [variant("o15-v1", { options: { Color: "Blue" } })] })], [finding("PRODUCT_OPTION_VALUES_MISSING", target.product("o15"), "high", "Declared selectable option has no canonical value set.")]),
  native("option-no-viable-variant", "options", "All variants lack a required selection", [product("o16", { options: [{ name: "Size", values: ["S"] }], variants: [variant("o16-v1", { options: { Size: null } }), variant("o16-v2", { options: { Size: "" } })] })], [finding("VARIANT_OPTION_INCOMPLETE", target.variant("o16-v1"), "high", "Required value missing."), finding("VARIANT_OPTION_INCOMPLETE", target.variant("o16-v2"), "high", "Required value missing.")]),
];

const pricing: AdversarialScenario[] = [
  native("price-positive", "pricing", "Positive price is valid", [product("pr1")]),
  native("price-zero", "pricing", "Zero price may intentionally represent a free item", [product("pr2", { variants: [variant("pr2-v1", { price: 0 })] })]),
  native("price-negative", "pricing", "Negative selling price", [product("pr3", { variants: [variant("pr3-v1", { price: -0.01 })] })], [finding("PRICE_NEGATIVE", target.variant("pr3-v1"), "high", "Negative amount is objectively invalid.")]),
  native("price-malformed", "pricing", "Malformed numeric price", [product("pr4", { variants: [variant("pr4-v1", { price: "ten" })] })], [finding("PRICE_INVALID", target.variant("pr4-v1"), "high", "Selling price cannot be normalized as numeric.")]),
  native("price-currency-symbol", "pricing", "Currency symbol in numeric field", [product("pr5", { variants: [variant("pr5-v1", { price: "$10.00" })] })], [finding("PRICE_INVALID", target.variant("pr5-v1"), "high", "Source numeric field contains non-numeric syntax.")]),
  native("price-comma-decimal", "pricing", "Comma decimal formatting is unsupported, not guessed", [product("pr6", { variants: [variant("pr6-v1", { price: "10,50" })] })], [finding("PRICE_INVALID", target.variant("pr6-v1"), "high", "Locale cannot be inferred safely from one amount.")]),
  native("price-compare-above", "pricing", "Compare-at above selling price", [product("pr7", { variants: [variant("pr7-v1", { price: 10, compareAtPrice: 12 })] })]),
  native("price-compare-equal", "pricing", "Compare-at equal to price is not a factual inversion", [product("pr8", { variants: [variant("pr8-v1", { price: 10, compareAtPrice: 10 })] })]),
  native("price-compare-below", "pricing", "Positive compare-at below selling price", [product("pr9", { variants: [variant("pr9-v1", { price: 10, compareAtPrice: 8 })] })], [finding("PRICE_COMPARE_AT_BELOW_PRICE", target.variant("pr9-v1"), "medium", "The catalog's own sale-price relationship is inverted.")]),
  native("price-compare-absent", "pricing", "Absent compare-at price", [product("pr10")]),
  native("price-compare-zero", "pricing", "Zero compare-at sentinel", [product("pr11", { variants: [variant("pr11-v1", { compareAtPrice: 0 })] })]),
  native("price-legitimate-difference", "pricing", "Sibling variants may have different prices", [product("pr12", { options: [{ name: "Size", values: ["S", "L"] }], variants: [variant("pr12-v1", { price: 10, options: { Size: "S" } }), variant("pr12-v2", { price: 14, options: { Size: "L" } })] })]),
  native("price-legitimate-same", "pricing", "Sibling option variants may share a price", [product("pr13", { options: [{ name: "Color", values: ["Blue", "Red"] }], variants: [variant("pr13-v1", { price: 10, options: { Color: "Blue" } }), variant("pr13-v2", { price: 10, options: { Color: "Red" } })] })]),
  native("price-large", "pricing", "Large finite price remains objective numeric data", [product("pr14", { variants: [variant("pr14-v1", { price: 999999999.99 })] })]),
  native("price-tiny", "pricing", "Tiny positive fractional price", [product("pr15", { variants: [variant("pr15-v1", { price: 0.001 })] })]),
  native("price-outer-whitespace", "pricing", "Outer whitespace around numeric price", [product("pr16", { variants: [variant("pr16-v1", { price: " 10.00 " })] })]),
  native("price-missing", "pricing", "Missing required selling price", [product("pr17", { variants: [variant("pr17-v1", { price: null })] })], [finding("PRICE_INVALID", target.variant("pr17-v1"), "high", "Variant lacks a selling price.")]),
  native("price-negative-compare", "pricing", "Negative compare-at price", [product("pr18", { variants: [variant("pr18-v1", { compareAtPrice: -1 })] })], [finding("PRICE_NEGATIVE", target.variant("pr18-v1"), "high", "Negative compare-at amount is invalid.")]),
];

const inventory: AdversarialScenario[] = [
  native("inventory-positive-available", "inventory", "Tracked positive stock marked available", [product("i1")]),
  native("inventory-zero-unavailable", "inventory", "Tracked zero stock marked unavailable", [product("i2", { variants: [variant("i2-v1", { inventory: { quantity: 0, tracked: true, policy: "deny" }, available: false })] })]),
  native("inventory-negative-continue", "inventory", "Negative stock with continue-selling enabled", [product("i3", { variants: [variant("i3-v1", { inventory: { quantity: -2, tracked: true, policy: "continue" }, available: true })] })]),
  native("inventory-negative-deny-available", "inventory", "Negative tracked stock denied from overselling but marked available", [product("i4", { variants: [variant("i4-v1", { inventory: { quantity: -2, tracked: true, policy: "deny" }, available: true })] })], [finding("INVENTORY_AVAILABILITY_CONFLICT", target.variant("i4-v1"), "high", "All four contradictory facts are explicit.")]),
  native("inventory-zero-deny-available", "inventory", "Zero tracked stock denied from overselling but marked available", [product("i5", { variants: [variant("i5-v1", { inventory: { quantity: 0, tracked: true, policy: "deny" }, available: true })] })], [finding("INVENTORY_AVAILABILITY_CONFLICT", target.variant("i5-v1"), "high", "All four contradictory facts are explicit.")]),
  native("inventory-untracked", "inventory", "Untracked zero quantity may remain available", [product("i6", { variants: [variant("i6-v1", { inventory: { quantity: 0, tracked: false, policy: "deny" }, available: true })] })]),
  native("inventory-tracker-unknown", "inventory", "Unknown tracking state forces abstention", [product("i7", { variants: [variant("i7-v1", { inventory: { quantity: 0, tracked: null, policy: "deny" }, available: true })] })], [], { forbiddenRuleIds: ["INVENTORY_AVAILABILITY_CONFLICT"] }),
  native("inventory-quantity-malformed", "inventory", "Malformed quantity remains unknown", [product("i8", { variants: [variant("i8-v1", { inventory: { quantity: "many", tracked: true, policy: "deny" }, available: true })] })], [], { expectedDiagnostics: { required: ["JSON_INVENTORY_QUANTITY_INVALID"] }, forbiddenRuleIds: ["INVENTORY_AVAILABILITY_CONFLICT"] }),
  native("inventory-draft-conflict", "inventory", "Draft inventory tuple is not a live availability defect", [product("i9", { status: "draft", variants: [variant("i9-v1", { inventory: { quantity: 0, tracked: true, policy: "deny" }, available: true })] })], [], { forbiddenRuleIds: ["INVENTORY_AVAILABILITY_CONFLICT"], rationale: "Availability is not operational for a draft product, so the rule abstains." }),
  native("inventory-archived-conflict", "inventory", "Archived inventory tuple is not a live availability defect", [product("i10", { status: "archived", variants: [variant("i10-v1", { inventory: { quantity: 0, tracked: true, policy: "deny" }, available: true })] })], [], { forbiddenRuleIds: ["INVENTORY_AVAILABILITY_CONFLICT"], rationale: "Availability is not operational for an archived product, so the rule abstains." }),
  native("inventory-no-availability", "inventory", "Availability omitted forces abstention", [product("i11", { variants: [variant("i11-v1", { inventory: { quantity: 0, tracked: true, policy: "deny" }, available: null })] })]),
  native("inventory-no-policy", "inventory", "Policy omitted forces abstention", [product("i12", { variants: [variant("i12-v1", { inventory: { quantity: 0, tracked: true, policy: null }, available: true })] })]),
  native("inventory-no-quantity", "inventory", "Quantity omitted forces abstention", [product("i13", { variants: [variant("i13-v1", { inventory: { quantity: null, tracked: true, policy: "deny" }, available: true })] })]),
  native("inventory-positive-unavailable", "inventory", "Positive tracked stock marked unavailable is not enough evidence of defect", [product("i14", { variants: [variant("i14-v1", { inventory: { quantity: 2, tracked: true, policy: "deny" }, available: false })] })]),
];

const media: AdversarialScenario[] = [
  native("media-active-none", "media", "Active product has no image", [product("m1", { images: [] })], [finding("MEDIA_PRODUCT_NO_IMAGE", target.product("m1"), "high", "Active catalog record contains zero usable images.")]),
  native("media-draft-none", "media", "Draft product has no image", [product("m2", { status: "draft", images: [] })], [], { forbiddenRuleIds: ["MEDIA_PRODUCT_NO_IMAGE"], rationale: "Draft incompleteness is not an active storefront defect; applicability abstains." }),
  native("media-archived-none", "media", "Archived product has no image", [product("m3", { status: "archived", images: [] })], [], { forbiddenRuleIds: ["MEDIA_PRODUCT_NO_IMAGE"], rationale: "Archived media gaps do not affect an active listing." }),
  native("media-one-valid", "media", "One valid image with alt text", [product("m4")]),
  native("media-multiple-valid", "media", "Multiple valid images", [product("m5", { images: [image("a.jpg", "Front"), image("b.jpg", "Back")] })]),
  native("media-blank-url", "media", "Blank image source does not create a usable image", [product("m6", { images: [{ source: "   ", altText: "Ghost" }] })], [finding("MEDIA_PRODUCT_NO_IMAGE", target.product("m6"), "high", "Blank URL normalizes away, leaving no image record.")]),
  native("media-alt-missing", "media", "Active image missing alt text", [product("m7", { images: [image("m7.jpg", null)] })], [finding("MEDIA_ALT_MISSING", target.image("m7.jpg"), "medium", "Image record has no accessibility text.")]),
  native("media-alt-whitespace", "media", "Whitespace-only alt text", [product("m8", { images: [image("m8.jpg", "   ")] })], [finding("MEDIA_ALT_MISSING", target.image("m8.jpg"), "medium", "Whitespace is not descriptive text.")]),
  native("media-alt-descriptive", "media", "Descriptive image alt text", [product("m9", { images: [image("m9.jpg", "Blue mug viewed from the side")] })]),
  native("media-repeat-url", "media", "Repeated image URL is not called broken", [product("m10", { images: [image("same.jpg", "Front"), image("same.jpg", "Front duplicate")] })]),
  native("media-variant-image-only", "media", "Variant image is sufficient evidence that the active product has media", [product("m11", { variants: [variant("m11-v1", { imageSource: "variant.jpg" })], images: [] })], [], { forbiddenRuleIds: ["MEDIA_PRODUCT_NO_IMAGE"] }),
  native("media-inaccessible-looking", "media", "Odd URL syntax is not called remotely broken", [product("m12", { images: [image("http://invalid.invalid/not-checked.jpg", "Product") ] })], [], { rationale: "Offline analysis cannot prove remote accessibility." }),
  native("media-draft-alt-missing", "media", "Draft image missing alt text", [product("m13", { status: "draft", images: [image("m13.jpg", null)] })], [], { forbiddenRuleIds: ["MEDIA_ALT_MISSING"] }),
  native("media-unknown-status-alt", "media", "Unknown lifecycle status forces media-rule abstention", [product("m14", { status: "unknown", images: [image("m14.jpg", null)] })], [], { forbiddenRuleIds: ["MEDIA_ALT_MISSING"] }),
];

const status: AdversarialScenario[] = [
  native("status-active", "status", "Active status remains active", [product("st1")], [], { expectedFacts: [{ path: "catalog.products.0.status", equals: "active", rationale: "Recognized status is preserved." }] }),
  native("status-draft", "status", "Draft status remains draft", [product("st2", { status: "draft" })], [], { expectedFacts: [{ path: "catalog.products.0.status", equals: "draft", rationale: "Recognized status is preserved." }] }),
  native("status-archived", "status", "Archived status remains archived", [product("st3", { status: "archived" })], [], { expectedFacts: [{ path: "catalog.products.0.status", equals: "archived", rationale: "Recognized status is preserved." }] }),
  native("status-unknown", "status", "Unknown status remains unknown", [product("st4", { status: "mystery" })], [], { expectedFacts: [{ path: "catalog.products.0.status", equals: "unknown", rationale: "Unsupported status is not defaulted to active." }] }),
  native("status-blank", "status", "Blank status remains unknown", [product("st5", { status: "" })], [], { expectedFacts: [{ path: "catalog.products.0.status", equals: "unknown", rationale: "Blank is unknown." }] }),
  native("status-case-normalized", "status", "Status capitalization is safely normalized", [product("st6", { status: "AcTiVe" })], [], { expectedFacts: [{ path: "catalog.products.0.status", equals: "active", rationale: "Enumerated values are case-insensitive at import." }] }),
  native("status-unknown-no-image", "status", "Unknown status with no image abstains", [product("st7", { status: "unknown", images: [] })], [], { forbiddenRuleIds: ["MEDIA_PRODUCT_NO_IMAGE"] }),
  native("status-draft-missing-sku", "status", "Draft missing SKU abstains", [product("st8", { status: "draft", variants: [variant("st8-v1", { sku: null })] })], [], { forbiddenRuleIds: ["SKU_MISSING"] }),
];

const identity: AdversarialScenario[] = [
  native("identity-duplicate-handle", "product-integrity", "Two distinct active source products share one handle", [product("d1", { handle: "shared-handle" }), product("d2", { handle: "shared-handle" })], [finding("PRODUCT_HANDLE_DUPLICATE", target.product("d1"), "high", "Distinct products cannot safely share one normalized handle."), finding("PRODUCT_HANDLE_DUPLICATE", target.product("d2"), "high", "Distinct products cannot safely share one normalized handle.")]),
  native("identity-handle-case-collision", "product-integrity", "Product handles collide after case normalization", [product("d3", { handle: "Case-Handle" }), product("d4", { handle: "case-handle" })], [finding("PRODUCT_HANDLE_DUPLICATE", target.product("d3"), "high", "Handles are case-insensitive routing identifiers."), finding("PRODUCT_HANDLE_DUPLICATE", target.product("d4"), "high", "Handles are case-insensitive routing identifiers.")]),
  native("identity-distinct-handles", "product-integrity", "Similar but distinct handles remain valid", [product("d5", { handle: "mug-blue" }), product("d6", { handle: "mug-blu" })]),
  native("identity-active-no-variants", "product-integrity", "Active product has zero variants", [product("d7", { variants: [] })], [finding("PRODUCT_NO_VARIANTS", target.product("d7"), "high", "An active product has no purchasable variant record.")]),
  native("identity-draft-no-variants", "product-integrity", "Draft product may have zero variants", [product("d8", { status: "draft", variants: [] })], [], { forbiddenRuleIds: ["PRODUCT_NO_VARIANTS"] }),
  native("identity-duplicate-product-id", "product-integrity", "Two records share a source product ID", [product("same-id", { handle: "first", variants: [variant("same-id-v1")] }), product("same-id", { handle: "second", variants: [variant("same-id-v2")] })], [finding("PRODUCT_ID_DUPLICATE", target.product("same-id"), "high", "Stable source product IDs must identify only one record."), finding("PRODUCT_ID_DUPLICATE", target.product("same-id"), "high", "Stable source product IDs must identify only one record.")]),
  native("identity-duplicate-variant-id", "product-integrity", "Two variants share a source variant ID", [product("d9", { variants: [variant("same-v"), variant("same-v", { sku: "OTHER", options: {} })] })], [finding("VARIANT_ID_DUPLICATE", target.variant("same-v"), "high", "Stable source variant IDs must identify only one record."), finding("VARIANT_ID_DUPLICATE", target.variant("same-v"), "high", "Stable source variant IDs must identify only one record."), finding("VARIANT_OPTION_DUPLICATE", target.variant("same-v"), "high", "Both records also represent the same default variant."), finding("VARIANT_OPTION_DUPLICATE", target.variant("same-v"), "high", "Both records also represent the same default variant.")]),
];

const csvScenarios: AdversarialScenario[] = [
  csv("csv-image-between-variants", "csv-reconstruction", "Image-only row between two variant rows", csvValue(H, [goodCsvRow("shirt", "cp1", "cv1", { "Option1 Name": "Color", "Option1 Value": "Blue" }), row({ Handle: "shirt", "Image Src": "detail.jpg", "Image Alt Text": "Detail" }), row({ Handle: "shirt", "Variant ID": "cv2", "Variant SKU": "SKU-cv2", "Variant Price": "10", "Option1 Name": "Color", "Option1 Value": "Red" })]), [], { expectedFacts: [{ path: "metadata.normalizedCounts", equals: { products: 1, variants: 2, images: 2 }, rationale: "Image row must not become a variant." }] }),
  csv("csv-images-after-final-variant", "csv-reconstruction", "Multiple images follow final variant", csvValue(H, [goodCsvRow("mug", "cp2", "cv3"), row({ Handle: "mug", "Image Src": "two.jpg", "Image Alt Text": "Two" }), row({ Handle: "mug", "Image Src": "three.jpg", "Image Alt Text": "Three" })]), [], { expectedFacts: [{ path: "metadata.normalizedCounts", equals: { products: 1, variants: 1, images: 3 }, rationale: "Continuation images remain media only." }] }),
  csv("csv-repeated-identical-product-data", "csv-reconstruction", "Identical product fields repeated on variant rows", csvValue(H, [goodCsvRow("coat", "cp3", "cv4", { "Option1 Name": "Size", "Option1 Value": "S" }), goodCsvRow("coat", "cp3", "cv5", { "Option1 Name": "Size", "Option1 Value": "M" })]), [], { expectedFacts: [{ path: "metadata.normalizedCounts.products", equals: 1, rationale: "Identical repeated facts merge safely." }] }),
  csv("csv-repeated-conflicting-title", "csv-reconstruction", "Conflicting repeated product title is diagnosed", csvValue(H, [goodCsvRow("hat", "cp4", "cv6"), goodCsvRow("hat", "cp4", "cv7", { Title: "A different title" })]), [finding("VARIANT_OPTION_DUPLICATE", target.variant("cv6"), "high", "Two optionless variants are duplicate defaults."), finding("VARIANT_OPTION_DUPLICATE", target.variant("cv7"), "high", "Two optionless variants are duplicate defaults.")], { expectedDiagnostics: { required: ["CSV_PRODUCT_FIELD_CONFLICT"] } }),
  csv("csv-same-handle-separated", "csv-reconstruction", "Same handle resumes after another product", csvValue(H, [goodCsvRow("alpha", "cp5", "cv8", { "Option1 Name": "Color", "Option1 Value": "Blue" }), goodCsvRow("beta", "cp6", "cv9"), goodCsvRow("alpha", "cp5", "cv10", { "Option1 Name": "Color", "Option1 Value": "Red" })]), [], { expectedFacts: [{ path: "metadata.normalizedCounts.products", equals: 2, rationale: "Ordering does not split a known product." }] }),
  csv("csv-handle-first-row-only", "csv-reconstruction", "Blank continuation handle inherits prior product", csvValue(H, [goodCsvRow("gamma", "cp7", "cv11", { "Option1 Name": "Color", "Option1 Value": "Blue" }), row({ "Variant ID": "cv12", "Variant SKU": "SKU-cv12", "Variant Price": "10", "Option1 Name": "Color", "Option1 Value": "Red" })]), [], { expectedFacts: [{ path: "metadata.normalizedCounts", equals: { products: 1, variants: 2, images: 1 }, rationale: "A blank-title continuation row belongs to the previous product." }] }),
  csv("csv-handle-all-rows", "csv-reconstruction", "Handle repeated on every continuation row", csvValue(H, [goodCsvRow("delta", "cp8", "cv13", { "Option1 Name": "Color", "Option1 Value": "Blue" }), row({ Handle: "delta", "Variant ID": "cv14", "Variant SKU": "SKU-cv14", "Variant Price": "10", "Option1 Name": "Color", "Option1 Value": "Red" })]), [], { expectedFacts: [{ path: "metadata.normalizedCounts.products", equals: 1, rationale: "Repeated handle is supported." }] }),
  csv("csv-blank-handle-new-title", "csv-reconstruction", "Blank handle with a new title starts a derived product", csvValue(H, [goodCsvRow("first", "cp9", "cv15"), row({ Title: "Second Product", Status: "active", "Product ID": "cp10", "Variant ID": "cv16", "Variant SKU": "SKU-cv16", "Variant Price": "10", "Image Src": "second.jpg", "Image Alt Text": "Second" })]), [], { expectedFacts: [{ path: "metadata.normalizedCounts.products", equals: 2, rationale: "A title-bearing row is not an anonymous continuation." }], expectedDiagnostics: { required: ["CSV_HANDLE_DERIVED"] } }),
  csv("csv-legacy-current-aliases", "csv-reconstruction", "Current and legacy aliases in one file are not guessed", csvValue(["Handle", "URL handle", "Title", "Variant SKU", "Price", "Image Src", "Image Alt Text"], [["legacy", "current", "Alias Product", "ALIAS-1", "10", "alias.jpg", "Alias"]]), [], { expectedDiagnostics: { required: ["CSV_HEADER_ALIAS_CONFLICT"] } }),
  csv("csv-duplicate-columns", "csv-reconstruction", "Duplicated columns produce an explicit diagnostic", csvValue(["Handle", "Title", "Variant SKU", "Variant SKU", "Variant Price", "Image Src", "Image Alt Text"], [["dup-cols", "Duplicate columns", "FIRST", "SECOND", "10", "dup.jpg", "Dup"]]), [], { expectedDiagnostics: { required: ["CSV_DUPLICATE_HEADERS"] }, expectedFacts: [{ path: "catalog.products.0.variants.0.sku", equals: "FIRST", rationale: "First supported column wins deterministically." }] }),
  csv("csv-extension-columns", "csv-reconstruction", "Shopify extension columns are preserved without interpretation", csvValue([...H, "Price / Europe", "product.metafields.custom.fabric"], [[...goodCsvRow("ext", "cp11", "cv17"), "9.00", "linen"]]), [], { expectedDiagnostics: { required: ["CSV_EXTENSION_COLUMNS_PRESERVED"] } }),
  csv("csv-bom", "csv-reconstruction", "UTF-8 BOM on first header", `\uFEFF${csvValue(H, [goodCsvRow("bom", "cp12", "cv18")])}`, [], { expectedFacts: [{ path: "metadata.normalizedCounts.products", equals: 1, rationale: "BOM is stripped from header identity." }] }),
  csv("csv-quoted-newline", "csv-reconstruction", "Quoted newline in description", csvValue(["Handle", "Title", "Body (HTML)", "Variant SKU", "Variant Price", "Image Src", "Image Alt Text"], [["newline", "Quoted newline", "Line one\nLine two", "NEW-1", "10", "new.jpg", "New"]]), [], { expectedFacts: [{ path: "catalog.products.0.description", equals: "Line one\nLine two", rationale: "Quoted newline remains source text." }] }),
  csv("csv-embedded-comma", "csv-reconstruction", "Embedded comma in title", csvValue(["Handle", "Title", "Variant SKU", "Variant Price", "Image Src", "Image Alt Text"], [["comma", "Mug, Large", "COMMA-1", "10", "comma.jpg", "Comma"]]), [], { expectedFacts: [{ path: "catalog.products.0.title", equals: "Mug, Large", rationale: "CSV quoting preserves commas." }] }),
  csv("csv-escaped-quote", "csv-reconstruction", "Escaped quote in title", csvValue(["Handle", "Title", "Variant SKU", "Variant Price", "Image Src", "Image Alt Text"], [["quote", "The \"Best\" Mug", "QUOTE-1", "10", "quote.jpg", "Quote"]]), [], { expectedFacts: [{ path: "catalog.products.0.title", equals: "The \"Best\" Mug", rationale: "CSV quote escaping is preserved." }] }),
  csv("csv-crlf", "csv-reconstruction", "CRLF line endings", csvValue(H, [goodCsvRow("crlf", "cp13", "cv19")], "\r\n")),
  csv("csv-lf", "csv-reconstruction", "LF line endings", csvValue(H, [goodCsvRow("lf", "cp14", "cv20")], "\n")),
  csv("csv-no-final-newline", "csv-reconstruction", "Final record without newline", csvValue(H, [goodCsvRow("eof", "cp15", "cv21")], "\n", false)),
  csv("csv-default-title", "csv-reconstruction", "Default Title simple product does not declare a selectable option", csvValue(H, [goodCsvRow("simple", "cp16", "cv22", { "Option1 Name": "Title", "Option1 Value": "Default Title" })]), [], { expectedFacts: [{ path: "catalog.products.0.options", equals: [], rationale: "Shopify default-title sentinel is not a merchant option." }] }),
  csv("csv-duplicate-default", "csv-reconstruction", "Two simple default variants are detected", csvValue(H, [goodCsvRow("simple-dup", "cp17", "cv23", { "Option1 Name": "Title", "Option1 Value": "Default Title" }), row({ Handle: "simple-dup", "Variant ID": "cv24", "Variant SKU": "SKU-cv24", "Variant Price": "10", "Option1 Name": "Title", "Option1 Value": "Default Title" })]), [finding("VARIANT_OPTION_DUPLICATE", target.variant("cv23"), "high", "Two default variants represent the same optionless product."), finding("VARIANT_OPTION_DUPLICATE", target.variant("cv24"), "high", "Two default variants represent the same optionless product.")]),
  csv("csv-option2-without-option1", "csv-reconstruction", "Option2 supplied while Option1 is absent", csvValue(H, [goodCsvRow("gap2", "cp18", "cv25", { "Option2 Name": "Color", "Option2 Value": "Blue" })]), [], { expectedDiagnostics: { required: ["CSV_OPTION_POSITION_GAP"] } }),
  csv("csv-option3-without-option2", "csv-reconstruction", "Option3 supplied while Option2 is absent", csvValue(H, [goodCsvRow("gap3", "cp19", "cv26", { "Option1 Name": "Size", "Option1 Value": "S", "Option3 Name": "Material", "Option3 Value": "Cotton" })]), [], { expectedDiagnostics: { required: ["CSV_OPTION_POSITION_GAP"] } }),
  csv("csv-option-name-conflict", "csv-reconstruction", "Option schema changes across rows", csvValue(H, [goodCsvRow("schema", "cp20", "cv27", { "Option1 Name": "Color", "Option1 Value": "Blue" }), row({ Handle: "schema", "Variant ID": "cv28", "Variant SKU": "SKU-cv28", "Variant Price": "10", "Option1 Name": "Finish", "Option1 Value": "Matte" })]), [finding("VARIANT_OPTION_INCOMPLETE", target.variant("cv28"), "high", "Established Color selection is missing."), finding("VARIANT_OPTION_SCHEMA_MISMATCH", target.variant("cv28"), "high", "Finish conflicts with the established schema.")], { expectedDiagnostics: { required: ["CSV_OPTION_SCHEMA_CONFLICT"] } }),
  csv("csv-option-names-reordered", "csv-reconstruction", "Option names reorder across variant rows", csvValue(H, [goodCsvRow("reorder", "cp21", "cv29", { "Option1 Name": "Size", "Option1 Value": "S", "Option2 Name": "Color", "Option2 Value": "Blue" }), row({ Handle: "reorder", "Variant ID": "cv30", "Variant SKU": "SKU-cv30", "Variant Price": "10", "Option1 Name": "Color", "Option1 Value": "Red", "Option2 Name": "Size", "Option2 Value": "M" })]), [finding("VARIANT_OPTION_SCHEMA_MISMATCH", target.variant("cv30"), "high", "Reordered names conflict with established positions.")], { expectedDiagnostics: { required: ["CSV_OPTION_SCHEMA_CONFLICT"] } }),
  csv("csv-inventory-only-continuation", "csv-reconstruction", "Inventory-only continuation row is too ambiguous to manufacture a variant", csvValue(H, [goodCsvRow("partial", "cp22", "cv31"), row({ Handle: "partial", "Variant Inventory Qty": "0", "Variant Inventory Tracker": "shopify", "Variant Inventory Policy": "deny", Available: "true" })]), [], { expectedDiagnostics: { required: ["CSV_PARTIAL_VARIANT_ROW_SKIPPED"] }, expectedFacts: [{ path: "metadata.normalizedCounts.variants", equals: 1, rationale: "Ambiguous partial row does not become a phantom variant." }] }),
  csv("csv-unknown-inventory-tracker", "csv-reconstruction", "Unknown tracker remains unknown instead of tracked", csvValue(H, [goodCsvRow("tracker", "cp23", "cv32", { "Variant Inventory Qty": "0", "Variant Inventory Tracker": "mystery", "Variant Inventory Policy": "deny", Available: "true" })]), [], { expectedDiagnostics: { required: ["CSV_INVENTORY_TRACKER_UNKNOWN"] }, expectedFacts: [{ path: "catalog.products.0.variants.0.inventoryTracked", equals: null, rationale: "Unknown tracker cannot prove tracking." }], forbiddenRuleIds: ["INVENTORY_AVAILABILITY_CONFLICT"] }),
  csv("csv-distinct-products-same-handle", "csv-reconstruction", "Distinct source product IDs share a handle", csvValue(H, [goodCsvRow("collision", "cp24", "cv33"), goodCsvRow("collision", "cp25", "cv34")]), [finding("PRODUCT_HANDLE_DUPLICATE", target.product("cp24"), "high", "Distinct source products share a routing handle."), finding("PRODUCT_HANDLE_DUPLICATE", target.product("cp25"), "high", "Distinct source products share a routing handle.")], { expectedDiagnostics: { required: ["CSV_PRODUCT_HANDLE_COLLISION"] }, expectedFacts: [{ path: "metadata.normalizedCounts.products", equals: 2, rationale: "Distinct product IDs must not be silently merged." }] }),
  csv("csv-status-on-first-row", "csv-reconstruction", "Status only on first product row", csvValue(H, [goodCsvRow("status-first", "cp26", "cv35", { "Option1 Name": "Color", "Option1 Value": "Blue" }), row({ Handle: "status-first", "Variant ID": "cv36", "Variant SKU": "SKU-cv36", "Variant Price": "10", "Option1 Name": "Color", "Option1 Value": "Red" })]), [], { expectedFacts: [{ path: "catalog.products.0.status", equals: "active", rationale: "Continuation blank does not erase product status." }] }),
  csv("csv-status-conflict", "csv-reconstruction", "Conflicting continuation status retains first and diagnoses", csvValue(H, [goodCsvRow("status-conflict", "cp27", "cv37", { "Option1 Name": "Color", "Option1 Value": "Blue" }), row({ Handle: "status-conflict", Status: "archived", "Variant ID": "cv38", "Variant SKU": "SKU-cv38", "Variant Price": "10", "Option1 Name": "Color", "Option1 Value": "Red" })]), [], { expectedDiagnostics: { required: ["CSV_PRODUCT_STATUS_CONFLICT"] }, expectedFacts: [{ path: "catalog.products.0.status", equals: "active", rationale: "First explicit status wins with conflict evidence." }] }),
  csv("csv-malformed-status", "csv-reconstruction", "Unsupported status remains unknown", csvValue(H, [goodCsvRow("bad-status", "cp28", "cv39", { Status: "available" })]), [], { expectedDiagnostics: { required: ["CSV_STATUS_UNKNOWN"] }, expectedFacts: [{ path: "catalog.products.0.status", equals: "unknown", rationale: "Unknown status is not active." }] }),
  csv("csv-case-status", "csv-reconstruction", "Status capitalization is normalized", csvValue(H, [goodCsvRow("case-status", "cp29", "cv40", { Status: "AcTiVe" })]), [], { expectedFacts: [{ path: "catalog.products.0.status", equals: "active", rationale: "Enumerated status is case-insensitive." }] }),
  csv("csv-image-only-variant-url", "csv-reconstruction", "Variant image creates usable media but no extra variant", csvValue(H, [goodCsvRow("variant-image", "cp30", "cv41", { "Image Src": "", "Image Alt Text": "" }), row({ Handle: "variant-image", "Variant Image": "variant-only.jpg" })]), [finding("MEDIA_ALT_MISSING", target.image("variant-only.jpg"), "medium", "Variant image becomes product media without alt text.")], { expectedFacts: [{ path: "metadata.normalizedCounts", equals: { products: 1, variants: 1, images: 1 }, rationale: "Variant image is media, not a phantom variant." }] }),
];

export const adversarialManifest: AdversarialManifest = {
  schemaVersion: ADVERSARIAL_MANIFEST_VERSION,
  description: "Reviewed deterministic ground truth for hostile Shopify-style catalog boundaries. Unexpected audit findings are false positives.",
  scenarios: [...sku, ...options, ...pricing, ...inventory, ...media, ...status, ...identity, ...csvScenarios],
};
