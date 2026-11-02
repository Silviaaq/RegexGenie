import React from "react";
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../frontend/legacy-v15.jsx";
let calls,
  targetRow = 100,
  count;
const headers = ["ID", "Email"];
const rows = Array.from({ length: 120 }, (_, i) => [
  String(i).padStart(3, "0"),
  i === targetRow ? "a@b.com" : "plain",
]);
const match = () => ({
  ordinal: 1,
  row: targetRow,
  col: 1,
  start: 0,
  end: 7,
  result_start: 0,
  result_end: 1,
  text: "a@b.com",
});
function page(offset) {
  const original = rows.slice(offset, offset + 50).map((r) => [...r]);
  const processed = original.map((r, i) => [
    r[0],
    offset + i === targetRow ? "X" : r[1],
  ]);
  return {
    original,
    processed,
    matches:
      count && targetRow >= offset && targetRow < offset + 50 ? [match()] : [],
  };
}
beforeEach(() => {
  calls = [];
  targetRow = 100;
  count = 1;
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, opts = {}) => {
      calls.push([url, opts]);
      let body = {};
      if (url === "/api/config") body = { model_ready: true };
      else if (url === "/api/datasets")
        body = {
          dataset_id: "d1",
          sheets: ["CSV"],
          expires_at: new Date(Date.now() + 1800000).toISOString(),
        };
      else if (url.includes("select-sheet"))
        body = {
          headers,
          rows: rows.slice(0, 50),
          row_count: 120,
          dataset_version: "v1",
        };
      else if (url === "/api/transformations") {
        const p = page(0);
        body = {
          id: "t1",
          rows: p.processed,
          original: p.original,
          matches: p.matches,
          target_count: count,
          changed_cells: count,
          operation: "regex_replace",
          col: 1,
          plan: { pattern: "email" },
          interpretation: "Replace matching text in column Email with X.",
        };
      } else if (url.includes("/targets/")) body = match();
      else if (url.includes("/transformations/t1/rows"))
        body = page(
          Number(new URL(url, "https://test").searchParams.get("offset")),
        );
      else if (url.includes("/datasets/d1/rows"))
        body = { rows: rows.slice(50, 100) };
      else if (opts.method === "DELETE") body = { deleted: true };
      else throw Error("Unexpected API request: " + url);
      return { ok: true, json: async () => body };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function prepare() {
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Try Sample Data" }).disabled,
    ).toBe(false),
  );
  await user.click(screen.getByRole("button", { name: "Try Sample Data" }));
  await screen.findByText("customer_directory.csv");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Generate Preview" }).disabled,
    ).toBe(false),
  );
  return user;
}
test("free-form instruction reaches API; first match beyond first page is located", async () => {
  const user = await prepare();
  const box = screen.getByLabelText("Cleaning instruction");
  await user.clear(box);
  await user.type(box, "In Email, hide each address as X, please.");
  await user.click(screen.getByRole("button", { name: "Generate Preview" }));
  await screen.findByText("Preview ready");
  const request = calls.find(([url]) => url === "/api/transformations");
  expect(JSON.parse(request[1].body).instruction).toBe(
    "In Email, hide each address as X, please.",
  );
  expect(calls.some(([u]) => u.endsWith("/targets/1"))).toBe(true);
  expect(screen.getByText("101–120 of 120")).toBeTruthy();
  expect(screen.getByText("1/1")).toBeTruthy();
  expect(document.querySelectorAll('[data-cell="100-1"]')).toHaveLength(2);
  const panels = document.querySelectorAll(".comparison .table-scroll");
  panels[0].scrollLeft = 220;
  fireEvent.scroll(panels[0]);
  expect(panels[1].scrollLeft).toBe(220);
  await user.click(screen.getByRole("button", { name: "Edit Instruction" }));
  await screen.findByText("Original data");
  expect(screen.getByText("1–50 of 120")).toBeTruthy();
  expect(screen.getByLabelText("Cleaning instruction").value).toContain(
    "hide each address",
  );
});
test("zero matches remain a successful downloadable result", async () => {
  count = 0;
  const user = await prepare();
  await user.click(screen.getByRole("button", { name: "Generate Preview" }));
  await screen.findByText("Preview ready");
  expect(screen.getByText("0/0")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Next match" }).disabled).toBe(
    true,
  );
  await user.click(
    screen.getByRole("button", { name: "Download", exact: true }),
  );
  expect(screen.getByText("DOWNLOAD FULL RESULT")).toBeTruthy();
});
test("delete removes workspace after explicit dialog action", async () => {
  const user = await prepare();
  await user.click(
    screen.getByRole("button", { name: "Delete File & Results" }),
  );
  const buttons = screen.getAllByRole("button", {
    name: "Delete File & Results",
  });
  await user.click(buttons.at(-1));
  await screen.findByText("File and results deleted.");
  expect(
    calls.some(
      ([url, opts]) => url === "/api/datasets/d1" && opts.method === "DELETE",
    ),
  ).toBe(true);
  expect(
    screen.getByRole("button", { name: "Generate Preview" }).disabled,
  ).toBe(true);
});
test("missing model reports actionable error without preset fallback", async () => {
  const user = await prepare();
  const real = global.fetch;
  global.fetch = vi.fn((url, opts) =>
    url === "/api/transformations"
      ? Promise.resolve({
          ok: false,
          json: async () => ({
            message: "The AI service is not configured yet.",
          }),
        })
      : real(url, opts),
  );
  await user.click(screen.getByRole("button", { name: "Generate Preview" }));
  await screen.findByText("The AI service is not configured yet.");
  expect(screen.queryByText("Preview ready")).toBeNull();
  expect(screen.getByLabelText("Cleaning instruction").value).toContain(
    "email addresses",
  );
});
