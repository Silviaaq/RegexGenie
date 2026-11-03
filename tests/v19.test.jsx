import React from "react";
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import { App } from "../frontend/main.jsx";
let calls = [];
let operation = "regex_replace";
let consented = false;
let longTable = false;
let clarifyReplacement = false;
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
  consented = false;
  longTable = false;
  clarifyReplacement = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, opts = {}) => {
      calls.push([url, opts]);
      let d = {};
      if (url === "/api/config") d = { model_ready: true };
      else if (url === "/api/workspaces/")
        d = { workspace_id: "w1", revision: 1 };
      else if (url.includes("/upload/")) d = w;
      else if (url.includes("/data/")) {
        const allRows =
          operation === "regex_replace"
            ? [["REDACTED"]]
            : longTable
              ? [...Array.from({ length: 51 }, () => ["AU"]), ["AUS"], ["WA"]]
              : [["AU"], ["AU"], ["AUS"], ["WA"]];
        const page = Number(
          new URL(url, "http://localhost").searchParams.get("page") || 1,
        );
        const offset = (page - 1) * 50;
        d = {
          ...w,
          headers: ["Email"],
          rows: allRows.slice(offset, offset + 50),
          before:
            operation === "regex_replace"
              ? [["a@example.com"]]
              : allRows.slice(offset, offset + 50),
          row_count: allRows.length,
          offset,
          page,
        };
      } else if (url.includes("/workspaces/") && url.includes("/jobs/"))
        d = { job_id: "j1", status: "queued" };
      else if (url.includes("/scope-consent/")) {
        consented = true;
        d = { status: "queued" };
      } else if (url.includes("/suggestions/"))
        d = {
          items: [
            {
              id: "s0",
              original: "AU",
              proposed: "Australia",
              ai_status: "proposed",
              occurrences: longTable ? 51 : 2,
              reason: "Country",
            },
            {
              id: "s1",
              original: "AUS",
              proposed: "Australia",
              ai_status: "proposed",
              occurrences: 1,
              reason: "Country",
            },
            {
              id: "s2",
              original: "WA",
              proposed: "Western Australia",
              ai_status: "needs_review",
              occurrences: 1,
              reason: "Ambiguous",
            },
          ],
        };
      else if (url === "/api/jobs/j1/" && opts.method === "POST") {
        clarifyReplacement = false;
        d = { job_id: "j1", status: "queued" };
      } else if (url === "/api/jobs/j1/" && clarifyReplacement)
        d = {
          job_id: "j1",
          status: "needs_input",
          operation: "regex_replace",
          target_column_id: "c0",
          impact: {
            message: "What should replace the matched text?",
            replacement_required: true,
          },
        };
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
                status: consented ? "ready" : "awaiting_consent",
                impact: {},
                plan_hash: "p",
                operation,
                target_column_id: "c0",
                scope_hash: "s",
              };
      else if (url.includes("/values/"))
        d = {
          within_budget: true,
          all_items: [
            { id: "v0", value: "AU", occurrences: 3 },
            { id: "v1", value: "WA", occurrences: 1 },
          ],
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
  expect(screen.queryByLabelText("Replacement value")).toBeNull();
  expect(screen.getByLabelText("Describe what to change").value).toContain(
    "REDACTED",
  );
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
  expect(submitted.replacement_value).toBeUndefined();
  expect(submitted.instruction).toContain("REDACTED");
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  await screen.findByRole("link", { name: "Download cleaned file" });
  expect(calls.filter(([p]) => p.includes("/apply/")).length).toBe(1);
});
test("single instruction supports explicit removal without a separate replacement panel", async () => {
  await sample();
  fireEvent.change(screen.getByLabelText("Describe what to change"), {
    target: { value: "Remove email addresses from the Email column" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await screen.findByRole("button", { name: "Apply changes" });
  const payload = JSON.parse(calls.find(([p]) => p.includes("/jobs/"))[1].body);
  expect(payload.action).toBeUndefined();
  expect(payload.instruction).toContain("Remove");
});
test("P1 values remain unshared before checked consent and explicit selection", async () => {
  operation = "normalise_values";
  await sample();
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await screen.findByText("Permission to generate suggestions");
  await screen.findAllByText("AU");
  expect(
    screen.getByRole("button", {
      name: "Share selected values & generate suggestions",
    }).disabled,
  ).toBe(true);
  expect(calls.some(([p]) => p.includes("/scope-consent/"))).toBe(false);
  expect(screen.queryByLabelText("Replacement value")).toBeNull();
});

test("P1 compact consent is opt-in; selection previews without applying and batch states persist", async () => {
  operation = "normalise_values";
  await sample();
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await screen.findByText("Permission to generate suggestions");
  const share = screen.getByRole("button", {
    name: "Share selected values & generate suggestions",
  });
  await waitFor(() =>
    expect(screen.getByText(/All values fit in this step/)).toBeTruthy(),
  );
  expect(share.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: /I agree to share/ }));
  expect(share.disabled).toBe(false);
  fireEvent.click(share);
  await screen.findByRole("checkbox", { name: "Apply change for AU" });
  const selectAll = screen.getByRole("button", {
    name: /Select all 2 eligible/,
  });
  const keepAll = screen.getByRole("button", { name: "Keep all" });
  expect(selectAll.getAttribute("aria-pressed")).toBe("false");
  expect(keepAll.getAttribute("aria-pressed")).toBe("false");
  const preview = () =>
    screen.getByRole("heading", { name: "Preview · After this step" })
      .parentElement;
  await waitFor(() =>
    expect(within(preview()).queryAllByText("AU").length).toBe(2),
  );
  fireEvent.click(selectAll);
  expect(selectAll.getAttribute("aria-pressed")).toBe("true");
  expect(
    screen.getByRole("checkbox", { name: "Apply change for WA" }).checked,
  ).toBe(false);
  expect(within(preview()).getAllByText("Australia").length).toBe(3);
  expect(calls.some(([url]) => url.includes("/apply/"))).toBe(false);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Apply change for AU" }),
  );
  expect(selectAll.getAttribute("aria-pressed")).toBe("false");
  expect(within(preview()).getAllByText("AU").length).toBe(2);
  fireEvent.click(keepAll);
  expect(keepAll.getAttribute("aria-pressed")).toBe("true");
  expect(
    screen.getByRole("button", { name: "Apply selected changes" }).disabled,
  ).toBe(true);
  fireEvent.click(selectAll);
  fireEvent.click(
    screen.getByRole("button", { name: "Apply selected changes" }),
  );
  await screen.findByRole("link", { name: "Download cleaned file" });
  expect(
    JSON.parse(calls.find(([p]) => p.includes("/apply/"))[1].body)
      .selected_suggestion_ids,
  ).toEqual(["s0", "s1"]);
});

