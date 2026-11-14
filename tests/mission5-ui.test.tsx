// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { auditRules, compareAuditRuns, createAuditRun, runAudit } from "../src/audit";
import { importNativeJson } from "../src/catalog";
import { loadFixture } from "../src/fixtures";
import { ComparisonDashboard } from "../src/ui/CatalogQaApp";
import { RuleCoverage } from "../src/ui/RuleCoverage";

afterEach(cleanup);

function readDeclarations(styles: string, selector: string): Map<string, string> {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = styles.match(new RegExp(`${escapedSelector}\\s*{([^}]*)}`, "s"));
  expect(block, `Expected CSS block for ${selector}`).not.toBeNull();

  return new Map(
    (block?.[1] ?? "")
      .split(";")
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const separator = declaration.indexOf(":");
        return [declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()];
      }),
  );
}

describe("responsive comparison layout", () => {
  it("allows comparison rows and long identifiers to shrink inside the scroll container", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const list = readDeclarations(styles, ".comparison-list");
    const row = readDeclarations(styles, ".comparison-row");
    const rowChildren = readDeclarations(styles, ".comparison-row > *");

    expect(list.get("min-width")).toBe("0");
    expect(list.get("overflow")).toBe("auto");
    expect(row.get("min-width")).toBe("0");
    expect(row.get("width")).toBe("100%");
    expect(rowChildren.get("min-width")).toBe("0");
    expect(rowChildren.get("overflow-wrap")).toBe("anywhere");
  });
});

describe("operator-facing rule coverage", () => {
  it("shows every registry rule, applicability boundaries, finding counts, and skipped reasons", () => {
    const audit = runAudit(loadFixture("messy").catalog);
    const skippedRule = auditRules[0];
    const { container } = render(<RuleCoverage audit={{
      ...audit,
      rulesExecuted: audit.rulesExecuted.filter((id) => id !== skippedRule.id),
      rulesSkipped: [
        { id: skippedRule.id, reason: "Required source capability was unavailable." },
        { id: "FUTURE_RULE", reason: "This adapter does not expose the future field." },
      ],
    }} />);

    const coverage = screen.getByRole("region", { name: "Rule coverage" });
    expect(container.querySelectorAll(".rule-coverage-row")).toHaveLength(16);
    expect(coverage.textContent).toContain("not proof that the rule applied to every entity");
    expect(coverage.textContent).toContain("Applies when");
    expect(coverage.textContent).toContain("Abstains when");
    expect(coverage.textContent).toContain("Required source capability was unavailable.");
    expect(coverage.textContent).toContain("FUTURE_RULE");
    expect(coverage.textContent).toContain("This adapter does not expose the future field.");
    expect(screen.getAllByLabelText(/findings this run/)).toHaveLength(16);
  });
});

describe("operator uncertainty review", () => {
  it("filters into a prominent uncertainty queue without relabeling ambiguous items", async () => {
    const baselineImport = loadFixture("messy");
    const currentImport = importNativeJson(
      { schemaVersion: "catalog-qa.catalog.v1", products: [] },
      "empty-current.json",
    );
    const baseline = createAuditRun(baselineImport, runAudit(baselineImport.catalog), [], "2026-08-12T00:00:00.000Z");
    const current = createAuditRun(currentImport, runAudit(currentImport.catalog), [], "2026-08-13T00:00:00.000Z");
    const comparison = compareAuditRuns(baseline, current, "2026-08-13T01:00:00.000Z");
    const user = userEvent.setup();
    render(<ComparisonDashboard comparison={comparison} selected={null} onSelect={() => undefined} />);

    const dashboard = screen.getByRole("region", { name: "Audit comparison" });
    const queue = within(dashboard).getByRole("button", { name: /Show Cannot confidently match queue/ });
    expect(queue.textContent).toContain(String(comparison.summary.uncertain));
    await user.click(queue);

    const results = within(dashboard).getByLabelText("Comparison results");
    const rows = within(results).getAllByRole("button");
    expect(rows).toHaveLength(comparison.summary.uncertain);
    expect(rows.every((row) => row.textContent?.includes("Cannot confidently match"))).toBe(true);
    expect(rows.some((row) => /Verified resolved|^New/.test(row.textContent ?? ""))).toBe(false);

    const detail = within(dashboard).getByRole("complementary", { name: "Comparison detail" });
    expect(detail.textContent).toContain("Why matching is uncertain");
    expect(detail.textContent).toContain("Match method");
    expect(detail.textContent).toContain("Confidence");
    expect(detail.textContent).toContain("Baseline evidence");
    expect(detail.textContent).toContain("Current evidence");
    expect(detail.textContent).toContain("absence alone is not treated as resolution");
  });

  it("keeps detail selection inside the active keyboard-operable status filter", async () => {
    const baselineImport = loadFixture("messy");
    const currentImport = loadFixture("improved");
    const comparison = compareAuditRuns(
      createAuditRun(baselineImport, runAudit(baselineImport.catalog), [], "2026-08-12T00:00:00.000Z"),
      createAuditRun(currentImport, runAudit(currentImport.catalog), [], "2026-08-13T00:00:00.000Z"),
    );
    const user = userEvent.setup();
    const selected = comparison.items.find((item) => item.status === "verified-resolved") ?? null;
    render(<ComparisonDashboard comparison={comparison} selected={selected} onSelect={() => undefined} />);

    await user.click(screen.getByRole("button", { name: /Show Still present results/ }));
    const results = screen.getByLabelText("Comparison results");
    expect(within(results).getAllByRole("button")).toHaveLength(comparison.summary.stillPresent);
    expect(screen.getByRole("complementary", { name: "Comparison detail" }).textContent).toContain("Still present");
    expect(within(results).getAllByRole("button")[0].getAttribute("aria-pressed")).toBe("true");
  });
});
