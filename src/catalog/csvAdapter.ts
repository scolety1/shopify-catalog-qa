import Papa from "papaparse";
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
  type SourceProvenance,
} from "./model";
import type { CatalogSourceAdapter } from "./adapters";

export const SHOPIFY_CSV_ADAPTER_ID = "shopify-product-csv";
export const SHOPIFY_CSV_ADAPTER_VERSION = 3;

export const SHOPIFY_HEADER_ALIASES = {
  handle: ["URL handle", "Handle"],
  title: ["Title"],
  description: ["Description", "Body (HTML)"],
  vendor: ["Vendor"],
  productCategory: ["Product category", "Product Category"],
  productType: ["Type"],
  tags: ["Tags"],
  published: ["Published on online store", "Published"],
  status: ["Status"],
  sourceProductId: ["Product ID"],
  sourceVariantId: ["Variant ID"],
  variantTitle: ["Variant Title"],
  sku: ["SKU", "Variant SKU"],
  barcode: ["Barcode", "Variant Barcode"],
  price: ["Price", "Variant Price"],
  compareAtPrice: ["Compare-at price", "Variant Compare At Price", "Variant Compare-at Price"],
  inventoryQuantity: ["Inventory quantity", "Variant Inventory Qty"],
  inventoryTracker: ["Inventory tracker", "Variant Inventory Tracker"],
  inventoryPolicy: ["Variant Inventory Policy"],
  continueSelling: ["Continue selling when out of stock"],
  available: ["Available"],
  option1Name: ["Option1 name", "Option1 Name"],
  option1Value: ["Option1 value", "Option1 Value"],
  option2Name: ["Option2 name", "Option2 Name"],
  option2Value: ["Option2 value", "Option2 Value"],
  option3Name: ["Option3 name", "Option3 Name"],
  option3Value: ["Option3 value", "Option3 Value"],
  imageSource: ["Product image URL", "Image Src"],
  imagePosition: ["Image position", "Image Position"],
  imageAltText: ["Image alt text", "Image Alt Text"],
  variantImage: ["Variant image URL", "Variant Image"],
  collection: ["Collection"],
} as const;

type CsvField = keyof typeof SHOPIFY_HEADER_ALIASES;

interface CsvRecord {
  rowNumber: number;
  values: Record<string, string>;
}

interface ParsedCsv {
  headers: string[];
  records: CsvRecord[];
  issues: ImportIssue[];
}

interface ProductAccumulator {
  product: CatalogProduct;
  optionSchema: Map<number, string>;
  optionValues: Map<string, Set<string>>;
  imageKeys: Set<string>;
  hasExplicitTitle: boolean;
}

const RECOGNIZED_IGNORED_HEADERS = new Set([
  "cost per item",
  "charge tax",
  "weight value (grams)",
  "weight unit for display",
  "requires shipping",
  "fulfillment service",
  "gift card",
  "seo title",
  "seo description",
  "variant grams",
  "variant requires shipping",
  "variant taxable",
  "variant fulfillment service",
]);

const EXTENSION_HEADER_PATTERNS = [
  /^included\s*\//i,
  /^price\s*\//i,
  /^compare-at price\s*\//i,
  /^google shopping\s*\//i,
  /product\.metafields\./i,
  /\(product\.metafields\./i,
  /^option[123]\s+linkedto$/i,
];

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().replace(/\s+/g, " ").toLowerCase();
}

const ALIAS_TO_FIELD = new Map<string, CsvField>();
for (const [field, aliases] of Object.entries(SHOPIFY_HEADER_ALIASES) as [CsvField, readonly string[]][]) {
  for (const alias of aliases) ALIAS_TO_FIELD.set(normalizeHeader(alias), field);
}

