// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuditRun, runAudit } from "../src/audit";
import { loadFixture } from "../src/fixtures";
import { buildPortableAuditReport, type DownloadHandler } from "../src/reports";
import { CatalogQaApp } from "../src/ui/CatalogQaApp";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function reportFile(content: string, name = "baseline-report.json"): File {
  const file = new File([content], name, { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => content });
  return file;
}

describe("re-audit verification workflow", () => {
  it("plans remediation, persists locally, exports a baseline, and verifies the improved catalog", async () => {
    const downloads = vi.fn<DownloadHandler>();
    const user = userEvent.setup();
    const first = render(<CatalogQaApp downloadHandler={downloads} />);

    expect(screen.getByRole("region", { name: "Audit summary" }).textContent).toContain("15");
    await user.clear(screen.getByLabelText(/Merchant note/));
    await user.type(screen.getByLabelText(/Merchant note/), "Fix in next catalog update");
    await user.click(screen.getByRole("button", { name: "Plan remediation" }));
    expect(screen.getByRole("complementary", { name: "Finding detail" }).textContent).toContain("Remediation planned");

    first.unmount();
    const second = render(<CatalogQaApp downloadHandler={downloads} />);
    expect(screen.getByRole("complementary", { name: "Finding detail" }).textContent).toContain("Remediation planned");
    expect((screen.getByLabelText(/Merchant note/) as HTMLTextAreaElement).value).toBe("Fix in next catalog update");

    await user.click(screen.getByRole("button", { name: "Download JSON" }));
    const baselinePayload = downloads.mock.calls[0][0];
    const baselineJson = JSON.parse(baselinePayload.content);
    expect(baselineJson.workflow).toEqual([
      expect.objectContaining({ status: "planned", note: "Fix in next catalog update" }),
    ]);

    await user.click(screen.getByRole("button", { name: /Improved Catalog/ }));
    expect(screen.getByRole("region", { name: "Audit summary" }).textContent).toContain("3");

    const baselineInput = second.container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1];
    await user.upload(baselineInput, reportFile(baselinePayload.content));

    const comparison = await screen.findByRole("region", { name: "Audit comparison" });
    expect(comparison.textContent).toContain("12");
    expect(comparison.textContent).toContain("Verified resolved");
    expect(comparison.textContent).toContain("Still present");
    expect(comparison.textContent).toContain("Changed");
    expect(comparison.textContent).toContain("New");

    const resolved = within(comparison).getAllByRole("button", { name: /Verified resolved/ })[0];
    await user.click(resolved);
    expect(screen.getByRole("complementary", { name: "Comparison detail" }).textContent)
      .toContain("no longer emits this finding");

    const present = within(comparison).getAllByRole("button", { name: /Still present/ })[0];
    await user.click(present);
    expect(screen.getByRole("complementary", { name: "Comparison detail" }).textContent)
      .toContain("matched by");

    await user.click(screen.getByRole("button", { name: "Download JSON" }));
    await user.click(screen.getByRole("button", { name: "Download HTML" }));
    await waitFor(() => expect(downloads).toHaveBeenCalledTimes(3));
    expect(JSON.parse(downloads.mock.calls[1][0].content).comparison.summary.verifiedResolved).toBe(12);
    expect(downloads.mock.calls[2][0].content).toContain("Before / after verification");
  });

  it("shows newly introduced issues on the regression path and handles malformed baselines", async () => {
    const baselineImport = loadFixture("messy");
    const baselineRun = createAuditRun(
      baselineImport,
      runAudit(baselineImport.catalog),
      [],
      "2026-08-12T00:00:00.000Z",
    );
    const baselineReport = JSON.stringify(buildPortableAuditReport(baselineRun));
    const user = userEvent.setup();
    const { container } = render(<CatalogQaApp downloadHandler={vi.fn<DownloadHandler>()} />);

    await user.click(screen.getByRole("button", { name: /Regression Catalog/ }));
    const baselineInput = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1];
    await user.upload(baselineInput, reportFile(baselineReport));
    const comparison = await screen.findByRole("region", { name: "Audit comparison" });
    const newRows = within(comparison).getAllByRole("button", { name: /^New/ });
    expect(newRows).toHaveLength(3);

    await user.upload(baselineInput, reportFile("{bad", "malformed.json"));
    expect(await screen.findByText("REPORT_PARSE_ERROR")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Audit comparison" })).toBeNull();
  });

  it("supports accepted exception and clearing local workflow data", async () => {
    const user = userEvent.setup();
    render(<CatalogQaApp downloadHandler={vi.fn<DownloadHandler>()} />);
    await user.click(screen.getByRole("button", { name: "Accept exception" }));
    expect(screen.getByRole("complementary", { name: "Finding detail" }).textContent).toContain("Accepted exception");
    await user.click(screen.getByRole("button", { name: "Clear local workflow data" }));
    expect(await screen.findByText("Local workflow data cleared. Imported catalogs were never stored.")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Finding detail" }).textContent).toContain("Open");
  });
});
