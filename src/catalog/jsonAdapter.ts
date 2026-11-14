import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import nativeCatalogV1Schema from "../../schemas/catalog-qa.catalog.v1.schema.json";
import {
  createImportMetadata,
  emptyCatalog,
  finalizeImportResult,
  normalizeAmount,
  slugify,
  textOrNull,
  type CatalogImage,
  type CatalogOption,
  type CatalogProduct,
  type CatalogVariant,
  type ImportIssue,
  type ImportResult,
  type ProductStatus,
  type SourceKind,
  type SourceProvenance,
} from "./model";
import type { CatalogSourceAdapter } from "./adapters";

export const NATIVE_JSON_SCHEMA_VERSION = "catalog-qa.catalog.v1";
export const NATIVE_JSON_ADAPTER_ID = "catalog-qa-json-v1";
export const NATIVE_JSON_ADAPTER_VERSION = 1;

type UnknownRecord = Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateCatalogV1 = ajv.compile(nativeCatalogV1Schema);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(textOrNull).filter((item): item is string => item !== null);
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function nullableBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1"].includes(normalized)) return true;
    if (["false", "no", "0"].includes(normalized)) return false;
  }
  return null;
}

function normalizeStatus(value: unknown): ProductStatus {
  const status = textOrNull(value)?.toLowerCase();
  return status === "active" || status === "draft" || status === "archived" ? status : "unknown";
}

function makeProvenance(
  sourceKind: SourceKind,
  sourceName: string,
  jsonPath: string,
  rawValues: UnknownRecord,
  sourceProductId?: string | null,
  sourceVariantId?: string | null,
): SourceProvenance {
  return {
    sourceKind,
    sourceName,
    jsonPath,
    sourceProductId: sourceProductId ?? undefined,
    sourceVariantId: sourceVariantId ?? undefined,
    rawValues,
  };
}

function normalizeOptions(value: unknown): CatalogOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const name = textOrNull(entry.name);
    if (!name) return [];
    return [{ name, position: index + 1, values: stringArray(entry.values) }];
  });
}

function normalizeImages(
  value: unknown,
  productId: string,
  sourceProductId: string | null,
  sourceKind: SourceKind,
  sourceName: string,
  basePath: string,
): CatalogImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    const raw = typeof entry === "string" ? { source: entry } : entry;
    if (!isRecord(raw)) return [];
    const source = textOrNull(raw.source ?? raw.url ?? raw.src);
    if (!source) return [];
    const positionRaw = raw.position;
    const positionValue = positionRaw === null || positionRaw === undefined || positionRaw === ""
      ? null
      : Number(positionRaw);
    return [{
      id: `${productId}:image:${index + 1}`,
      source,
      altText: textOrNull(raw.altText ?? raw.alt),
      position: positionValue !== null && Number.isFinite(positionValue) ? positionValue : null,
      provenance: [makeProvenance(sourceKind, sourceName, `${basePath}.images[${index}]`, raw, sourceProductId)],
      raw: entry,
    }];
  });
}