function parseCsv(input: string): ParsedCsv {
  const parsed = Papa.parse<string[]>(input, {
    skipEmptyLines: "greedy",
  });
  const issues: ImportIssue[] = parsed.errors.map((error) => ({
    level: "error",
    type: "parse",
    code: `CSV_${error.code.toUpperCase()}`,
    message: error.message,
    rowNumber: typeof error.row === "number" ? error.row + 1 : undefined,
  }));
  const rows = parsed.data;
  if (rows.length === 0) {
    issues.push({ level: "error", type: "parse", code: "CSV_EMPTY", message: "The CSV file is empty." });
    return { headers: [], records: [], issues };
  }

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim());
  const duplicateHeaders = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  if (duplicateHeaders.length > 0) {
    issues.push({
      level: "warning",
      type: "conflict",
      code: "CSV_DUPLICATE_HEADERS",
      message: `Duplicate headers were preserved with column suffixes: ${[...new Set(duplicateHeaders)].join(", ")}.`,
      rowNumber: 1,
    });
  }

  const records = rows.slice(1).map((cells, index) => {
    const values: Record<string, string> = {};
    headers.forEach((header, headerIndex) => {
      const base = header || `Unnamed column ${headerIndex + 1}`;
      const key = Object.hasOwn(values, base) ? `${base} [column ${headerIndex + 1}]` : base;
      values[key] = cells[headerIndex] ?? "";
    });
    if (cells.length !== headers.length) {
      issues.push({
        level: "warning",
        type: "malformed",
        code: "CSV_COLUMN_COUNT_MISMATCH",
        message: `Row ${index + 2} has ${cells.length} fields; the header has ${headers.length}.`,
        rowNumber: index + 2,
        rawValue: cells,
      });
      for (let extraIndex = headers.length; extraIndex < cells.length; extraIndex += 1) {
        values[`Unmapped column ${extraIndex + 1}`] = cells[extraIndex] ?? "";
      }
    }
    return { rowNumber: index + 2, values };
  });

  return { headers, records, issues };
}

function buildHeaderMap(headers: string[], issues: ImportIssue[]): Partial<Record<CsvField, string>> {
  const result: Partial<Record<CsvField, string>> = {};
  for (const header of headers) {
    const field = ALIAS_TO_FIELD.get(normalizeHeader(header));
    if (!field) continue;
    const existing = result[field];
    if (existing && existing !== header) {
      issues.push({
        level: "warning",
        type: "conflict",
        code: "CSV_HEADER_ALIAS_CONFLICT",
        message: `${existing} and ${header} both map to ${field}; ${existing} takes precedence.`,
        rowNumber: 1,
        field: header,
      });
      continue;
    }
    result[field] = header;
  }
  return result;
}

function valueFor(record: CsvRecord, field: CsvField, headerMap: Partial<Record<CsvField, string>>): string {
  const header = headerMap[field];
  return header ? record.values[header] ?? "" : "";
}

function headerFor(field: CsvField, headerMap: Partial<Record<CsvField, string>>): string {
  return headerMap[field] ?? SHOPIFY_HEADER_ALIASES[field][0];
}

function isExtensionHeader(header: string): boolean {
  return EXTENSION_HEADER_PATTERNS.some((pattern) => pattern.test(header));
}

function provenanceFor(
  record: CsvRecord,
  sourceName: string,
  productId?: string,
  variantId?: string,
): SourceProvenance {
  return {
    sourceKind: "csv",
    sourceName,
    rowNumber: record.rowNumber,
    sourceProductId: productId,
    sourceVariantId: variantId,
    rawValues: record.values,
  };
}

function parseBoolean(
  raw: string,
  record: CsvRecord,
  field: CsvField,
  headerMap: Partial<Record<CsvField, string>>,
  issues: ImportIssue[],
): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (["true", "yes", "1"].includes(normalized)) return true;
  if (["false", "no", "0"].includes(normalized)) return false;
  issues.push({
    level: "warning",
    type: "malformed",
    code: "CSV_BOOLEAN_INVALID",
    message: `${headerFor(field, headerMap)} must be true or false; the value remains unknown.`,
    rowNumber: record.rowNumber,
    field: headerFor(field, headerMap),
    rawValue: raw,
  });
  return null;
}

function parseStatus(
  raw: string,
  record: CsvRecord,
  headerMap: Partial<Record<CsvField, string>>,
  issues: ImportIssue[],
): ProductStatus {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized === "active" || normalized === "draft" || normalized === "archived") return normalized;
  issues.push({
    level: "warning",
    type: "unsupported",
    code: "CSV_STATUS_UNKNOWN",
    message: `Status ${raw} is not one of active, draft, or archived; status remains unknown.`,
    rowNumber: record.rowNumber,
    field: headerFor("status", headerMap),
    rawValue: raw,
  });
  return "unknown";
}

function hasVariantData(record: CsvRecord, headerMap: Partial<Record<CsvField, string>>): boolean {
  const fields: CsvField[] = [
    "sourceVariantId", "variantTitle", "sku", "barcode", "price", "compareAtPrice",
    "inventoryQuantity", "inventoryTracker", "inventoryPolicy", "continueSelling", "available",
    "option1Name", "option1Value", "option2Name", "option2Value", "option3Name", "option3Value",
  ];
  return fields.some((field) => valueFor(record, field, headerMap).trim() !== "");
}

