# Adversarial catalog evaluation

Mission 4 adds a deterministic benchmark that is separate from the ordinary unit-test suite. Run it locally with:

```bash
npm run evaluate
```

The command evaluates every reviewed scenario, prints finding and per-rule metrics, writes `evaluation/adversarial-final.json`, and exits non-zero unless every hard gate passes.

`adversarial-baseline.json` preserves historical Mission 3 evidence. Reproducing that baseline requires the original Mission 3 engine, which is not included in this snapshot. The evaluator always runs the current engine; `--label` only labels its output and does not select a historical implementation. Do not overwrite the historical baseline with a relabeled current run.

## Corpus and ground truth

- Schema: `adversarial-manifest.v1.schema.json`
- Typed manifest: `scenarios.ts`
- Evaluator: `runner.ts`
- Machine baseline: `adversarial-baseline.json`
- Machine final result: `adversarial-final.json`

The manifest contains 124 distinct scenarios across 8 families: SKU, options, pricing, inventory, media, status, product integrity, and CSV reconstruction. Sources include native Catalog QA JSON and Shopify-style CSV. Each scenario names its rationale, tags, expected findings, affected entities, severity, explicitly forbidden rules where useful, required/forbidden importer diagnostics, normalization facts, and policy decisions.

Finding comparison uses rule, logical source entity, and severity. It does not compare prose messages. Duplicate expectations are evaluated as multisets, so two affected records require two findings rather than collapsing into one key.

## Metrics

- **True positive:** emitted finding matches an expected rule, entity, and severity.
- **False positive:** emitted finding is absent from reviewed ground truth.
- **False negative:** expected finding was not emitted.
- **Precision:** TP / (TP + FP).
- **Recall:** TP / (TP + FN).
- **Exact scenario:** findings, required diagnostics, forbidden diagnostics, and normalization facts all match.

Importer diagnostics and normalization failures are reported separately from audit findings. They never improve or reduce finding precision/recall.

## Mission 3 baseline versus Mission 4 final

| Metric | Mission 3 engine | Mission 4 engine |
|---|---:|---:|
| Exact scenarios | 99 / 124 (79.84%) | 124 / 124 (100%) |
| Expected findings | 58 | 58 |
| Actual findings | 70 | 58 |
| True positives | 45 | 58 |
| False positives | 25 | 0 |
| False negatives | 13 | 0 |
| Precision | 64.29% | 100% |
| Recall | 77.59% | 100% |
| Importer diagnostic failures | 19 | 0 |
| Normalization failures | 5 | 0 |

These percentages describe this reviewed corpus only. They are not a claim of universal Shopify correctness.

## Root-cause analysis

Every frozen-baseline failure was classified before hardening:

1. **Rule applicability was too broad.** Draft, archived, and unknown-status products received SKU, media, or inventory findings whose operational premise applies only to active products. Variant-only media was ignored. This created false positives.
2. **Option normalization was too aggressive.** Lowercasing merchant option values merged case-distinct values. Mission 4 trims outer whitespace but does not fold case or Unicode.
3. **CSV variant reconstruction was too permissive.** Inventory-only continuation rows became phantom variants, which cascaded into price, SKU, option, and inventory false positives.
4. **Unknown inventory state was converted into certainty.** Any unfamiliar non-empty tracker value became `tracked=true`. The adapter now recognizes an explicit allowlist and otherwise preserves unknown with a diagnostic.
5. **CSV product identity used handle alone.** Distinct source Product IDs with the same handle were silently merged. The v3 adapter preserves both records, emits a collision diagnostic, and lets the duplicate-handle rule report the factual ambiguity.
6. **Title-bearing blank-handle rows inherited the preceding handle.** They now start a separately derived product; anonymous continuation rows still attach conservatively.
7. **Option position gaps lacked diagnostics.** Option2/Option3 gaps are now diagnosed without reordering values.
8. **Variant-image-only continuation rows were discarded.** They now contribute local media evidence without manufacturing a variant.
9. **Five objective defects had no rule.** Duplicate handle, duplicate source product ID, duplicate source variant ID, active product without variants, and an active declared option with no values accounted for all 13 finding false negatives.

No fixture-specific checks were added. All fixes operate on general normalized facts or explicit source contracts.

## Deterministic rule policy

Each rule registry entry now declares its scope, the evidence required for applicability, and when it abstains. Unknown data is not treated as a failed check. Findings contain:

1. a source-supported detected fact;
2. evidence and provenance;
3. a separate rationale;
4. a separate suggested remediation.

Messages do not claim revenue loss, remote image failure, weak merchandising, poor style, or other effects the imported catalog cannot prove.

SKU equality is trimmed, exact, case-sensitive, and does not Unicode-fold. Product handle equality is trimmed and case-insensitive. Option values trim transport whitespace but preserve case and Unicode distinctions. Numeric fields use the supported dot-decimal source contract and are not locale-guessed.

## Severity rubric

- **High:** supported evidence shows a catalog identity, purchasability, variant matrix, price, inventory, or active-listing failure likely to break catalog operations or a customer-facing listing.
- **Medium:** supported evidence shows an important operational or accessibility-quality gap that is generally not destructive by itself.
- **Low:** informational or low-urgency evidence. Mission 4 removed inactive-product media findings rather than using Low to make a non-applicable rule look harmless.

Existing severities did not change. Applicability changed for inactive/unknown lifecycle states, and all five new structural rules are High because their evidence represents unambiguous identity or purchasability failure.

## Hard gates

The benchmark requires:

- zero false positives;
- zero false negatives, which includes all High expected findings;
- every scenario exact;
- zero required/forbidden diagnostic mismatches;
- zero normalization fact mismatches.

Healthy and Edge fixtures staying clean, the documented Messy delta, report compatibility, and Mission 3 comparison/workflow behavior are enforced by the normal regression suite.

## Known blind spots and deferred checks

- Remote image accessibility is not checked offline. URL syntax is not evidence that an asset is broken.
- Multi-location inventory and arbitrary location CSVs are not normalized. Unknown inventory state causes abstention.
- SEO title and description fields are not canonical normalized fields in the current model, so length rules are deferred. Generic keyword, quality, or conversion advice remains out of scope.
- Duplicate barcode is deferred because legitimate reuse policies require a stronger applicability contract than the current model provides.
- Published flags and lifecycle status are both preserved, but cross-field storefront-state inference remains deliberately conservative.
- A handle-only CSV cannot always distinguish a new product from a continuation when stable Product IDs are absent. Ambiguity is diagnosed rather than guessed.
- Arbitrary Shopify app columns and localized/historical exports are preserved as raw evidence where supported but are not universally interpreted.
- No network checks, live Shopify validation, heuristic merchandising advice, health score, or automatic repair is performed.
