# Shopify Catalog QA

A focused, local merchant tool for importing Shopify-style product catalogs, triaging deterministic findings, planning external remediation, and verifying a later re-import. It never connects to Shopify or changes a store.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
npm test
npm run evaluate
npm run typecheck
npm run lint
npm run build
npm run preview
```

The app is a conventional React + TypeScript + Vite SPA. Parsing, normalization, auditing, workflow persistence, comparison, and report generation all run in the browser.

## Audit lifecycle

1. Import or select a catalog and review its import diagnostics separately from its deterministic QA findings.
2. Inspect a finding's evidence, provenance, and recommended remediation.
3. Set it to **Acknowledged**, **Remediation planned**, or **Accepted exception**, with an optional plain-text merchant note.
4. Export the audit as the explicit baseline.
5. Perform any planned catalog change outside SHOPIFY CATALOG QA.
6. Import a later catalog snapshot and explicitly load the saved baseline report.
7. Review verified resolved, still present, changed, new, and uncertain results.
8. Export the comparison as JSON or standalone HTML.

**Remediation planned** means the merchant intends to make the recommended change elsewhere. It does not mean this app performed or completed a fix. **Resolved is not a manual workflow state**: only a subsequent, sufficiently confident comparison can say **Verified resolved**.

## Identity and comparison model

The architecture keeps six identities deliberately separate:

- **Source fingerprint** — exact imported source content.
- **Logical entity identity** — a product, variant, or image across reasonably comparable exports.
- **Logical finding key** — the rule plus logical entity and only the minimum rule-specific discriminator.
- **Audit finding instance** — one observation during one timestamped audit run.
- **Workflow record** — merchant triage, note, and external-action intent.
- **Comparison result** — the deterministic relationship between baseline and current instances.

Product matching prefers stable source product IDs and otherwise uses normalized handles. Variant matching prefers stable source variant IDs and otherwise uses product identity plus normalized option combination. SKU is not the sole variant identity because changing a SKU can itself be the remediation. Image findings use product identity plus media source URL.

Option fallback identity trims transport whitespace but preserves merchant-authored case and Unicode distinctions. Product handles remain case-insensitive routing identifiers.

Match confidence is explicit:

- **Exact** — stable source entity ID.
- **Strong** — conservative logical fallback such as handle or product-plus-options.
- **Ambiguous** — more than one entity/finding shares the identity.
- **Unmatched** — no stable or safe logical identity.

A baseline finding is **Verified resolved** only when its entity still matches uniquely with exact or strong confidence and the rule no longer emits that finding. Entity deletion is reported as **Cannot confidently match**, not silently treated as resolution.

Comparison classifications are:

- **Still present** — same logical finding and materially unchanged evidence.
- **Verified resolved** — matched entity remains and the prior rule no longer emits.
- **New** — a safely identifiable current finding was absent from baseline.
- **Changed evidence** — the same logical problem remains but severity, evidence, or details materially changed.
- **Cannot confidently match** — ambiguous, unstable, deleted, or otherwise unsafe continuity.

The dashboard reports objective counts, including high-severity resolved, remaining, and newly introduced findings. It does not invent a health score.

## Merchant workflow and local persistence

Supported manual states are **Open**, **Acknowledged**, **Remediation planned**, and **Accepted exception**. Notes are optional, capped at 500 characters, stored and rendered as plain text, and escaped in reports.

Only the workspace key, logical finding key, workflow status, note, recommendation snapshot, and timestamps are stored in `localStorage`. Imported raw catalog files are not persisted. **Clear local workflow data** removes these records. There is no account, telemetry, or remote persistence.

The workspace fallback uses the adapter plus the first stable product ID (or handle). This is intentionally lightweight: catalogs without a durable store identifier may not carry workflow state across extensive identity changes. Portable baseline reports remain the authoritative cross-snapshot workflow handoff.

## Baseline reports

New JSON exports use `catalog-qa.audit-report.v2` and embed:

- a complete `catalog-qa.audit-run.v1`;
- source/adapter/version/fingerprint metadata;
- normalized catalog and diagnostic summaries;
- rules executed/skipped;
- each rule's explicit scope, applicability evidence, and abstention condition;
- logical finding and per-run instance identities;
- evidence, provenance, and remediation;
- workflow records;
- optional `catalog-qa.audit-comparison.v1` output with baseline/current metadata, counts, matched pairs, confidence, method, explanation, and workflow context.

Mission 2 `catalog-qa.audit-report.v1` files remain importable as explicit baselines and are upgraded conservatively. Malformed or unsupported versions produce visible diagnostics. HTML exports remain self-contained with inline styles, CSP, no scripts, no CDN, and no external network dependency.

## Supported catalog inputs

### Shopify product CSV

Adapter: `shopify-product-csv` v3.

The documented compatibility envelope covers UTF-8 CSVs, multiline quoted fields, LF/CRLF, repeated-handle variant rows, image continuation rows, up to three options, active/draft/archived status, product/variant media, supported single-location inventory fields, legacy header aliases, and preserved Markets/metafield extension columns. Distinct source Product IDs are preserved even when their handles collide; ambiguous partial variant rows are diagnosed rather than manufactured; and unknown inventory trackers remain unknown. See Shopify's [official product CSV reference](https://help.shopify.com/en/manual/products/import-export/using-csv).

This is not a universal compatibility claim. Localized headers, every historical template, inventory-location CSVs, category-linked option semantics, market conversion, and arbitrary app columns are not all interpreted as normalized facts.

### Native Catalog QA JSON

Adapter: `catalog-qa-json-v1` v1. Required schema: `catalog-qa.catalog.v1`.

The published contract is [`schemas/catalog-qa.catalog.v1.schema.json`](schemas/catalog-qa.catalog.v1.schema.json). Unknown versions are rejected. Invalid documents return JSON-path diagnostics while safely normalizable entities may still be retained.

## Deterministic rule policy

Import diagnostics describe source uncertainty: parse errors, schema violations, malformed values, conflicting fields, unsupported headers, and extensions. Findings are deterministic facts emitted after normalization. Unknown data is not guessed into a finding.

Every rule declares when it applies and when it abstains. Detected facts, rationale, and recommended remediation remain separate. The app does not claim that a finding caused lost revenue or that an unverified remote image is broken.

Severity means:

- **High** — supported evidence shows an identity, purchasability, variant, price, inventory, or active-listing failure likely to disrupt catalog operations or a customer-facing listing.
- **Medium** — an important operational or accessibility-quality gap that is generally not destructive by itself.
- **Low** — supported low-urgency information. A non-applicable rule abstains instead of emitting a reassuring-looking Low finding.

The 16 supported rules are:

`PRODUCT_HANDLE_DUPLICATE`, `PRODUCT_ID_DUPLICATE`, `VARIANT_ID_DUPLICATE`, `PRODUCT_NO_VARIANTS`, `PRODUCT_OPTION_VALUES_MISSING`, `SKU_DUPLICATE`, `SKU_MISSING`, `MEDIA_PRODUCT_NO_IMAGE`, `MEDIA_ALT_MISSING`, `VARIANT_OPTION_DUPLICATE`, `VARIANT_OPTION_INCOMPLETE`, `VARIANT_OPTION_SCHEMA_MISMATCH`, `PRICE_INVALID`, `PRICE_NEGATIVE`, `PRICE_COMPARE_AT_BELOW_PRICE`, and `INVENTORY_AVAILABILITY_CONFLICT`.

SKU equality is trimmed, exact, case-sensitive, and not Unicode-folded. Product handles are trimmed and case-insensitive. Option values trim outer whitespace but preserve case and Unicode. Status-dependent SKU, media, and inventory rules abstain for draft, archived, or unknown lifecycle state.

## Adversarial benchmark

Mission 4 adds a versioned 124-scenario corpus across 8 families, a ground-truth schema, finding-level and per-rule metrics, importer/normalization checks, and hard regression gates. `npm run evaluate` writes `evaluation/adversarial-final.json` and fails if any false positive, false negative, scenario mismatch, diagnostic mismatch, or normalization mismatch appears.

The frozen Mission 3 engine scored 99/124 exact scenarios, 45 TP, 25 FP, 13 FN, 64.29% precision, and 77.59% recall. The Mission 4 engine scores 124/124, 58 TP, 0 FP, 0 FN, 100% precision, and 100% recall on this corpus. These are corpus results, not a universal Shopify-correctness claim. See [`evaluation/README.md`](evaluation/README.md) for the framework, root causes, policies, and blind spots.

## Verification fixtures

- `messy-store.json` — 15 findings after two false-positive corrections and one more precise schema-mismatch finding. The exact 17-to-15 delta is documented in [`evaluation/MESSY_BASELINE_CHANGE.md`](evaluation/MESSY_BASELINE_CHANGE.md).
- `improved-store.json` — plausible external cleanup: 3 findings; comparison yields 12 verified resolved, 1 still present, 2 changed, 0 new, and 0 uncertain.
- `regression-store.json` — cleanup plus regressions: 6 findings; comparison yields 12 verified resolved, 1 still present, 2 changed, 3 new, and 0 uncertain.
- `mission2-audit-report-v1.json` — frozen Mission 2 backward-compatibility report.
- `mission3-messy-expected-v1.json` — frozen Mission 3 17-finding key set for semantic-delta review.
- Existing native, current/legacy Shopify CSV, extension, malformed, and Unicode fixtures continue to cover ingestion behavior.

## Source layout

- `src/catalog/` — adapters, normalization, provenance, diagnostics, source metadata.
- `src/audit/` — rule engine, logical identity, audit runs, and pure comparison engine.
- `src/workflow/` — workflow contracts and browser-local persistence.
- `src/reports/` — v1 compatibility, v2 portable reports, standalone HTML, downloads.
- `src/ui/` — import, triage, baseline selection, comparison, filtering, and details.
- `evaluation/` — versioned adversarial manifest/schema, evaluator, machine results, metrics, and documented root causes.
- `schemas/`, `fixtures/`, `tests/` — contracts and deterministic verification data.

## Privacy and read-only guarantees

**SHOPIFY CATALOG QA is read-only and has not changed your store.**

No imported catalog or workflow information leaves the browser. There are no Shopify runtime requests, credentials, OAuth, Admin API calls, analytics, telemetry, remote report generation, automatic fixes, CSV rewriting, server endpoints, or production writes. Reports are local downloads. Any planned remediation must be performed externally and verified by re-import.

## Known limitations

- Strong fallback matching is conservative but cannot replace durable Shopify IDs.
- Title similarity alone is never used to match products.
- An entity that disappears is uncertain; the app cannot infer whether it was intentionally deleted or accidentally omitted.
- Changing a handle when no stable product ID exists can break continuity.
- Changing an option combination when no stable variant ID exists can break variant continuity.
- Mission 2 reports lack a full unaffected-entity snapshot; they are upgraded conservatively.
- Workflow persistence is device/browser-local and can be cleared by browser storage controls.
- Remote image accessibility is not verified; URL appearance is not treated as proof of failure.
- Multi-location inventory, arbitrary localized exports, and unknown tracker semantics are not guessed.
- SEO title/description length rules are deferred because those fields are not canonical normalized inputs; subjective keyword, copy-quality, and conversion advice remains out of scope.
- Duplicate barcode is deferred because legitimate exceptions require a stronger applicability contract.
- No arbitrary health score, live Shopify integration, or automated repair is provided.