function hasVariantAnchor(record: CsvRecord, headerMap: Partial<Record<CsvField, string>>): boolean {
  const fields: CsvField[] = [
    "sourceVariantId", "variantTitle", "sku", "barcode", "price", "compareAtPrice",
    "option1Name", "option1Value", "option2Name", "option2Value", "option3Name", "option3Value",
  ];
  return fields.some((field) => valueFor(record, field, headerMap).trim() !== "");
}

function hasProductImage(record: CsvRecord, headerMap: Partial<Record<CsvField, string>>): boolean {
  return valueFor(record, "imageSource", headerMap).trim() !== "";
}

function hasVariantImage(record: CsvRecord, headerMap: Partial<Record<CsvField, string>>): boolean {
  return valueFor(record, "variantImage", headerMap).trim() !== "";
}

function createProduct(
  record: CsvRecord,
  handle: string,
  sourceName: string,
  headerMap: Partial<Record<CsvField, string>>,
  issues: ImportIssue[],
): ProductAccumulator {
  const sourceProductId = textOrNull(valueFor(record, "sourceProductId", headerMap));
  const suppliedTitle = textOrNull(valueFor(record, "title", headerMap));
  if (!suppliedTitle) {
    issues.push({
      level: "error",
      type: "malformed",
      code: "CSV_PRODUCT_TITLE_MISSING",
      message: `Product ${handle} has no source Title; the handle is used only as a display fallback for partial analysis.`,
      rowNumber: record.rowNumber,
      field: headerFor("title", headerMap),
    });
  }
  const productId = `product:${slugify(sourceProductId ?? handle) || record.rowNumber}`;
  const statusRaw = valueFor(record, "status", headerMap);
  const collection = textOrNull(valueFor(record, "collection", headerMap));
  return {
    product: {
      id: productId,
      sourceProductId,
      handle,
      title: suppliedTitle ?? handle,
      description: textOrNull(valueFor(record, "description", headerMap)) ?? "",
      status: parseStatus(statusRaw, record, headerMap, issues),
      publishedOnOnlineStore: parseBoolean(valueFor(record, "published", headerMap), record, "published", headerMap, issues),
      vendor: textOrNull(valueFor(record, "vendor", headerMap)),
      productType: textOrNull(valueFor(record, "productType", headerMap)),
      category: textOrNull(valueFor(record, "productCategory", headerMap)),
      tags: valueFor(record, "tags", headerMap).split(",").map((tag) => tag.trim()).filter(Boolean),
      options: [],
      variants: [],
      images: [],
      collections: collection ? [collection] : [],
      provenance: [provenanceFor(record, sourceName, sourceProductId ?? undefined)],
      raw: { rows: [record.values] },
    },
    optionSchema: new Map(),
    optionValues: new Map(),
    imageKeys: new Set(),
    hasExplicitTitle: suppliedTitle !== null,
  };
}

function mergeTextField(
  accumulator: ProductAccumulator,
  record: CsvRecord,
  field: CsvField,
  current: string | null,
  assign: (value: string) => void,
  headerMap: Partial<Record<CsvField, string>>,
  issues: ImportIssue[],
): void {
  const incoming = textOrNull(valueFor(record, field, headerMap));
  if (!incoming) return;
  if (!current) {
    assign(incoming);
    return;
  }
  if (current !== incoming) {
    issues.push({
      level: "warning",
      type: "conflict",
      code: "CSV_PRODUCT_FIELD_CONFLICT",
      message: `${headerFor(field, headerMap)} conflicts with the first non-blank value for this product; the first value is retained.`,
      rowNumber: record.rowNumber,
      field: headerFor(field, headerMap),
      rawValue: incoming,
    });
  }
}

