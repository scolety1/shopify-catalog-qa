// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CatalogQaApp } from "../src/ui/CatalogQaApp";
import { loadWorkflowRecords } from "../src/workflow";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("returns an explicit read diagnostic without mutating unavailable storage", () => {
  const storage = { getItem: vi.fn(() => { throw new Error("denied"); }), setItem: vi.fn(), removeItem: vi.fn() };
  expect(loadWorkflowRecords(storage)).toMatchObject({ records: [], unavailable: true, diagnostic: expect.any(String) });
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(storage.removeItem).not.toHaveBeenCalled();
});

it("renders when the browser storage getter is denied and labels edits session-only", async () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
  render(<CatalogQaApp />);
  expect(screen.getByRole("region", { name: "Audit summary" })).toBeTruthy();
  expect(screen.getByText(/session only/i)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Plan remediation" }));
  expect(screen.getByText(/session only/i)).toBeTruthy();
});

it("does not overwrite unread records after a failed read", async () => {
  const storage = { getItem: vi.fn(() => { throw new Error("denied"); }), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(), length: 1 };
  render(<CatalogQaApp storage={storage} />);
  await userEvent.click(screen.getByRole("button", { name: "Plan remediation" }));
  expect(screen.getByText(/session only/i)).toBeTruthy();
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(storage.removeItem).not.toHaveBeenCalled();
});