function normalizeVariant(
  raw: UnknownRecord,
  index: number,
  productId: string,
  sourceProductId: string | null,
  sourceKind: SourceKind,
  sourceName: string,
  basePath: string,
  issues: ImportIssue[],
): CatalogVariant {
  const sourceVariantId = textOrNull(raw.sourceVariantId ?? raw.id);
  const variantId = `${productId}:variant:${slugify(sourceVariantId ?? String(index + 1)) || index + 1}`;
  const rawOptions = isRecord(raw.options) ? raw.options : isRecord(raw.optionValues) ? raw.optionValues : {};
  const optionValues = Object.fromEntries(
    Object.entries(rawOptions).map(([name, value]) => [name.trim(), textOrNull(value)]),
  );
  const inventory = isRecord(raw.inventory) ? raw.inventory : {};
  const quantityRaw = inventory.quantity ?? raw.inventoryQuantity;
  const quantityParsed = quantityRaw === null || quantityRaw === undefined || quantityRaw === ""
    ? null
    : Number(quantityRaw);
  if (quantityParsed !== null && !Number.isFinite(quantityParsed)) {
    issues.push({
      level: "warning",
      type: "malformed",
      code: "JSON_INVENTORY_QUANTITY_INVALID",
      message: "Inventory quantity could not be normalized and remains unknown.",
      path: `${basePath}.variants[${index}].inventory.quantity`,
      field: "inventory.quantity",
      rawValue: quantityRaw,
    });
  }
  const policyRaw = textOrNull(inventory.policy ?? raw.inventoryPolicy)?.toLowerCase();

  return {
    id: variantId,
    sourceVariantId,
    title: textOrNull(raw.title),
    sku: textOrNull(raw.sku),
    barcode: textOrNull(raw.barcode),
    price: normalizeAmount(raw.price),
    compareAtPrice: normalizeAmount(raw.compareAtPrice),
    inventoryQuantity: quantityParsed !== null && Number.isFinite(quantityParsed) ? quantityParsed : null,
    inventoryQuantityRaw: quantityRaw,
    inventoryTracked: nullableBoolean(inventory.tracked ?? raw.inventoryTracked),
    inventoryPolicy: policyRaw === "deny" || policyRaw === "continue" ? policyRaw : null,
    available: nullableBoolean(raw.available ?? inventory.available),
    imageSource: textOrNull(raw.imageSource ?? raw.image),
    optionValues,
    provenance: [makeProvenance(
      sourceKind,
      sourceName,
      `${basePath}.variants[${index}]`,
      raw,
      sourceProductId,
      sourceVariantId,
    )],
    raw,
  };
}

function normalizeProduct(
  raw: UnknownRecord,
  index: number,
  sourceKind: SourceKind,
  sourceName: string,
  issues: ImportIssue[],
): CatalogProduct | null {
  const path = `$.products[${index}]`;
  const sourceProductId = textOrNull(raw.sourceProductId ?? raw.id);
  const title = textOrNull(raw.title);
  if (!title) return null;
  const handle = textOrNull(raw.handle) ?? slugify(title || `product-${index + 1}`);
  const productId = `product:${slugify(sourceProductId ?? handle) || index + 1}`;
  const variantsRaw = Array.isArray(raw.variants) ? raw.variants : [];
  const variants = variantsRaw.flatMap((variant, variantIndex) => {
    if (!isRecord(variant)) return [];
    return [normalizeVariant(variant, variantIndex, productId, sourceProductId, sourceKind, sourceName, path, issues)];
  });

  return {
    id: productId,
    sourceProductId,
    handle,
    title,
    description: textOrNull(raw.description ?? raw.body) ?? "",
    status: normalizeStatus(raw.status),
    publishedOnOnlineStore: nullableBoolean(raw.publishedOnOnlineStore ?? raw.published),
    vendor: textOrNull(raw.vendor),
    productType: textOrNull(raw.productType ?? raw.type),
    category: textOrNull(raw.category),
    tags: stringArray(raw.tags),
    options: normalizeOptions(raw.options),
    variants,
    images: normalizeImages(raw.images, productId, sourceProductId, sourceKind, sourceName, path),
    collections: stringArray(raw.collections),
    provenance: [makeProvenance(sourceKind, sourceName, path, raw, sourceProductId)],
    raw,
  };
}

function pathFromAjv(error: ErrorObject): string {
  const segments = error.instancePath.split("/").filter(Boolean).map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  let path = "$";
  for (const segment of segments) {
    path += /^\d+$/.test(segment) ? `[${segment}]` : `.${segment}`;
  }
  if (error.keyword === "required" && typeof error.params.missingProperty === "string") {
    path += `.${error.params.missingProperty}`;
  }
  return path;
}

function validationIssues(errors: ErrorObject[] | null | undefined): ImportIssue[] {
  const grouped = new Map<string, ErrorObject[]>();
  for (const error of errors ?? []) {
    const entries = grouped.get(error.instancePath) ?? [];
    entries.push(error);
    grouped.set(error.instancePath, entries);
  }
  return [...grouped.values()].flatMap((entries) => {
    const selected = entries.find((error) => error.keyword === "oneOf") ?? entries[0];
    if (!selected) return [];
    return [{
      level: "error" as const,
      type: "validation" as const,
      code: `JSON_SCHEMA_${selected.keyword.toUpperCase()}`,
      message: `Native JSON v1 validation failed: ${selected.message ?? selected.keyword}.`,
      path: pathFromAjv(selected),
      field: selected.keyword === "required" ? String(selected.params.missingProperty) : undefined,
    }];
  });
}