function mergeProductFields(
  accumulator: ProductAccumulator,
  record: CsvRecord,
  sourceName: string,
  headerMap: Partial<Record<CsvField, string>>,
  issues: ImportIssue[],
): void {
  const { product } = accumulator;
  product.provenance.push(provenanceFor(record, sourceName, product.sourceProductId ?? undefined));
  (product.raw as { rows: Record<string, string>[] }).rows.push(record.values);

  const incomingTitle = textOrNull(valueFor(record, "title", headerMap));
  if (incomingTitle && !accumulator.hasExplicitTitle) {
    product.title = incomingTitle;
    accumulator.hasExplicitTitle = true;
  } else if (incomingTitle && incomingTitle !== product.title) {
    issues.push({
      level: "warning",
      type: "conflict",
      code: "CSV_PRODUCT_FIELD_CONFLICT",
      message: "Title conflicts with the first non-blank value for this product; the first value is retained.",
      rowNumber: record.rowNumber,
      field: headerFor("title", headerMap),
      rawValue: incomingTitle,
    });
  }

  mergeTextField(accumulator, record, "description", product.description || null, (value) => { product.description = value; }, headerMap, issues);
  mergeTextField(accumulator, record, "vendor", product.vendor, (value) => { product.vendor = value; }, headerMap, issues);
  mergeTextField(accumulator, record, "productType", product.productType, (value) => { product.productType = value; }, headerMap, issues);
  mergeTextField(accumulator, record, "productCategory", product.category, (value) => { product.category = value; }, headerMap, issues);

  const statusRaw = valueFor(record, "status", headerMap);
  if (statusRaw.trim()) {
    const incomingStatus = parseStatus(statusRaw, record, headerMap, issues);
    if (product.status === "unknown") product.status = incomingStatus;
    else if (incomingStatus !== "unknown" && incomingStatus !== product.status) {
      issues.push({
        level: "warning",
        type: "conflict",
        code: "CSV_PRODUCT_STATUS_CONFLICT",
        message: `Status ${incomingStatus} conflicts with ${product.status}; the first status is retained.`,
        rowNumber: record.rowNumber,
        field: headerFor("status", headerMap),
        rawValue: statusRaw,
      });
    }
  }

  const publishedRaw = valueFor(record, "published", headerMap);
  if (publishedRaw.trim()) {
    const incomingPublished = parseBoolean(publishedRaw, record, "published", headerMap, issues);
    if (product.publishedOnOnlineStore === null) product.publishedOnOnlineStore = incomingPublished;
  }

  const tags = valueFor(record, "tags", headerMap).split(",").map((tag) => tag.trim()).filter(Boolean);
  if (tags.length > 0 && product.tags.length === 0) product.tags = tags;
  else if (tags.length > 0 && tags.join("|") !== product.tags.join("|")) {
    issues.push({
      level: "warning",
      type: "conflict",
      code: "CSV_PRODUCT_FIELD_CONFLICT",
      message: "Tags conflict with the first non-blank value for this product; the first value is retained.",
      rowNumber: record.rowNumber,
      field: headerFor("tags", headerMap),
      rawValue: valueFor(record, "tags", headerMap),
    });
  }

  const collection = textOrNull(valueFor(record, "collection", headerMap));
  if (collection && !product.collections.includes(collection)) product.collections.push(collection);
}

function addOptions(
  accumulator: ProductAccumulator,
  record: CsvRecord,
  headerMap: Partial<Record<CsvField, string>>,
  issues: ImportIssue[],
): Record<string, string | null> {
  const selections: Record<string, string | null> = {};
  const suppliedPositions = [1, 2, 3].map((position) => {
    const nameField = `option${position}Name` as CsvField;
    const valueField = `option${position}Value` as CsvField;
    return valueFor(record, nameField, headerMap).trim() !== "" || valueFor(record, valueField, headerMap).trim() !== "";
  });
  for (let index = 1; index < suppliedPositions.length; index += 1) {
    if (suppliedPositions[index] && suppliedPositions.slice(0, index).some((supplied) => !supplied)) {
      issues.push({
        level: "warning",
        type: "malformed",
        code: "CSV_OPTION_POSITION_GAP",
        message: `Option${index + 1} is supplied while an earlier option position is blank; positions are preserved without guessing.`,
        rowNumber: record.rowNumber,
        field: headerFor(`option${index + 1}Name` as CsvField, headerMap),
      });
      break;
    }
  }
  for (let position = 1; position <= 3; position += 1) {
    const nameField = `option${position}Name` as CsvField;
    const valueField = `option${position}Value` as CsvField;
    const suppliedName = textOrNull(valueFor(record, nameField, headerMap));
    const optionValue = textOrNull(valueFor(record, valueField, headerMap));
    if (!suppliedName && !optionValue) continue;
    if (suppliedName?.toLowerCase() === "title" && optionValue?.toLowerCase() === "default title") continue;
    if (suppliedName?.toLowerCase() === "default title" && optionValue?.toLowerCase() === "default title") continue;

    const establishedName = accumulator.optionSchema.get(position);
    if (suppliedName && establishedName && suppliedName.toLocaleLowerCase() !== establishedName.toLocaleLowerCase()) {
      issues.push({
        level: "warning",
        type: "conflict",
        code: "CSV_OPTION_SCHEMA_CONFLICT",
        message: `Option${position} name ${suppliedName} conflicts with established schema name ${establishedName}.`,
        rowNumber: record.rowNumber,
        field: headerFor(nameField, headerMap),
        rawValue: suppliedName,
      });
      selections[suppliedName] = optionValue;
      continue;
    }

    const name = suppliedName ?? establishedName;
    if (!name) {
      issues.push({
        level: "error",
        type: "malformed",
        code: "CSV_OPTION_NAME_MISSING",
        message: `Option${position} has a value but no option name or established product schema.`,
        rowNumber: record.rowNumber,
        field: headerFor(valueField, headerMap),
        rawValue: optionValue,
      });
      continue;
    }

    if (!establishedName) accumulator.optionSchema.set(position, name);
    selections[name] = optionValue;
    if (!accumulator.optionValues.has(name)) accumulator.optionValues.set(name, new Set());
    if (optionValue) accumulator.optionValues.get(name)?.add(optionValue);
  }
  return selections;
}

