import type { Catalog, CatalogProduct, CatalogVariant, SourceProvenance } from "../catalog";
import { findEntityIdentity, logicalFindingKey } from "./identity";
import type { AuditRule, EvidenceItem, Finding, Severity } from "./types";

interface FindingInput {
  catalog: Catalog;
  rule: AuditRule;
  severity?: Severity;
  entityType: Finding["affectedEntityType"];
  entityId: string;
  product?: CatalogProduct;
  message: string;
  evidence: EvidenceItem[];
  provenance: SourceProvenance[];
  discriminator?: string;
  stableDiscriminator?: string;
}

function finding(input: FindingInput): Finding {
  const discriminator = input.discriminator ? `:${input.discriminator}` : "";
  const logicalEntity = findEntityIdentity(input.catalog, input.entityType, input.entityId, input.product);
  return {
    id: `${input.rule.id}:${input.entityId}${discriminator}`,
    logicalKey: logicalFindingKey(input.rule.id, logicalEntity, input.stableDiscriminator),
    logicalEntity,
    findingDiscriminator: input.stableDiscriminator ?? null,
    ruleId: input.rule.id,
    severity: input.severity ?? input.rule.defaultSeverity,
    category: input.rule.category,
    classification: input.rule.classification,
    affectedEntityType: input.entityType,
    affectedEntityId: input.entityId,
    productId: input.product?.id ?? null,
    productTitle: input.product?.title ?? null,
    message: input.message,
    evidence: input.evidence,
    provenance: input.provenance,
    recommendedFix: input.rule.recommendedFix,
  };
}

function variantLabel(product: CatalogProduct, variant: CatalogVariant): string {
  return `${product.title} / ${variant.title ?? variant.sku ?? variant.sourceVariantId ?? variant.id}`;
}

