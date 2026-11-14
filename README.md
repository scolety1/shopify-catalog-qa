# Shopify Catalog QA

A browser-local tool for importing Shopify-style catalogs, explaining deterministic quality findings, and comparing a later import with a saved baseline. No store connection, credentials, uploads, or automatic store changes.

## Review in 60 seconds

**Decision:** a disappearing finding is not sufficient evidence that a catalog issue was fixed. Stable identity and explicit uncertainty prevent misleading before/after reports.

- Read [identity and comparison regressions](tests/identity-comparison.test.ts), then the [comparison implementation](src/audit/comparison.ts).
- Reproduce the checks with `npm test` and `npm run evaluate`: publication verification recorded 79 passing tests and 124 synthetic evaluation cases. See [CI runs](https://github.com/scolety1/shopify-catalog-qa/actions).
- Try the bundled Messy Store and Healthy Store catalogs. This demonstrates local QA, not a live Shopify integration or measured merchant impact.

## What works today

- CSV and versioned JSON import with field provenance and explicit diagnostics.
- Sixteen deterministic rules with applicability and abstention conditions.
- Local triage, portable JSON/HTML reports, and conservative cross-import comparison.
- Ambiguous identities and missing entities remain uncertain rather than becoming false “resolved” claims.

## Contribution and attribution

A project by [Spencer Colety](https://github.com/scolety1), developed with AI assistance. The local source history records `scolety1` as the project author. This is presented as AI-assisted project work, not a claim that every line was independently hand-written. [Provenance](PROVENANCE.md) identifies the source baseline and publication changes.

The engineering decisions to examine are the explicit data/evidence boundaries, deterministic domain logic, and testable treatment of uncertainty described below.

## Run it

Node.js 22.13+ (verified with Node 24.15).

```sh
npm ci
npm run dev
```

Choose **Messy Store**, inspect a finding, then try **Healthy Store**. The bundled catalogs are fictional. For comparison and report workflows, see [the guide](GUIDE.md).

```sh
npm test
npm run evaluate
npm run lint
npm run build
npm run preview
```

## Start reading here

1. [Identity model](src/audit/identity.ts) and [comparison](src/audit/comparison.ts): why changing a SKU is not changing a variant’s identity.
2. [CSV adapter](src/catalog/csvAdapter.ts): uncertain input stays explicit.
3. [Rules](src/audit/rules.ts) and [adversarial scenarios](evaluation/scenarios.ts).
4. [UI](src/ui/CatalogQaApp.tsx) and [workflow persistence](src/workflow/persistence.ts).

## Verification and limits

Verified November 14, 2026: 79 tests and all 124 synthetic evaluation scenarios passed; lint and fresh TypeScript/Vite build passed. Corpus precision/recall does not establish universal Shopify correctness.

There is no live Shopify API, remote image validation, multi-user backend, or universal export-format compatibility. Local workflow storage can be cleared by the browser. Shopify is a third-party trademark; this project is not affiliated with Shopify.
