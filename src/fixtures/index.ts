import edgeCaseStore from "../../fixtures/edge-case-store.json";
import healthyStore from "../../fixtures/healthy-store.json";
import improvedStore from "../../fixtures/improved-store.json";
import messyStore from "../../fixtures/messy-store.json";
import regressionStore from "../../fixtures/regression-store.json";
import { importNativeJson, type ImportResult } from "../catalog";

export type FixtureId = "healthy" | "messy" | "improved" | "regression" | "edge";

export interface CatalogFixture {
  id: FixtureId;
  name: string;
  description: string;
  load: () => ImportResult;
}

export const catalogFixtures: CatalogFixture[] = [
  {
    id: "healthy",
    name: "Healthy Store",
    description: "Clean, operationally complete products and variants.",
    load: () => importNativeJson(healthyStore, "healthy-store.json", "fixture"),
  },
  {
    id: "messy",
    name: "Messy Baseline",
    description: "The original hostile catalog, now yielding 15 findings after Mission 4 false-positive corrections.",
    load: () => importNativeJson(messyStore, "messy-store.json", "fixture"),
  },
  {
    id: "improved",
    name: "Improved Catalog",
    description: "A plausible external cleanup that intentionally leaves several defects.",
    load: () => importNativeJson(improvedStore, "improved-store.json", "fixture"),
  },
  {
    id: "regression",
    name: "Regression Catalog",
    description: "The cleanup plus three newly introduced deterministic defects.",
    load: () => importNativeJson(regressionStore, "regression-store.json", "fixture"),
  },
  {
    id: "edge",
    name: "Edge Cases",
    description: "Unusual but legal-looking data designed to resist false positives.",
    load: () => importNativeJson(edgeCaseStore, "edge-case-store.json", "fixture"),
  },
];

export function loadFixture(id: FixtureId): ImportResult {
  return catalogFixtures.find((fixture) => fixture.id === id)?.load() ?? catalogFixtures[0].load();
}