function normalizedOptionValue(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export const duplicateSkuRule: AuditRule = {
  id: "SKU_DUPLICATE",
  version: 1,
  title: "Duplicate variant SKU",
  description: "Detects one non-empty SKU assigned to more than one distinct variant.",
  category: "SKU",
  defaultSeverity: "high",
  rationale: "Duplicate SKUs make fulfillment, inventory reconciliation, and downstream exports ambiguous.",
  recommendedFix: "Assign a unique SKU to each conflicting variant, then re-run the audit to confirm the collision is gone.",
  applicability: { scope: "variant", appliesWhen: "The variant belongs to an active product and has a non-blank SKU.", abstainsWhen: "The product is not active or the SKU is missing." },
  classification: "deterministic",
  evaluate(catalog) {
    const bySku = new Map<string, { product: CatalogProduct; variant: CatalogVariant }[]>();
    for (const product of catalog.products) {
      if (product.status !== "active") continue;
      for (const variant of product.variants) {
        const sku = variant.sku?.trim();
        if (!sku) continue;
        const entries = bySku.get(sku) ?? [];
        entries.push({ product, variant });
        bySku.set(sku, entries);
      }
    }

    return [...bySku.entries()].flatMap(([sku, entries]) => {
      if (entries.length < 2) return [];
      const labels = entries.map(({ product, variant }) => variantLabel(product, variant));
      const provenance = entries.flatMap(({ variant }) => variant.provenance);
      return entries.map(({ product, variant }) => finding({
        catalog,
        rule: duplicateSkuRule,
        entityType: "variant",
        entityId: variant.id,
        product,
        message: `SKU “${sku}” is assigned to ${entries.length} variants.`,
        evidence: [
          { label: "Duplicate SKU", value: sku },
          { label: "Conflicting variants", value: labels.join(" • ") },
        ],
        provenance,
        discriminator: sku,
      }));
    });
  },
};

export const missingSkuRule: AuditRule = {
  id: "SKU_MISSING",
  version: 1,
  title: "Variant SKU is missing",
  description: "Detects variants whose SKU is blank or absent.",
  category: "SKU",
  defaultSeverity: "medium",
  rationale: "A SKU is not universally required by Shopify, but missing SKUs weaken catalog operations and reconciliation.",
  recommendedFix: "Decide whether this variant should participate in SKU-based operations; if so, assign a stable unique SKU.",
  applicability: { scope: "variant", appliesWhen: "The variant belongs to an active product.", abstainsWhen: "The product is draft, archived, or has unknown lifecycle status." },
  classification: "deterministic",
  evaluate(catalog) {
    return catalog.products.flatMap((product) => product.status !== "active" ? [] : product.variants.flatMap((variant) => {
      if (variant.sku?.trim()) return [];
      return [finding({
        catalog,
        rule: missingSkuRule,
        entityType: "variant",
        entityId: variant.id,
        product,
        message: `${variantLabel(product, variant)} has no SKU.`,
        evidence: [{ label: "Raw SKU", value: variant.sku }],
        provenance: variant.provenance,
      })];
    }));
  },
};

export const productNoImageRule: AuditRule = {
  id: "MEDIA_PRODUCT_NO_IMAGE",
  version: 1,
  title: "Product has no image",
  description: "Detects products with no usable image records, with lower severity for non-active products.",
  category: "Media",
  defaultSeverity: "high",
  rationale: "An active product without media creates a clear storefront merchandising gap.",
  recommendedFix: "Add at least one accurate product image and re-run the audit. Draft or archived items can be addressed before activation.",
  applicability: { scope: "product", appliesWhen: "The product is active.", abstainsWhen: "The product is draft, archived, or has unknown lifecycle status." },
  classification: "deterministic",
  evaluate(catalog) {
    return catalog.products.flatMap((product) => {
      if (product.status !== "active" || product.images.length > 0 || product.variants.some((variant) => variant.imageSource?.trim())) return [];
      return [finding({
        catalog,
        rule: productNoImageRule,
        entityType: "product",
        entityId: product.id,
        product,
        message: `${product.title} has no product images.`,
        evidence: [
          { label: "Image count", value: 0 },
          { label: "Product status", value: product.status },
        ],
        provenance: product.provenance,
      })];
    });
  },
};

export const imageAltMissingRule: AuditRule = {
  id: "MEDIA_ALT_MISSING",
  version: 1,
  title: "Image alt text is missing",
  description: "Detects image records with blank or absent alt text.",
  category: "Media",
  defaultSeverity: "medium",
  rationale: "Alt text supports accessibility, catalog clarity, and search context.",
  recommendedFix: "Write concise alt text that describes the product and meaningful visual details; avoid keyword stuffing.",
  applicability: { scope: "image", appliesWhen: "The image belongs to an active product.", abstainsWhen: "The product is draft, archived, or has unknown lifecycle status." },
  classification: "deterministic",
  evaluate(catalog) {
    return catalog.products.flatMap((product) => product.status !== "active" ? [] : product.images.flatMap((image) => {
      if (image.altText?.trim()) return [];
      return [finding({
        catalog,
        rule: imageAltMissingRule,
        entityType: "image",
        entityId: image.id,
        product,
        message: `An image for ${product.title} has no alt text.`,
        evidence: [
          { label: "Image source", value: image.source },
          { label: "Raw alt text", value: image.altText },
          { label: "Product status", value: product.status },
        ],
        provenance: image.provenance,
      })];
    }));
  },
};

export const duplicateOptionCombinationRule: AuditRule = {
  id: "VARIANT_OPTION_DUPLICATE",
  version: 1,
  title: "Duplicate variant option combination",
  description: "Detects two variants within one product that resolve to the same complete normalized option combination.",
  category: "Variant integrity",
  defaultSeverity: "high",
  rationale: "A product should not contain two distinct variants representing the same selectable option combination.",
  recommendedFix: "Merge or remove the duplicate variant after confirming which inventory, SKU, and price record should remain.",
  applicability: { scope: "variant", appliesWhen: "At least two variants have complete selections for the product's declared option schema, including the optionless default schema.", abstainsWhen: "A variant lacks a required selection; the incomplete-option rule evaluates that condition instead." },
  classification: "deterministic",
  evaluate(catalog) {
    return catalog.products.flatMap((product) => {
      const byCombination = new Map<string, CatalogVariant[]>();
      for (const variant of product.variants) {
        const isComplete = product.options.every((option) => normalizedOptionValue(variant.optionValues[option.name]) !== "");
        if (!isComplete) continue;
        const combination = product.options
          .map((option) => `${option.name.trim()}=${normalizedOptionValue(variant.optionValues[option.name])}`)
          .join("|");
        const entries = byCombination.get(combination) ?? [];
        entries.push(variant);
        byCombination.set(combination, entries);
      }

      return [...byCombination.entries()].flatMap(([combination, variants]) => {
        if (variants.length < 2) return [];
        return variants.map((variant) => finding({
          catalog,
          rule: duplicateOptionCombinationRule,
          entityType: "variant",
          entityId: variant.id,
          product,
          message: `${product.title} contains ${variants.length} variants with the same option combination.`,
          evidence: [
            { label: "Normalized combination", value: combination || "Default variant" },
            { label: "Variant IDs", value: variants.map((entry) => entry.sourceVariantId ?? entry.id).join(", ") },
          ],
          provenance: variants.flatMap((entry) => entry.provenance),
          discriminator: combination || "default",
        }));
      });
    });
  },
};

export const incompleteOptionRule: AuditRule = {
  id: "VARIANT_OPTION_INCOMPLETE",
  version: 1,
  title: "Variant option value is incomplete",
  description: "Detects a variant missing a value required by its product's declared option schema.",
  category: "Variant integrity",
  defaultSeverity: "high",
  rationale: "A variant cannot be identified reliably when a required option selection is absent.",
  recommendedFix: "Supply a value for every declared product option, or correct the product option schema if the option should not exist.",
  applicability: { scope: "variant", appliesWhen: "The product declares at least one option.", abstainsWhen: "The product has no declared option schema." },
  classification: "deterministic",
  evaluate(catalog) {
    return catalog.products.flatMap((product) => product.variants.flatMap((variant) => {
      const missing = product.options
        .map((option) => option.name)
        .filter((name) => normalizedOptionValue(variant.optionValues[name]) === "");
      if (missing.length === 0) return [];
      return [finding({
        catalog,
        rule: incompleteOptionRule,
        entityType: "variant",
        entityId: variant.id,
        product,
        message: `${variantLabel(product, variant)} is missing ${missing.length} required option value${missing.length === 1 ? "" : "s"}.`,
        evidence: [
          { label: "Missing options", value: missing.join(", ") },
          { label: "Declared schema", value: product.options.map((option) => option.name).join(", ") },
        ],
        provenance: variant.provenance,
      })];
    }));
  },
};

export const optionSchemaMismatchRule: AuditRule = {
  id: "VARIANT_OPTION_SCHEMA_MISMATCH",
  version: 1,
  title: "Variant options do not match product schema",
  description: "Detects unknown option names or values that are outside a product's explicit declared option schema.",
  category: "Variant integrity",
  defaultSeverity: "high",
  rationale: "Schema mismatches make variant selection and downstream catalog mapping unreliable.",
  recommendedFix: "Align the variant's option names and values with the declared product options, or intentionally update the product schema.",
  applicability: { scope: "variant", appliesWhen: "The product has an explicit option schema and the variant supplies option data.", abstainsWhen: "No option schema or variant option data is present." },
  classification: "deterministic",
  evaluate(catalog) {
    return catalog.products.flatMap((product) => product.variants.flatMap((variant) => {
      const schema = new Map(product.options.map((option) => [option.name, option.values]));
      const unknownNames = Object.keys(variant.optionValues).filter((name) => !schema.has(name));
      const invalidValues = Object.entries(variant.optionValues).flatMap(([name, value]) => {
        const allowed = schema.get(name);
        if (!allowed || !value?.trim() || allowed.length === 0) return [];
        return allowed.some((candidate) => normalizedOptionValue(candidate) === normalizedOptionValue(value))
          ? []
          : [`${name}=${value}`];
      });
      if (unknownNames.length === 0 && invalidValues.length === 0) return [];
      return [finding({
        catalog,
        rule: optionSchemaMismatchRule,
        entityType: "variant",
        entityId: variant.id,
        product,
        message: `${variantLabel(product, variant)} contains option data outside the declared schema.`,
        evidence: [
          { label: "Unknown option names", value: unknownNames.join(", ") || "None" },
          { label: "Values outside schema", value: invalidValues.join(", ") || "None" },
        ],
        provenance: variant.provenance,
      })];
    }));
  },
};

export const invalidPriceRule: AuditRule = {
  id: "PRICE_INVALID",
  version: 1,
  title: "Variant price is invalid",
  description: "Detects required selling prices that are absent or non-numeric after import normalization.",
  category: "Price",
  defaultSeverity: "high",
  rationale: "A variant needs an unambiguous numeric selling price for reliable catalog operations.",
  recommendedFix: "Replace the raw price with a valid numeric amount using the store currency's expected decimal format.",
  applicability: { scope: "variant", appliesWhen: "A variant record exists; selling price is required by the supported normalized contract.", abstainsWhen: "No variant record exists." },
  classification: "deterministic",
  evaluate(catalog) {
    return catalog.products.flatMap((product) => product.variants.flatMap((variant) => {
      if (variant.price.validity === "valid") return [];
      return [finding({
        catalog,
        rule: invalidPriceRule,
        entityType: "variant",
        entityId: variant.id,
        product,
        message: `${variantLabel(product, variant)} does not have a valid numeric price.`,
        evidence: [
          { label: "Raw price", value: variant.price.raw === undefined ? null : String(variant.price.raw) },
          { label: "Normalization result", value: variant.price.validity },
        ],
        provenance: variant.provenance,
      })];
    }));
  },
};

export const negativePriceRule: AuditRule = {
  id: "PRICE_NEGATIVE",
  version: 1,
  title: "Negative price value",
  description: "Detects negative selling or compare-at prices.",
  category: "Price",
  defaultSeverity: "high",
  rationale: "Negative catalog price amounts are objectively invalid for a standard sellable variant.",
  recommendedFix: "Correct the negative amount to the intended non-negative selling or compare-at price.",
  applicability: { scope: "variant", appliesWhen: "A selling or compare-at amount normalized as numeric.", abstainsWhen: "Both amounts are absent or non-numeric; PRICE_INVALID covers an invalid selling price." },
  classification: "deterministic",
  evaluate(catalog) {
    return catalog.products.flatMap((product) => product.variants.flatMap((variant) => {
      const negativeFields = [
        ...(variant.price.value !== null && variant.price.value < 0 ? [`price=${variant.price.value}`] : []),
        ...(variant.compareAtPrice.value !== null && variant.compareAtPrice.value < 0
          ? [`compare-at price=${variant.compareAtPrice.value}`]
          : []),
      ];
      if (negativeFields.length === 0) return [];
      return [finding({
        catalog,
        rule: negativePriceRule,
        entityType: "variant",
        entityId: variant.id,
        product,
        message: `${variantLabel(product, variant)} contains a negative price amount.`,
        evidence: [{ label: "Negative values", value: negativeFields.join(", ") }],
        provenance: variant.provenance,
      })];
    }));
  },
};

export const compareAtBelowPriceRule: AuditRule = {
  id: "PRICE_COMPARE_AT_BELOW_PRICE",
  version: 1,
  title: "Compare-at price is below selling price",
  description: "Detects a positive compare-at price lower than the current selling price.",
  category: "Price",
  defaultSeverity: "medium",
  rationale: "A positive compare-at price represents the pre-sale price and should not be below the current selling price.",
  recommendedFix: "Correct or remove the compare-at price. A raw zero is treated as an absent sentinel and is not flagged by this rule.",
  applicability: { scope: "variant", appliesWhen: "Both selling and compare-at prices are numeric and compare-at is positive.", abstainsWhen: "Either amount is unknown, compare-at is absent, or compare-at is the supported zero sentinel." },
  classification: "deterministic",
  evaluate(catalog) {
    return catalog.products.flatMap((product) => product.variants.flatMap((variant) => {
      const price = variant.price.value;
      const compareAt = variant.compareAtPrice.value;
      if (price === null || compareAt === null || compareAt <= 0 || compareAt >= price) return [];
      return [finding({
        catalog,
        rule: compareAtBelowPriceRule,
        entityType: "variant",
        entityId: variant.id,
        product,
        message: `${variantLabel(product, variant)} has a compare-at price below its selling price.`,
        evidence: [
          { label: "Selling price", value: price },
          { label: "Compare-at price", value: compareAt },
        ],
        provenance: variant.provenance,
      })];
    }));
  },
};

export const inventoryAvailabilityRule: AuditRule = {
  id: "INVENTORY_AVAILABILITY_CONFLICT",
  version: 1,
  title: "Availability conflicts with tracked stock",
  description: "Detects variants explicitly marked available despite tracked, non-positive inventory and a deny-overselling policy.",
  category: "Inventory",
  defaultSeverity: "high",
  rationale: "With all four facts present, availability contradicts the catalog's own tracked inventory policy.",
  recommendedFix: "Reconcile the inventory quantity and availability state, or intentionally change the inventory policy if overselling is allowed.",
  applicability: { scope: "variant", appliesWhen: "The product is active and tracked state, inventory policy, numeric quantity, and availability are all explicit.", abstainsWhen: "The product is not active or any required inventory fact is unknown." },
  classification: "deterministic",
  evaluate(catalog) {
    return catalog.products.flatMap((product) => product.status !== "active" ? [] : product.variants.flatMap((variant) => {
      const conflict = variant.inventoryTracked === true
        && variant.inventoryPolicy === "deny"
        && variant.inventoryQuantity !== null
        && variant.inventoryQuantity <= 0
        && variant.available === true;
      if (!conflict) return [];
      return [finding({
        catalog,
        rule: inventoryAvailabilityRule,
        entityType: "variant",
        entityId: variant.id,
        product,
        message: `${variantLabel(product, variant)} is marked available while tracked stock is not positive and overselling is denied.`,
        evidence: [
          { label: "Inventory quantity", value: variant.inventoryQuantity },
          { label: "Inventory tracked", value: variant.inventoryTracked },
          { label: "Inventory policy", value: variant.inventoryPolicy },
          { label: "Available", value: variant.available },
        ],
        provenance: variant.provenance,
      })];
    }));
  },
};

export const duplicateProductHandleRule: AuditRule = {
  id: "PRODUCT_HANDLE_DUPLICATE",
  version: 1,
  title: "Duplicate product handle",
  description: "Detects distinct product records that share the same trimmed, case-insensitive handle.",
  category: "Product integrity",
  defaultSeverity: "high",
  rationale: "A product handle is a routing identity; one handle resolving to multiple source products is ambiguous.",
  recommendedFix: "Assign a distinct handle to each product record, then re-run the audit to confirm the collision is gone.",
  applicability: { scope: "product", appliesWhen: "At least two product records have non-blank handles.", abstainsWhen: "A product has no usable handle or there is only one product record." },
  classification: "deterministic",
  evaluate(catalog) {
    const byHandle = new Map<string, CatalogProduct[]>();
    for (const product of catalog.products) {
      const handle = product.handle.trim().toLocaleLowerCase();
      if (!handle) continue;
      const entries = byHandle.get(handle) ?? [];
      entries.push(product);
      byHandle.set(handle, entries);
    }
    return [...byHandle.entries()].flatMap(([handle, products]) => products.length < 2 ? [] : products.map((product) => finding({
      catalog,
      rule: duplicateProductHandleRule,
      entityType: "product",
      entityId: product.id,
      product,
      message: `Product handle “${product.handle.trim()}” is assigned to ${products.length} product records.`,
      evidence: [
        { label: "Normalized handle", value: handle },
        { label: "Source product IDs", value: products.map((entry) => entry.sourceProductId ?? "Unknown").join(", ") },
      ],
      provenance: products.flatMap((entry) => entry.provenance),
      discriminator: handle,
    })));
  },
};

export const duplicateProductIdRule: AuditRule = {
  id: "PRODUCT_ID_DUPLICATE",
  version: 1,
  title: "Duplicate source product ID",
  description: "Detects one non-empty source product ID assigned to more than one normalized product record.",
  category: "Product integrity",
  defaultSeverity: "high",
  rationale: "A stable source product ID must identify exactly one product record for reliable reconciliation.",
  recommendedFix: "Resolve the duplicate source records so each source product ID maps to one product.",
  applicability: { scope: "product", appliesWhen: "A product has a stable non-blank source product ID.", abstainsWhen: "The source product ID is absent." },
  classification: "deterministic",
  evaluate(catalog) {
    const byId = new Map<string, CatalogProduct[]>();
    for (const product of catalog.products) {
      const sourceId = product.sourceProductId?.trim();
      if (!sourceId) continue;
      const entries = byId.get(sourceId) ?? [];
      entries.push(product);
      byId.set(sourceId, entries);
    }
    return [...byId.entries()].flatMap(([sourceId, products]) => products.length < 2 ? [] : products.map((product) => finding({
      catalog,
      rule: duplicateProductIdRule,
      entityType: "product",
      entityId: product.id,
      product,
      message: `Source product ID “${sourceId}” is assigned to ${products.length} product records.`,
      evidence: [{ label: "Source product ID", value: sourceId }, { label: "Handles", value: products.map((entry) => entry.handle).join(", ") }],
      provenance: products.flatMap((entry) => entry.provenance),
      discriminator: sourceId,
    })));
  },
};

export const duplicateVariantIdRule: AuditRule = {
  id: "VARIANT_ID_DUPLICATE",
  version: 1,
  title: "Duplicate source variant ID",
  description: "Detects one non-empty source variant ID assigned to more than one normalized variant record.",
  category: "Variant integrity",
  defaultSeverity: "high",
  rationale: "A stable source variant ID must identify exactly one variant for inventory, fulfillment, and re-audit matching.",
  recommendedFix: "Resolve the duplicate source records so each source variant ID maps to one variant.",
  applicability: { scope: "variant", appliesWhen: "A variant has a stable non-blank source variant ID.", abstainsWhen: "The source variant ID is absent." },
  classification: "deterministic",
  evaluate(catalog) {
    const byId = new Map<string, { product: CatalogProduct; variant: CatalogVariant }[]>();
    for (const product of catalog.products) for (const variant of product.variants) {
      const sourceId = variant.sourceVariantId?.trim();
      if (!sourceId) continue;
      const entries = byId.get(sourceId) ?? [];
      entries.push({ product, variant });
      byId.set(sourceId, entries);
    }
    return [...byId.entries()].flatMap(([sourceId, entries]) => entries.length < 2 ? [] : entries.map(({ product, variant }) => finding({
      catalog,
      rule: duplicateVariantIdRule,
      entityType: "variant",
      entityId: variant.id,
      product,
      message: `Source variant ID “${sourceId}” is assigned to ${entries.length} variant records.`,
      evidence: [{ label: "Source variant ID", value: sourceId }, { label: "Variants", value: entries.map((entry) => variantLabel(entry.product, entry.variant)).join(" • ") }],
      provenance: entries.flatMap((entry) => entry.variant.provenance),
      discriminator: sourceId,
    })));
  },
};

export const activeProductNoVariantsRule: AuditRule = {
  id: "PRODUCT_NO_VARIANTS",
  version: 1,
  title: "Active product has no variants",
  description: "Detects an active product with zero normalized variant records.",
  category: "Product integrity",
  defaultSeverity: "high",
  rationale: "An active product with no variant record has no normalized purchasable configuration.",
  recommendedFix: "Add or restore the intended variant record, or correct the product lifecycle status if it should not be active.",
  applicability: { scope: "product", appliesWhen: "The product is active.", abstainsWhen: "The product is draft, archived, or has unknown lifecycle status." },
  classification: "deterministic",
  evaluate(catalog) {
    return catalog.products.flatMap((product) => product.status === "active" && product.variants.length === 0 ? [finding({
      catalog,
      rule: activeProductNoVariantsRule,
      entityType: "product",
      entityId: product.id,
      product,
      message: `${product.title} is active but has no normalized variants.`,
      evidence: [{ label: "Product status", value: product.status }, { label: "Variant count", value: 0 }],
      provenance: product.provenance,
    })] : []);
  },
};

export const productOptionValuesMissingRule: AuditRule = {
  id: "PRODUCT_OPTION_VALUES_MISSING",
  version: 1,
  title: "Product option has no values",
  description: "Detects active products whose declared option schema contains an empty canonical value set.",
  category: "Variant integrity",
  defaultSeverity: "high",
  rationale: "A declared selectable option with no allowed values cannot describe a viable variant matrix.",
  recommendedFix: "Populate the declared option values from the intended variants, or remove the unused option from the product schema.",
  applicability: { scope: "product", appliesWhen: "An active product declares at least one option.", abstainsWhen: "The product is not active or declares no options." },
  classification: "deterministic",
  evaluate(catalog) {
    return catalog.products.flatMap((product) => {
      if (product.status !== "active") return [];
      const emptyOptions = product.options.filter((option) => option.values.length === 0).map((option) => option.name);
      if (emptyOptions.length === 0) return [];
      return [finding({
        catalog,
        rule: productOptionValuesMissingRule,
        entityType: "product",
        entityId: product.id,
        product,
        message: `${product.title} declares ${emptyOptions.length} option${emptyOptions.length === 1 ? "" : "s"} with no values.`,
        evidence: [{ label: "Options without values", value: emptyOptions.join(", ") }],
        provenance: product.provenance,
      })];
    });
  },
};

export const auditRules: AuditRule[] = [
  duplicateProductHandleRule,
  duplicateProductIdRule,
  duplicateVariantIdRule,
  activeProductNoVariantsRule,
  productOptionValuesMissingRule,
  duplicateSkuRule,
  missingSkuRule,
  productNoImageRule,
  imageAltMissingRule,
  duplicateOptionCombinationRule,
  incompleteOptionRule,
  optionSchemaMismatchRule,
  invalidPriceRule,
  negativePriceRule,
  compareAtBelowPriceRule,
  inventoryAvailabilityRule,
];

export function getRule(ruleId: string): AuditRule | undefined {
  return auditRules.find((rule) => rule.id === ruleId);
}