function parseNumberField(
  raw: string,
  record: CsvRecord,
  field: CsvField,
  headerMap: Partial<Record<CsvField, string>>,
  issues: ImportIssue[],
): number | null {
  if (!raw.trim()) return null;
  const parsed = Number(raw.trim());
  if (Number.isFinite(parsed)) return parsed;
  issues.push({
    level: "warning",
    type: "malformed",
    code: "CSV_NUMBER_INVALID",
    message: `${headerFor(field, headerMap)} could not be normalized and remains unknown.`,
    rowNumber: record.rowNumber,
    field: headerFor(field, headerMap),
    rawValue: raw,
  });
  return null;
}

function inventoryPolicyFor(
  record: CsvRecord,
  headerMap: Partial<Record<CsvField, string>>,
  issues: ImportIssue[],
): "deny" | "continue" | null {
  const legacy = valueFor(record, "inventoryPolicy", headerMap).trim().toLowerCase();
  if (legacy) {
    if (legacy === "deny" || legacy === "continue") return legacy;
    issues.push({
      level: "warning",
      type: "malformed",
      code: "CSV_INVENTORY_POLICY_INVALID",
      message: "Variant inventory policy must be deny or continue; policy remains unknown.",
      rowNumber: record.rowNumber,
      field: headerFor("inventoryPolicy", headerMap),
      rawValue: legacy,
    });
    return null;
  }
  const current = valueFor(record, "continueSelling", headerMap);
  if (!current.trim()) return null;
  const parsed = parseBoolean(current, record, "continueSelling", headerMap, issues);
  return parsed === true ? "continue" : parsed === false ? "deny" : null;
}

function inventoryTrackedFor(
  raw: string,
  record: CsvRecord,
  headerMap: Partial<Record<CsvField, string>>,
  issues: ImportIssue[],
): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (["false", "no", "0", "none"].includes(normalized)) return false;
  if (["true", "yes", "1", "shopify"].includes(normalized)) return true;
  issues.push({
    level: "warning",
    type: "unsupported",
    code: "CSV_INVENTORY_TRACKER_UNKNOWN",
    message: "Inventory tracker is not a supported tracked or untracked value; tracking remains unknown.",
    rowNumber: record.rowNumber,
    field: headerFor("inventoryTracker", headerMap),
    rawValue: raw,
  });
  return null;
}

function addImageRecord(
  accumulator: ProductAccumulator,
  record: CsvRecord,
  sourceName: string,
  source: string,
  altText: string | null,
  position: number | null,
  sourceVariantId?: string | null,
): CatalogImage | null {
  const key = source;
  if (accumulator.imageKeys.has(key)) {
    const existing = accumulator.product.images.find((image) => image.source === source) ?? null;
    if (existing) {
      if (!existing.altText && altText) existing.altText = altText;
      if (existing.position === null && position !== null) existing.position = position;
      const provenance = provenanceFor(
        record,
        sourceName,
        accumulator.product.sourceProductId ?? undefined,
        sourceVariantId ?? undefined,
      );
      if (!existing.provenance.some((entry) => entry.rowNumber === provenance.rowNumber)) existing.provenance.push(provenance);
    }
    return existing;
  }
  accumulator.imageKeys.add(key);
  const image: CatalogImage = {
    id: `${accumulator.product.id}:image:${accumulator.product.images.length + 1}`,
    source,
    altText,
    position,
    provenance: [provenanceFor(
      record,
      sourceName,
      accumulator.product.sourceProductId ?? undefined,
      sourceVariantId ?? undefined,
    )],
    raw: record.values,
  };
  accumulator.product.images.push(image);
  return image;
}

