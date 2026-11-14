import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { runAudit } from "../src/audit";
import { loadFixture } from "../src/fixtures";
import { AuditSummary } from "../src/ui/AuditSummary";

describe("presentation smoke test", () => {
  it("renders normalized audit results into the merchant summary", () => {
    const catalog = loadFixture("messy").catalog;
    const audit = runAudit(catalog);
    const html = renderToStaticMarkup(<AuditSummary catalog={catalog} audit={audit} />);

    expect(html).toContain("Catalog scope");
    expect(html).toContain("4");
    expect(html).toContain(`${audit.findings.length}`);
    expect(html).toContain("16 rules executed");
    expect(html).toContain("Address first");
  });
});
