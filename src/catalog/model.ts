export type ProductStatus = "active" | "draft" | "archived" | "unknown";
export type SourceKind = "fixture" | "csv" | "json" | "unknown";
export type SourceFormat = "shopify-product-csv" | "catalog-qa-json-v1" | "unknown";
export type ImportDiagnosticLevel = "info" | "warning" | "error";
export type ImportDiagnosticType =
  | "parse"
  | "validation"
  | "malformed"
  | "unsupported"
  | "extension"
  | "conflict"
  | "defaulted";

export interface SourceProvenance {
  sourceKind: SourceKind;
  sourceName: string;
  rowNumber?: number;
  jsonPath?: string;
  sourceProductId?: string;
  sourceVariantId?: string;
  rawValues: Record<string, unknown>;
}

export interface CatalogAmount {
  raw: unknown;
  value: number | null;
  validity: "valid" | "missing" | "invalid";
}

export interface CatalogOption {
  name: string;
  position: number;
  values: string[];
}

export interface CatalogImage {
  id: string;
  source: string;
  altText: string | null;
  position: number | null;
  provenance: SourceProvenance[];
  raw: unknown;
}

export interface CatalogVariant {
  id: string;
  sourceVariantId: string | null;
  title: string | null;
  sku: string | null;
  barcode: string | null;
  price: CatalogAmount;
  compareAtPrice: CatalogAmount;
  inventoryQuantity: number | null;
  inventoryQuantityRaw: unknown;
  inventoryTracked: boolean | null;
  inventoryPolicy: "deny" | "continue" | null;
  available: boolean | null;
  imageSource: string | null;
  optionValues: Record<string, string | null>;
  provenance: SourceProvenance[];
  raw: unknown;
}

export interface CatalogProduct {
  id: string;
  sourceProductId: string | null;
  handle: string;
  title: string;
  description: string;
  status: ProductStatus;
  publishedOnOnlineStore: boolean | null;
  vendor: string | null;
  productType: string | null;
  category: string | null;
  tags: string[];
  options: CatalogOption[];
  variants: CatalogVariant[];
  images: CatalogImage[];
  collections: string[];
  provenance: SourceProvenance[];
  raw: unknown;
}

export interface CatalogSource {
  kind: SourceKind;
  name: string;
  format: SourceFormat;
  adapterId: string;
  adapterVersion: number;
  schemaVersion?: string;
  fingerprint: string;
}

export interface Catalog {
  id: string;
  source: CatalogSource;
  products: CatalogProduct[];
  rawSource: unknown;
}

export interface ImportIssue {
  level: ImportDiagnosticLevel;
  type: ImportDiagnosticType;
  code: string;
  message: string;
  rowNumber?: number;
  path?: string;
  field?: string;
  rawValue?: unknown;
}

export interface ImportMetadata {
  adapterId: string;
  adapterVersion: number;
  sourceName: string;
  sourceFormat: SourceFormat;
  schemaVersion?: string;
  sourceFingerprint: string;
  headers: string[];
  extensionColumns: string[];
  ignoredColumns: string[];
  normalizedCounts: {
    products: number;
    variants: number;
    images: number;
  };
}

export interface ImportResult {
  catalog: Catalog;
  issues: ImportIssue[];
  metadata: ImportMetadata;
}

export interface EmptyCatalogOptions {
  kind: SourceKind;
  name: string;
  format: SourceFormat;
  adapterId: string;
  adapterVersion: number;
  rawSource: unknown;
  schemaVersion?: string;
}

export function emptyCatalog(options: EmptyCatalogOptions): Catalog {
  return {
    id: `catalog:${slugify(options.name) || "untitled"}`,
    source: {
      kind: options.kind,
      name: options.name,
      format: options.format,
      adapterId: options.adapterId,
      adapterVersion: options.adapterVersion,
      schemaVersion: options.schemaVersion,
      fingerprint: fingerprintSource(options.rawSource),
    },
    products: [],
    rawSource: options.rawSource,
  };
}

export function createImportMetadata(catalog: Catalog): ImportMetadata {
  return {
    adapterId: catalog.source.adapterId,
    adapterVersion: catalog.source.adapterVersion,
    sourceName: catalog.source.name,
    sourceFormat: catalog.source.format,
    schemaVersion: catalog.source.schemaVersion,
    sourceFingerprint: catalog.source.fingerprint,
    headers: [],
    extensionColumns: [],
    ignoredColumns: [],
    normalizedCounts: { products: 0, variants: 0, images: 0 },
  };
}

export function finalizeImportResult(result: ImportResult): ImportResult {
  result.metadata.normalizedCounts = {
    products: result.catalog.products.length,
    variants: result.catalog.products.reduce((total, product) => total + product.variants.length, 0),
    images: result.catalog.products.reduce((total, product) => total + product.images.length, 0),
  };
  return result;
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

export function normalizeAmount(value: unknown): CatalogAmount {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return { raw: value, value: null, validity: "missing" };
  }

  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed)) {
    return { raw: value, value: null, validity: "invalid" };
  }

  return { raw: value, value: parsed, validity: "valid" };
}

export function fingerprintSource(value: unknown): string {
  const serialized = typeof value === "string" ? value : stableSerialize(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}