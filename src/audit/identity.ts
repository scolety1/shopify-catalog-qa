import type { Catalog, CatalogImage, CatalogProduct, CatalogVariant } from "../catalog";
import type { AffectedEntityType } from "./types";

export type EntityMatchBasis =
  | "stable-source-id"
  | "product-handle"
  | "product-options"
  | "media-source"
  | "catalog"
  | "unstable-local-id";

export type IdentityConfidence = "exact" | "strong" | "unmatched";

export interface LogicalEntityIdentity {
  key: string;
  type: AffectedEntityType;
  basis: EntityMatchBasis;
  confidence: IdentityConfidence;
  productKey?: string;
  sourceId?: string;
  handle?: string;
  optionSignature?: string;
  mediaSource?: string;
}

function normalizeInsensitive(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase();
}

function encodeExact(value: string): string {
  return encodeURIComponent(value.trim());
}

function encodeInsensitive(value: string): string {
  return encodeURIComponent(normalizeInsensitive(value));
}

export function productIdentity(product: CatalogProduct): LogicalEntityIdentity {
  if (product.sourceProductId?.trim()) {
    return {
      key: `product:source:${encodeInsensitive(product.sourceProductId)}`,
      type: "product",
      basis: "stable-source-id",
      confidence: "exact",
      sourceId: product.sourceProductId,
      handle: product.handle,
    };
  }
  if (product.handle.trim()) {
    return {
      key: `product:handle:${encodeInsensitive(product.handle)}`,
      type: "product",
      basis: "product-handle",
      confidence: "strong",
      handle: product.handle,
    };
  }
  return {
    key: `product:local:${encodeInsensitive(product.id)}`,
    type: "product",
    basis: "unstable-local-id",
    confidence: "unmatched",
  };
}

export function optionSignature(variant: CatalogVariant): string {
  return Object.entries(variant.optionValues)
    .map(([name, value]) => [name.trim(), (value ?? "").trim()] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join("|");
}

export function variantIdentity(product: CatalogProduct, variant: CatalogVariant): LogicalEntityIdentity {
  const parent = productIdentity(product);
  if (variant.sourceVariantId?.trim()) {
    return {
      key: `variant:source:${encodeInsensitive(variant.sourceVariantId)}`,
      type: "variant",
      basis: "stable-source-id",
      confidence: "exact",
      sourceId: variant.sourceVariantId,
      productKey: parent.key,
      optionSignature: optionSignature(variant),
    };
  }
  const signature = optionSignature(variant);
  if (parent.confidence !== "unmatched" && signature) {
    return {
      key: `variant:product:${encodeExact(parent.key)}:options:${encodeExact(signature)}`,
      type: "variant",
      basis: "product-options",
      confidence: "strong",
      productKey: parent.key,
      optionSignature: signature,
    };
  }
  return {
    key: `variant:local:${encodeInsensitive(variant.id)}`,
    type: "variant",
    basis: "unstable-local-id",
    confidence: "unmatched",
    productKey: parent.key,
  };
}

export function imageIdentity(product: CatalogProduct, image: CatalogImage): LogicalEntityIdentity {
  const parent = productIdentity(product);
  if (parent.confidence !== "unmatched" && image.source.trim()) {
    return {
      key: `image:product:${encodeInsensitive(parent.key)}:source:${encodeInsensitive(image.source)}`,
      type: "image",
      basis: "media-source",
      confidence: "strong",
      productKey: parent.key,
      mediaSource: image.source,
    };
  }
  return {
    key: `image:local:${encodeInsensitive(image.id)}`,
    type: "image",
    basis: "unstable-local-id",
    confidence: "unmatched",
    productKey: parent.key,
  };
}

export function catalogIdentity(catalog: Catalog): LogicalEntityIdentity {
  return {
    key: `catalog:${encodeInsensitive(catalog.id)}`,
    type: "catalog",
    basis: "catalog",
    confidence: "strong",
  };
}

export function findEntityIdentity(
  catalog: Catalog,
  type: AffectedEntityType,
  entityId: string,
  product?: CatalogProduct,
): LogicalEntityIdentity {
  if (type === "catalog") return catalogIdentity(catalog);
  const owner = product ?? catalog.products.find((candidate) =>
    candidate.id === entityId
    || candidate.variants.some((variant) => variant.id === entityId)
    || candidate.images.some((image) => image.id === entityId));
  if (!owner) {
    return {
      key: `${type}:local:${encodeInsensitive(entityId)}`,
      type,
      basis: "unstable-local-id",
      confidence: "unmatched",
    };
  }
  if (type === "product") return productIdentity(owner);
  if (type === "variant") {
    const variant = owner.variants.find((candidate) => candidate.id === entityId);
    return variant ? variantIdentity(owner, variant) : {
      key: `variant:local:${encodeInsensitive(entityId)}`,
      type,
      basis: "unstable-local-id",
      confidence: "unmatched",
      productKey: productIdentity(owner).key,
    };
  }
  const image = owner.images.find((candidate) => candidate.id === entityId);
  return image ? imageIdentity(owner, image) : {
    key: `image:local:${encodeInsensitive(entityId)}`,
    type,
    basis: "unstable-local-id",
    confidence: "unmatched",
    productKey: productIdentity(owner).key,
  };
}

export function logicalFindingKey(
  ruleId: string,
  entity: LogicalEntityIdentity,
  discriminator?: string,
): string {
  const suffix = discriminator?.trim() ? `:${encodeInsensitive(discriminator)}` : "";
  return `${ruleId}:${entity.key}${suffix}`;
}
