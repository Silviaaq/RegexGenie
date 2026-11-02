import React from "react";
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { App } from "../frontend/main.jsx";
let calls = [];
let operation = "regex_replace";
const w = {
  workspace_id: "w1",
  revision: 2,
  can_undo: false,
  file: {
    name: "customers.csv",
    row_count: 1,
    sheet: "CSV",
    columns: [{ id: "c0", name: "Email" }],
  },
};
beforeEach(() => {
  sessionStorage.clear();
  HTMLDialogElement.prototype.close = vi.fn();
  HTMLDialogElement.prototype.showModal = vi.fn();
  history.replaceState(null, "", "/");
  calls = [];
  operation = "regex_replace";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, opts = {}) => {
      calls.push([url, opts]);
      let d = {};
      if (url === "/api/config") d = { model_ready: true };
      else if (url === "/api/workspaces/")
        d = { workspace_id: "w1", revision: 1 };
      else if (url.includes("/upload/")) d = w;
      else if (url.includes("/data/"))
        d = {
          ...w,
          headers: ["Email"],
          rows: [["REDACTED"]],
          before: [["a@example.com"]],
          row_count: 1,
          offset: 0,
          page: 1,
        };
      else if (url.includes("/workspaces/") && url.includes("/jobs/"))
        d = { job_id: "j1", status: "queued" };
      else if (url === "/api/jobs/j1/")
        d =
          operation === "regex_replace"
            ? {
                job_id: "j1",
                status: "ready",
                operation,
                plan_hash: "p",
                plan: { pattern: "email", flags: [] },
                impact: {
                  matches: 1,
                  match_positions: [],
                  changed_rows: 1,
                  risk: { requires_confirmation: false, signals: [] },
                },
              }
            : {
                job_id: "j1",
                status: "awaiting_consent",
                operation,
                target_column_id: "c0",
                scope_hash: "s",
              };
      else if (url.includes("/values/"))
        d = {
          total: 2,
          filtered_total: 2,
          items: [
            { id: "v0", value: "AU", occurrences: 3 },
            { id: "v1", value: "WA", occurrences: 1 },
          ],
        };
      else if (url.includes("/apply/"))
        d = { ...w, revision: 3, status: "applied", can_undo: true };
      return { ok: true, json: async () => d };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function sample() {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Try Sample Data" }));
  await screen.findByRole("heading", { name: "customers.csv" });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Generate preview" }).disabled,
    ).toBe(false),
  );
}
test("landing demo is illustrative and sample uploads through real API adapter", async () => {
  await sample();
  expect(calls.some(([p]) => p.includes("/upload/"))).toBe(true);
  expect(screen.getByLabelText("Replacement value").value).toBe("REDACTED");
  expect(
    screen
      .getByRole("link", { name: "Download current data" })
      .getAttribute("href"),
  ).toContain("/export/");
});
test("generate does not apply; only explicit Apply commits", async () => {
  await sample();
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await screen.findByRole("button", { name: "Apply changes" });
  expect(calls.some(([p]) => p.includes("/apply/"))).toBe(false);
  const submitted = JSON.parse(
    calls.find(([p]) => p.includes("/jobs/"))[1].body,
  );
  expect(submitted.replacement_value).toBe("REDACTED");
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  await screen.findByRole("link", { name: "Download cleaned file" });
  expect(calls.filter(([p]) => p.includes("/apply/")).length).toBe(1);
});
test("explicit Remove disables replacement and sends remove action", async () => {
  await sample();
  fireEvent.click(screen.getByLabelText("Remove matched text"));
  expect(screen.getByLabelText("Replacement value").disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await waitFor(() =>
    expect(calls.some(([p]) => p.includes("/jobs/"))).toBe(true),
  );
  expect(
    JSON.parse(calls.find(([p]) => p.includes("/jobs/"))[1].body).action,
  ).toBe("remove");
});
test("P1 values remain unshared before checked consent and explicit selection", async () => {
  operation = "normalise_values";
  await sample();
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await screen.findByText("Review data shared with AI");
  await screen.findByText("AU");
  expect(
    screen.getByRole("button", {
      name: "Share selected values & generate suggestions",
    }).disabled,
  ).toBe(true);
  expect(calls.some(([p]) => p.includes("/scope-consent/"))).toBe(false);
  expect(screen.getByLabelText("Replacement value").disabled).toBe(true);
});