function addProductImage(
  accumulator: ProductAccumulator,
  record: CsvRecord,
  sourceName: string,
  headerMap: Partial<Record<CsvField, string>>,
  issues: ImportIssue[],
): void {
  const source = textOrNull(valueFor(record, "imageSource", headerMap));
  if (!source) return;
  const position = parseNumberField(valueFor(record, "imagePosition", headerMap), record, "imagePosition", headerMap, issues);
  addImageRecord(
    accumulator,
    record,
    sourceName,
    source,
    textOrNull(valueFor(record, "imageAltText", headerMap)),
    position,
  );
}

function addStandaloneVariantImage(
  accumulator: ProductAccumulator,
  record: CsvRecord,
  sourceName: string,
  headerMap: Partial<Record<CsvField, string>>,
): void {
  if (hasVariantData(record, headerMap)) return;
  const source = textOrNull(valueFor(record, "variantImage", headerMap));
  if (!source) return;
  addImageRecord(
    accumulator,
    record,
    sourceName,
    source,
    textOrNull(valueFor(record, "imageAltText", headerMap)),
    null,
  );
}

function addVariant(
  accumulator: ProductAccumulator,
  record: CsvRecord,
  sourceName: string,
  headerMap: Partial<Record<CsvField, string>>,
  issues: ImportIssue[],
): void {
  if (!hasVariantData(record, headerMap)) return;
  if (!hasVariantAnchor(record, headerMap)) {
    issues.push({
      level: "warning",
      type: "malformed",
      code: "CSV_PARTIAL_VARIANT_ROW_SKIPPED",
      message: "Partial inventory or availability data was not turned into a variant because the row has no variant ID, SKU, price, title, barcode, compare-at price, or option data.",
      rowNumber: record.rowNumber,
      rawValue: record.values,
    });
    return;
  }
  const product = accumulator.product;
  const sourceVariantId = textOrNull(valueFor(record, "sourceVariantId", headerMap));
  const quantityRaw = valueFor(record, "inventoryQuantity", headerMap);
  const inventoryQuantity = parseNumberField(quantityRaw, record, "inventoryQuantity", headerMap, issues);
  const variantImage = textOrNull(valueFor(record, "variantImage", headerMap));
  const variant: CatalogVariant = {
    id: `${product.id}:variant:${slugify(sourceVariantId ?? String(record.rowNumber)) || record.rowNumber}`,
    sourceVariantId,
    title: textOrNull(valueFor(record, "variantTitle", headerMap)),
    sku: textOrNull(valueFor(record, "sku", headerMap)),
    barcode: textOrNull(valueFor(record, "barcode", headerMap)),
    price: normalizeAmount(valueFor(record, "price", headerMap)),
    compareAtPrice: normalizeAmount(valueFor(record, "compareAtPrice", headerMap)),
    inventoryQuantity,
    inventoryQuantityRaw: quantityRaw,
    inventoryTracked: inventoryTrackedFor(valueFor(record, "inventoryTracker", headerMap), record, headerMap, issues),
    inventoryPolicy: inventoryPolicyFor(record, headerMap, issues),
    available: parseBoolean(valueFor(record, "available", headerMap), record, "available", headerMap, issues),
    imageSource: variantImage,
    optionValues: addOptions(accumulator, record, headerMap, issues),
    provenance: [provenanceFor(record, sourceName, product.sourceProductId ?? undefined, sourceVariantId ?? undefined)],
    raw: record.values,
  };
  if (variant.price.validity === "invalid") {
    issues.push({
      level: "warning",
      type: "malformed",
      code: "CSV_NUMBER_INVALID",
      message: `${headerFor("price", headerMap)} is not a valid numeric amount.`,
      rowNumber: record.rowNumber,
      field: headerFor("price", headerMap),
      rawValue: variant.price.raw,
    });
  }
  if (variant.compareAtPrice.validity === "invalid") {
    issues.push({
      level: "warning",
      type: "malformed",
      code: "CSV_NUMBER_INVALID",
      message: `${headerFor("compareAtPrice", headerMap)} is not a valid numeric amount.`,
      rowNumber: record.rowNumber,
      field: headerFor("compareAtPrice", headerMap),
      rawValue: variant.compareAtPrice.raw,
    });
  }
  product.variants.push(variant);
  if (variantImage) addImageRecord(accumulator, record, sourceName, variantImage, null, null, sourceVariantId);
}

