// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserDownload, type DownloadHandler } from "../src/reports";
import { CatalogQaApp } from "../src/ui/CatalogQaApp";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("catalog import to report interaction", () => {
  it("uploads CSV, exposes diagnostics and audit results, then downloads JSON and HTML", async () => {
    const csv = readFileSync(resolve(process.cwd(), "fixtures/shopify-malformed.csv"), "utf8");
    const downloads = vi.fn<DownloadHandler>();
    const user = userEvent.setup();
    const { container } = render(<CatalogQaApp downloadHandler={downloads} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File([csv], "shopify-malformed.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });

    await user.upload(input as HTMLInputElement, file);

    expect(await screen.findByRole("heading", { name: "shopify-malformed.csv" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Import summary" }).textContent).toContain("shopify-product-csv v3");
    expect(screen.getByRole("region", { name: "Import diagnostics" }).textContent).toContain("CSV_STATUS_UNKNOWN");
    expect(screen.getByText("Catalog QA findings")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Download JSON" }));
    await user.click(screen.getByRole("button", { name: "Download HTML" }));
    await waitFor(() => expect(downloads).toHaveBeenCalledTimes(2));

    const jsonPayload = downloads.mock.calls[0][0];
    const htmlPayload = downloads.mock.calls[1][0];
    expect(jsonPayload.filename).toBe("shopify-malformed-catalog-qa-report.json");
    expect(JSON.parse(jsonPayload.content)).toMatchObject({
      schemaVersion: "catalog-qa.audit-report.v2",
      source: { adapterId: "shopify-product-csv", adapterVersion: 3 },
      safety: { readOnly: true, storeChangesPerformed: false },
    });
    expect(htmlPayload.filename).toBe("shopify-malformed-catalog-qa-report.html");
    expect(htmlPayload.content).toContain("Read-only catalog audit report");
  });
});
describe("browser report download helper", () => {
  it("keeps the Blob URL alive until the next event-loop turn", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:catalog-report");
    const revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });

    browserDownload({
      filename: "catalog-report.json",
      mimeType: "application/json",
      content: "{}",
    });

    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download="catalog-report.json"]')).not.toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(document.querySelector('a[download="catalog-report.json"]')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:catalog-report");
    vi.useRealTimers();
  });
});