export function importNativeJson(
  input: string | unknown,
  sourceName = "catalog.json",
  sourceKind: SourceKind = "json",
): ImportResult {
  const issues: ImportIssue[] = [];
  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch (error) {
      const catalog = emptyCatalog({
        kind: sourceKind,
        name: sourceName,
        format: "catalog-qa-json-v1",
        adapterId: NATIVE_JSON_ADAPTER_ID,
        adapterVersion: NATIVE_JSON_ADAPTER_VERSION,
        rawSource: input,
      });
      return finalizeImportResult({
        catalog,
        metadata: createImportMetadata(catalog),
        issues: [{
          level: "error",
          type: "parse",
          code: "JSON_PARSE_ERROR",
          message: error instanceof Error ? error.message : "The JSON file could not be parsed.",
          path: "$",
        }],
      });
    }
  }

  if (!isRecord(parsed)) {
    const catalog = emptyCatalog({
      kind: sourceKind,
      name: sourceName,
      format: "catalog-qa-json-v1",
      adapterId: NATIVE_JSON_ADAPTER_ID,
      adapterVersion: NATIVE_JSON_ADAPTER_VERSION,
      rawSource: input,
    });
    return finalizeImportResult({
      catalog,
      metadata: createImportMetadata(catalog),
      issues: [{
        level: "error",
        type: "validation",
        code: "JSON_CATALOG_SHAPE_INVALID",
        message: "Expected a JSON object using the catalog-qa.catalog.v1 contract.",
        path: "$",
      }],
    });
  }

  const schemaVersion = textOrNull(parsed.schemaVersion);
  if (schemaVersion !== NATIVE_JSON_SCHEMA_VERSION) {
    const catalog = emptyCatalog({
      kind: sourceKind,
      name: sourceName,
      format: "catalog-qa-json-v1",
      adapterId: NATIVE_JSON_ADAPTER_ID,
      adapterVersion: NATIVE_JSON_ADAPTER_VERSION,
      schemaVersion: schemaVersion ?? undefined,
      rawSource: input,
    });
    return finalizeImportResult({
      catalog,
      metadata: createImportMetadata(catalog),
      issues: [{
        level: "error",
        type: "unsupported",
        code: schemaVersion ? "JSON_SCHEMA_VERSION_UNSUPPORTED" : "JSON_SCHEMA_VERSION_MISSING",
        message: schemaVersion
          ? `Schema version ${schemaVersion} is not supported; expected ${NATIVE_JSON_SCHEMA_VERSION}.`
          : `Native JSON must declare schemaVersion ${NATIVE_JSON_SCHEMA_VERSION}.`,
        path: "$.schemaVersion",
        field: "schemaVersion",
        rawValue: parsed.schemaVersion,
      }],
    });
  }

  const catalog = emptyCatalog({
    kind: sourceKind,
    name: sourceName,
    format: "catalog-qa-json-v1",
    adapterId: NATIVE_JSON_ADAPTER_ID,
    adapterVersion: NATIVE_JSON_ADAPTER_VERSION,
    schemaVersion,
    rawSource: input,
  });
  const metadata = createImportMetadata(catalog);

  validateCatalogV1(parsed);
  issues.push(...validationIssues(validateCatalogV1.errors));

  if (Array.isArray(parsed.products)) {
    catalog.products = parsed.products.flatMap((product, index) => {
      if (!isRecord(product)) return [];
      const normalized = normalizeProduct(product, index, sourceKind, sourceName, issues);
      return normalized ? [normalized] : [];
    });
  }

  return finalizeImportResult({ catalog, issues, metadata });
}

export const nativeJsonAdapter: CatalogSourceAdapter = {
  id: NATIVE_JSON_ADAPTER_ID,
  version: NATIVE_JSON_ADAPTER_VERSION,
  format: "catalog-qa-json-v1",
  canHandle(sourceName, input) {
    return sourceName.toLowerCase().endsWith(".json") || input.trimStart().startsWith("{");
  },
  import(input, sourceName) {
    return importNativeJson(input, sourceName);
  },
};