export function importShopifyCsv(input: string, sourceName = "shopify-products.csv"): ImportResult {
  const parsed = parseCsv(input);
  const issues = [...parsed.issues];
  const catalog = emptyCatalog({
    kind: "csv",
    name: sourceName,
    format: "shopify-product-csv",
    adapterId: SHOPIFY_CSV_ADAPTER_ID,
    adapterVersion: SHOPIFY_CSV_ADAPTER_VERSION,
    rawSource: input,
  });
  const metadata = createImportMetadata(catalog);
  metadata.headers = parsed.headers;
  const headerMap = buildHeaderMap(parsed.headers, issues);

  const recognizedHeaders = new Set(Object.values(headerMap));
  metadata.extensionColumns = parsed.headers.filter((header) => !recognizedHeaders.has(header) && isExtensionHeader(header));
  metadata.ignoredColumns = parsed.headers.filter((header) => (
    !recognizedHeaders.has(header)
    && !metadata.extensionColumns.includes(header)
    && RECOGNIZED_IGNORED_HEADERS.has(normalizeHeader(header))
  ));
  const unsupportedColumns = parsed.headers.filter((header) => (
    !recognizedHeaders.has(header)
    && !metadata.extensionColumns.includes(header)
    && !metadata.ignoredColumns.includes(header)
  ));

  if (metadata.extensionColumns.length > 0) {
    issues.push({
      level: "info",
      type: "extension",
      code: "CSV_EXTENSION_COLUMNS_PRESERVED",
      message: `${metadata.extensionColumns.length} Shopify extension column${metadata.extensionColumns.length === 1 ? " was" : "s were"} preserved as raw provenance and not normalized.`,
      rowNumber: 1,
      rawValue: metadata.extensionColumns,
    });
  }
  if (unsupportedColumns.length > 0) {
    issues.push({
      level: "warning",
      type: "unsupported",
      code: "CSV_UNKNOWN_COLUMNS_PRESERVED",
      message: `${unsupportedColumns.length} unknown column${unsupportedColumns.length === 1 ? " was" : "s were"} preserved but not interpreted.`,
      rowNumber: 1,
      rawValue: unsupportedColumns,
    });
  }

  if (!headerMap.handle && !headerMap.title) {
    issues.push({
      level: "error",
      type: "unsupported",
      code: "CSV_PRODUCT_IDENTITY_HEADERS_MISSING",
      message: "Expected URL handle/Handle or Title in a Shopify product CSV.",
      rowNumber: 1,
    });
    return finalizeImportResult({ catalog, issues, metadata });
  }

  const products: ProductAccumulator[] = [];
  const productsBySourceId = new Map<string, ProductAccumulator>();
  const productsByHandle = new Map<string, ProductAccumulator[]>();
  let previousAccumulator: ProductAccumulator | null = null;

  for (const record of parsed.records) {
    const suppliedHandle = textOrNull(valueFor(record, "handle", headerMap));
    const title = textOrNull(valueFor(record, "title", headerMap));
    const sourceProductId = textOrNull(valueFor(record, "sourceProductId", headerMap));
    let handle: string | null = suppliedHandle;
    if (!handle && title) {
      handle = slugify(title) || `product-${record.rowNumber}`;
      issues.push({
        level: "info",
        type: "defaulted",
        code: "CSV_HANDLE_DERIVED",
        message: `No URL handle was supplied; ${handle} was derived from Title for local normalization.`,
        rowNumber: record.rowNumber,
        field: headerFor("handle", headerMap),
        rawValue: title,
      });
    }
    if (!handle && previousAccumulator) handle = previousAccumulator.product.handle;
    if (!handle) {
      issues.push({
        level: "error",
        type: "malformed",
        code: "CSV_ROW_PRODUCT_IDENTITY_MISSING",
        message: "Row was skipped because its product identity cannot be established safely.",
        rowNumber: record.rowNumber,
      });
      continue;
    }

    const handleKey: string = handle.toLocaleLowerCase();
    const handleMatches = productsByHandle.get(handleKey) ?? [];
    let accumulator = sourceProductId ? productsBySourceId.get(sourceProductId) : undefined;
    if (!accumulator && !sourceProductId) {
      const previous: ProductAccumulator | null = previousAccumulator;
      if (!title && previous && previous.product.handle.toLocaleLowerCase() === handleKey) accumulator = previous;
      else if (handleMatches.length === 1) accumulator = handleMatches[0];
      else if (handleMatches.length > 1 && previous && previous.product.handle.toLocaleLowerCase() === handleKey) {
        accumulator = previous;
        issues.push({
          level: "warning",
          type: "conflict",
          code: "CSV_PRODUCT_CONTINUATION_AMBIGUOUS",
          message: `Handle ${handle} identifies multiple products; the row was attached to the immediately preceding matching product because no Product ID was supplied.`,
          rowNumber: record.rowNumber,
          field: headerFor("handle", headerMap),
          rawValue: handle,
        });
      }
    }
    const imageOnly = (hasProductImage(record, headerMap) || hasVariantImage(record, headerMap)) && !hasVariantData(record, headerMap) && !title;
    if (!accumulator && imageOnly) {
      issues.push({
        level: "error",
        type: "malformed",
        code: "CSV_IMAGE_PRODUCT_UNKNOWN",
        message: `Image continuation row references unknown product ${handle}; the row was skipped.`,
        rowNumber: record.rowNumber,
        field: headerFor("handle", headerMap),
        rawValue: handle,
      });
      continue;
    }

    if (!accumulator) {
      if (sourceProductId && handleMatches.some((entry) => entry.product.sourceProductId !== sourceProductId)) {
        issues.push({
          level: "warning",
          type: "conflict",
          code: "CSV_PRODUCT_HANDLE_COLLISION",
          message: `Handle ${handle} is assigned to distinct source Product IDs; both product records were preserved for audit.`,
          rowNumber: record.rowNumber,
          field: headerFor("handle", headerMap),
          rawValue: { handle, sourceProductId },
        });
      }
      accumulator = createProduct(record, handle, sourceName, headerMap, issues);
      products.push(accumulator);
      productsByHandle.set(handleKey, [...handleMatches, accumulator]);
      if (sourceProductId) productsBySourceId.set(sourceProductId, accumulator);
    } else {
      if (suppliedHandle && suppliedHandle.toLocaleLowerCase() !== accumulator.product.handle.toLocaleLowerCase()) {
        issues.push({
          level: "warning",
          type: "conflict",
          code: "CSV_PRODUCT_HANDLE_CONFLICT",
          message: `Handle ${suppliedHandle} conflicts with ${accumulator.product.handle} for the same source Product ID; the first handle is retained.`,
          rowNumber: record.rowNumber,
          field: headerFor("handle", headerMap),
          rawValue: suppliedHandle,
        });
      }
      mergeProductFields(accumulator, record, sourceName, headerMap, issues);
    }
    previousAccumulator = accumulator;
    addVariant(accumulator, record, sourceName, headerMap, issues);
    addProductImage(accumulator, record, sourceName, headerMap, issues);
    addStandaloneVariantImage(accumulator, record, sourceName, headerMap);
  }

  catalog.products = products.map((accumulator) => {
    const options: CatalogOption[] = [...accumulator.optionSchema.entries()]
      .sort(([left], [right]) => left - right)
      .map(([position, name]) => ({
        name,
        position,
        values: [...(accumulator.optionValues.get(name) ?? [])],
      }));
    accumulator.product.options = options;
    return accumulator.product;
  });

  return finalizeImportResult({ catalog, issues, metadata });
}

export const shopifyCsvAdapter: CatalogSourceAdapter = {
  id: SHOPIFY_CSV_ADAPTER_ID,
  version: SHOPIFY_CSV_ADAPTER_VERSION,
  format: "shopify-product-csv",
  canHandle(sourceName, input) {
    if (sourceName.toLowerCase().endsWith(".csv")) return true;
    const firstLine = input.split(/\r?\n/, 1)[0] ?? "";
    return firstLine.split(",").some((header) => ALIAS_TO_FIELD.has(normalizeHeader(header)));
  },
  import(input, sourceName) {
    return importShopifyCsv(input, sourceName);
  },
};
