import { importShopifyCsv, shopifyCsvAdapter } from "./csvAdapter";
import { importNativeJson, nativeJsonAdapter } from "./jsonAdapter";
import {
  createImportMetadata,
  emptyCatalog,
  finalizeImportResult,
  type ImportResult,
  type SourceFormat,
} from "./model";

export interface CatalogSourceAdapter {
  id: string;
  version: number;
  format: SourceFormat;
  canHandle: (sourceName: string, input: string) => boolean;
  import: (input: string, sourceName: string) => ImportResult;
}

export const sourceAdapters: CatalogSourceAdapter[] = [shopifyCsvAdapter, nativeJsonAdapter];

export function importCatalogFile(input: string, sourceName: string): ImportResult {
  const adapter = sourceAdapters.find((candidate) => candidate.canHandle(sourceName, input));
  if (adapter?.id === shopifyCsvAdapter.id) return importShopifyCsv(input, sourceName);
  if (adapter?.id === nativeJsonAdapter.id) return importNativeJson(input, sourceName);

  const catalog = emptyCatalog({
    kind: "unknown",
    name: sourceName,
    format: "unknown",
    adapterId: "unsupported-source",
    adapterVersion: 1,
    rawSource: input,
  });
  return finalizeImportResult({
    catalog,
    metadata: createImportMetadata(catalog),
    issues: [{
      level: "error",
      type: "unsupported",
      code: "FILE_TYPE_UNSUPPORTED",
      message: "Choose a supported Shopify product CSV or catalog-qa JSON v1 file.",
    }],
  });
}