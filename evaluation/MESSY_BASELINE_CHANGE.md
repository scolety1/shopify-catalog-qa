# Messy fixture: Mission 3 to Mission 4

The frozen Mission 3 output is `fixtures/mission3-messy-expected-v1.json` at commit `cbf31de53334fb2cdf99c53135b5dd5b57a2375b`.

Mission 3 emitted 17 findings. Mission 4 emits 15. The net change is exactly two findings:

- Removed two `VARIANT_OPTION_DUPLICATE` findings for variants `2101` and `2102`. Their values differ by case. Case folding was an over-aggressive normalization policy that could merge legitimate merchant values.
- Added one `VARIANT_OPTION_SCHEMA_MISMATCH` finding for variant `2102`. Its case-distinct values do not exactly match the product's declared canonical values, which is the supported factual statement.
- Removed one Low `MEDIA_PRODUCT_NO_IMAGE` finding for draft product `2003`. The active-listing premise is not applicable to a draft product, so the engine now abstains.

No severity-only changes occurred. The remaining 14 Mission 3 findings are unchanged. The current regression test compares the frozen and current key multisets so this explanation cannot drift silently.