test("P1 selection and global totals survive pagination without modifying the original", async () => {
  operation = "normalise_values";
  longTable = true;
  await sample();
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await screen.findByText("Permission to generate suggestions");
  fireEvent.click(screen.getByRole("checkbox", { name: /I agree to share/ }));
  fireEvent.click(
    screen.getByRole("button", {
      name: "Share selected values & generate suggestions",
    }),
  );
  await screen.findByRole("checkbox", { name: "Apply change for AU" });
  fireEvent.click(
    screen.getByRole("button", { name: /Select all 2 eligible/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Next page", exact: true }),
  );
  await screen.findByText("Page 2");
  const preview = screen.getByRole("heading", {
    name: "Preview · After this step",
  }).parentElement;
  const original = screen.getByRole("heading", {
    name: "Original · Before this step",
  }).parentElement;
  expect(within(preview).getAllByText("Australia").length).toBe(2);
  expect(within(original).getByText("AU")).toBeTruthy();
  expect(
    screen.getByText("2 suggestions selected · 52 rows will change"),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Apply change for AU" }),
  );
  expect(within(preview).getByText("AU")).toBeTruthy();
  expect(within(preview).getAllByText("Australia").length).toBe(1);
  expect(calls.some(([url]) => url.includes("/apply/"))).toBe(false);
});

test("find-only clarification asks for replacement and preserves the user's exact input", async () => {
  clarifyReplacement = true;
  await sample();
  expect(screen.queryByLabelText("Exact replacement value")).toBeNull();
  fireEvent.change(screen.getByLabelText("Describe what to change"), {
    target: { value: "Find email addresses in the Email column." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  const field = await screen.findByLabelText("Exact replacement value");
  expect(screen.queryByLabelText("Target column")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Continue", exact: true }).disabled,
  ).toBe(true);
  const value = String.raw` C:\Temp\1 $1 `;
  fireEvent.change(field, { target: { value } });
  fireEvent.click(
    screen.getByRole("button", { name: "Continue", exact: true }),
  );
  await screen.findByRole("button", { name: "Apply changes" });
  const request = calls.find(
    ([url, options]) => url === "/api/jobs/j1/" && options.method === "POST",
  );
  expect(JSON.parse(request[1].body).replacement_value).toBe(value);
  expect(calls.some(([url]) => url.includes("/apply/"))).toBe(false);
});
