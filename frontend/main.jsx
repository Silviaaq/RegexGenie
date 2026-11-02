import React, { useState as S, useEffect as E, useRef as R } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ArrowLeft,
  Upload,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  Check,
  Download,
  Sparkles,
  Undo2,
  RotateCcw,
  X,
  ShieldCheck,
  Search,
} from "lucide-react";
import "./style.css";

async function api(path, body) {
  const token = document.cookie
    .split("; ")
    .find((x) => x.startsWith("csrftoken="))
    ?.split("=")[1];
  const response = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      "X-CSRFToken": token || "",
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(
      data.message || data.error?.message || "The request failed. Try again.",
    );
  return data;
}
function Lamp({ small = false }) {
  return (
    <svg
      className={small ? "lamp small" : "lamp"}
      viewBox="0 0 160 150"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="blue" x2="1" y2="1">
          <stop stopColor="#0074a9" />
          <stop offset="1" stopColor="#00b7ce" />
        </linearGradient>
      </defs>
      <path
        d="M54 8q20 18 7 37t8 24M111 8q-18 18-9 35t-5 26"
        fill="none"
        stroke="#efc128"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="2 5"
      />
      <text x="65" y="36" fill="#d9aa18" fontSize="17" fontFamily="monospace">
        .*
      </text>
      <path
        d="M33 94c6-30 60 14 105-21-8 37-25 48-56 48-18-2-54-9-49-27"
        fill="url(#blue)"
      />
      <circle
        cx="48"
        cy="100"
        r="10"
        fill="none"
        stroke="#f4cf31"
        strokeWidth="5"
      />
      <path d="M60 123h51l-7 13H67z" fill="#0076a8" />
    </svg>
  );
}
function Brand() {
  return (
    <a href="/" className="brand" aria-label="RegexGenie home">
      <Lamp small />
      <span>RegexGenie</span>
    </a>
  );
}
const demoRows = [
  ["1", "John Doe", "john.doe@example.com"],
  ["2", "Jane Smith", "jane_smith@domain.com"],
  ["3", "Alice Brown", "alice.brown@website.org"],
];
function Highlight({ value, matches, after }) {
  if (!matches?.length || typeof value !== "string")
    return <>{String(value)}</>;
  let cursor = 0;
  const parts = [];
  matches.forEach((m, i) => {
    const start = after ? m.result_start : m.start,
      end = after ? m.result_end : m.end;
    if (start >= cursor && end >= start) {
      parts.push(value.slice(cursor, start));
      parts.push(
        <mark key={i} title={after ? "Replacement text" : "Matched text"}>
          {value.slice(start, end) || "∅"}
        </mark>,
      );
      cursor = end;
    }
  });
  parts.push(value.slice(cursor));
  return <>{parts}</>;
}
function Table({
  headers,
  rows,
  before,
  offset = 0,
  kind = "",
  active = -1,
  onScroll,
  scrollRef,
  highlights = [],
  after = false,
}) {
  return (
    <div className={"table-wrap " + kind} onScroll={onScroll} ref={scrollRef}>
      <table>
        <thead>
          <tr>
            <th scope="col">#</th>
            {headers.map((h, i) => (
              <th scope="col" key={i}>
                {h || `Column ${i + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              data-row={offset + i}
              className={active === offset + i ? "active-row" : ""}
            >
              <th scope="row">{offset + i + 1}</th>
              {r.map((v, j) => {
                const changed =
                  before &&
                  JSON.stringify(v) !== JSON.stringify(before[i]?.[j]);
                const value = v && typeof v === "object" ? v.value : v;
                return (
                  <td
                    key={j}
                    className={changed ? "changed" : ""}
                    title={
                      changed
                        ? "Changed in this step"
                        : String(value ?? "Missing value")
                    }
                  >
                    <span>
                      {v === null ? (
                        <i className="null">null</i>
                      ) : value === "" ? (
                        <i className="muted" title="Empty string">
                          empty
                        </i>
                      ) : (
                        <Highlight
                          value={value}
                          matches={highlights.filter(
                            (m) => m.row === offset + i && m.col === j,
                          )}
                          after={after}
                        />
                      )}
                    </span>
                    {changed && <small className="diff-tag">changed</small>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="muted empty">No rows on this page.</p>}
    </div>
  );
}
function Landing({ upload, sample, start }) {
  return (
    <>
      <header>
        <Brand />
        <nav>
          <a href="#how">How it works</a>
          <button className="text" onClick={sample}>
            Try Sample Data
          </button>
          <button onClick={start}>Start cleaning</button>
        </nav>
      </header>
      <main className="landing">
        <section className="hero">
          <div className="doodle bubble left" aria-hidden="true">
            [A-z]
          </div>
          <div className="doodle bubble right" aria-hidden="true">
            \d+
          </div>
          <div className="doodle curl" aria-hidden="true">
            &#123; .* &#125;
          </div>
          <div className="doodle email" aria-hidden="true">
            <s>j@mail.com</s>
          </div>
          <div className="doodle genie">
            <Lamp />
          </div>
          <div className="doodle glass" aria-hidden="true">
            <Search size={90} />
            <span>@</span>
          </div>
          <h1>
            The simplest way to
            <br />
            <span className="underline">clean spreadsheet</span>
            <br />
            data
          </h1>
          <p className="subtitle">All you need is one instruction.</p>
          <button className="upload-cta" onClick={upload}>
            Upload a CSV or Excel file <ArrowRight size={19} />
          </button>
          <p className="caption">No signup required · Max 10 MB</p>
        </section>
        <section
          className="demo-window"
          aria-label="Illustrative product preview"
        >
          <div className="browser-bar">
            <span>● ● ●</span> RegexGenie / Data cleaner / customers.csv{" "}
            <small>Illustrative preview</small>
          </div>
          <div className="demo-content">
            <div className="demo-instruction">
              <span>Find email addresses in the Email column</span>
              <span className="demo-chip">Replacement: REDACTED</span>
              <span className="purple-label">Generate preview</span>
            </div>
            <div className="dual">
              <div className="pane original">
                <h3>Original · Before this step</h3>
                <Table headers={["ID", "Name", "Email"]} rows={demoRows} />
              </div>
              <div className="pane preview">
                <h3>Preview · After this step</h3>
                <Table
                  headers={["ID", "Name", "Email"]}
                  rows={demoRows.map((r) => [...r.slice(0, 2), "REDACTED"])}
                  before={demoRows}
                />
              </div>
            </div>
            <div className="demo-bottom">
              <span>
                3 of 3 cells changed · Your original file stays untouched
              </span>
              <button onClick={sample}>
                Try this with sample data <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </section>
        <section id="how" className="how">
          <p className="eyebrow">A LITTLE MAGIC. TOTAL CONTROL.</p>
          <h2>From messy to ready, in three steps.</h2>
          <div className="steps">
            {[
              [
                "01",
                "Bring your spreadsheet",
                "Upload a CSV or Excel file. Your original stays untouched.",
              ],
              [
                "02",
                "Tell Genie what to clean",
                "Find patterns, standardise values or review missing markers.",
              ],
              [
                "03",
                "Review. Apply. Download.",
                "See every change and decide what to keep.",
              ],
            ].map(([n, h, p]) => (
              <article key={n}>
                <span>{n}</span>
                <h3>{h}</h3>
                <p>{p}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
export function App() {
  const [route, setRoute] = S(location.pathname === "/app" ? "app" : "home"),
    [w, setW] = S(null),
    [table, setTable] = S(null),
    [job, setJob] = S(null),
    [instruction, setInstruction] = S(""),
    [replacement, setReplacement] = S(""),
    [remove, setRemove] = S(false),
    [busy, setBusy] = S(""),
    [error, setError] = S(""),
    [notice, setNotice] = S(""),
    [sheetChoices, setSheetChoices] = S([]),
    [suggestions, setSuggestions] = S([]),
    [selected, setSelected] = S([]),
    [scope, setScope] = S([]),
    [scopeInfo, setScopeInfo] = S(null),
    [scopePage, setScopePage] = S(1),
    [query, setQuery] = S(""),
    [consent, setConsent] = S(false),
    [column, setColumn] = S(""),
    [format, setFormat] = S("csv"),
    [match, setMatch] = S(0),
    [page, setPage] = S(1),
    [applied, setApplied] = S(false),
    [lastAppliedId, setLastAppliedId] = S(null),
    [risk, setRisk] = S(false),
    [config, setConfig] = S(null);
  const input = R(),
    pending = R(),
    epoch = R(0),
    left = R(),
    right = R(),
    syncing = R(false),
    dialog = R();
  E(() => {
    api("config")
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, []);
  E(() => {
    const saved = sessionStorage.getItem("regexgenie-workspace");
    if (saved && location.pathname === "/app") {
      api(`workspaces/${saved}/data/?page=1`)
        .then((d) => {
          setW(d);
          setTable(d);
        })
        .catch((e) => {
          sessionStorage.removeItem("regexgenie-workspace");
          setError(e.message);
        });
    }
  }, []);
  E(() => {
    if (w?.workspace_id)
      sessionStorage.setItem("regexgenie-workspace", w.workspace_id);
  }, [w?.workspace_id]);
  function go() {
    setRoute("app");
    history.replaceState(null, "", "/app");
  }
  async function run(label, fn) {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  function clearJob() {
    setLastAppliedId(null);
    setJob(null);
    setSuggestions([]);
    setSelected([]);
    setScope([]);
    setScopeInfo(null);
    setConsent(false);
    setApplied(false);
    setMatch(0);
    setRisk(false);
  }
  async function refresh(
    work = w,
    p = page,
    jid = job?.job_id || lastAppliedId,
  ) {
    if (!work?.file) return;
    const n = epoch.current;
    const t = await api(
      `workspaces/${work.workspace_id}/data/?page=${p}${jid ? "&job_id=" + jid : ""}`,
    );
    if (n === epoch.current) {
      setTable(t);
      setW({ ...work, ...t });
      setPage(p);
    }
  }
  async function uploadFile(file, sheet) {
    if (!file) return;
    if (file.size > 10485760) {
      setError("Upload a file of at most 10 MB.");
      return;
    }
    go();
    epoch.current++;
    clearJob();
    pending.current = file;
    await run("Reading your file…", async () => {
      let work = w;
      if (!work) {
        work = await api("workspaces/", {});
        setW(work);
      }
      const form = new FormData();
      form.append("file", file);
      if (sheet) form.append("sheet", sheet);
      const res = await api(`workspaces/${work.workspace_id}/upload/`, form);
      if (res.status === "choose_sheet") {
        setSheetChoices(res.sheets);
        return;
      }
      setSheetChoices([]);
      setW(res);
      setNotice("File ready. Your original upload stays unchanged.");
      setTable(null);
      await refresh(res, 1, null);
    });
  }
  async function sample() {
    const content =
      "ID,Name,Email,Country,Age\n1,John Doe,john.doe@example.com,AU,N/A\n2,Jane Smith,jane_smith@domain.com,AUS,0\n3,Alice Brown,alice.brown@website.org,australia,Not provided\n4,Sam Lee,sam@example.com,WA,NA\n5,Chris Green,chris@example.org,UK,32\n";
    setInstruction("Find email addresses in the Email column");
    setReplacement("REDACTED");
    await uploadFile(
      new File([content], "customers.csv", { type: "text/csv" }),
    );
  }
  async function generate() {
    clearJob();
    await run("Understanding your instruction…", async () => {
      if (
        replacement &&
        replacement.trim() === "" &&
        !remove &&
        !confirm(
          "The replacement contains only whitespace. Keep this exact value?",
        )
      )
        return;
      const j = await api(`workspaces/${w.workspace_id}/jobs/`, {
        instruction,
        action: remove ? "remove" : "replace",
        replacement_value: replacement,
        base_revision: w.revision,
      });
      setJob(j);
    });
  }
  E(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    let alive = true;
    const n = epoch.current;
    const timer = setTimeout(async () => {
      try {
        const j = await api(`jobs/${job.job_id}/`);
        if (!alive || n !== epoch.current) return;
        setJob(j);
        if (j.status === "ready") {
          if (j.operation === "regex_replace") await refresh(w, 1, j.job_id);
          else
            setSuggestions((await api(`jobs/${j.job_id}/suggestions/`)).items);
        }
        if (j.status === "failed") setError(j.impact.message);
        if (j.status === "awaiting_consent") {
          setScopePage(1);
          setQuery("");
        }
      } catch (e) {
        if (alive) setError(e.message);
      }
    }, 700);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [job]);
  E(() => {
    if (job?.status !== "awaiting_consent") return;
    let alive = true;
    api(
      `workspaces/${w.workspace_id}/values/?column_id=${job.target_column_id}&page=${scopePage}&q=${encodeURIComponent(query)}`,
    )
      .then((d) => {
        if (alive) setScopeInfo(d);
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [job?.status, scopePage, query]);
  E(() => {
    if (risk) dialog.current?.showModal();
    else dialog.current?.close();
  }, [risk]);
  const positions = job?.impact?.match_positions || [],
    active = positions[match]?.row ?? -1;
  async function navigateMatch(delta) {
    const m = (match + delta + positions.length) % positions.length;
    setMatch(m);
    const row = positions[m].row;
    await refresh(w, Math.floor(row / 50) + 1);
    requestAnimationFrame(() => {
      left.current
        ?.querySelector(`[data-row="${row}"]`)
        ?.scrollIntoView({ block: "nearest" });
      right.current
        ?.querySelector(`[data-row="${row}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }
  function scroll(from, to) {
    if (syncing.current) return;
    syncing.current = true;
    if (to.current) {
      to.current.scrollTop = from.current.scrollTop;
      to.current.scrollLeft = from.current.scrollLeft;
    }
    requestAnimationFrame(() => (syncing.current = false));
  }
  async function apply(ack = false) {
    if (
      job.operation === "regex_replace" &&
      job.impact.risk.requires_confirmation &&
      !ack
    ) {
      setRisk(true);
      return;
    }
    setRisk(false);
    await run("Applying your changes…", async () => {
      const result = await api(`jobs/${job.job_id}/apply/`, {
        base_revision: w.revision,
        plan_hash: job.plan_hash,
        selected_suggestion_ids: selected,
        confirm_high_risk: ack,
      });
      setW(result);
      setApplied(result.status === "applied");
      setLastAppliedId(result.status === "applied" ? job.job_id : null);
      setNotice(
        result.status === "applied"
          ? "Changes applied. Your original file is untouched."
          : "No changes selected. Your data is unchanged.",
      );
      setJob(null);
      await refresh(result, 1, result.status === "applied" ? job.job_id : null);
    });
  }
  async function action(a) {
    if (
      a !== "undo" &&
      !confirm(
        a === "reset"
          ? "Reset all cleaning changes to the original data?"
          : "Remove this file and its current results? Download anything you need first.",
      )
    )
      return;
    epoch.current++;
    await run("Updating workspace…", async () => {
      const res = await api(`workspaces/${w.workspace_id}/action/`, {
        action: a,
        base_revision: w.revision,
      });
      setW(res);
      clearJob();
      setTable(null);
      setNotice(
        a === "undo"
          ? "Last change undone."
          : a === "reset"
            ? "Original data restored."
            : "File removed.",
      );
      await refresh(res, 1, null);
    });
  }
  const semanticHint =
    /standardis|standardiz|normalis|normaliz|missing[ -]value|missing markers/i.test(
      instruction,
    );
  const reviewing = job && ["ready", "awaiting_consent"].includes(job.status);
  const running = busy || ["queued", "running"].includes(job?.status),
    p1 = job && job.operation && job.operation !== "regex_replace",
    canGenerate =
      w?.file &&
      instruction.trim() &&
      !running &&
      !reviewing &&
      (semanticHint || remove || replacement !== "");
  return (
    <>
      <input
        className="visually-hidden"
        type="file"
        accept=".csv,.xlsx"
        ref={input}
        aria-label="Upload CSV or XLSX"
        onChange={(e) => {
          uploadFile(e.target.files[0]);
          e.target.value = "";
        }}
      />
      {route === "home" ? (
        <Landing
          upload={() => input.current.click()}
          sample={sample}
          start={go}
        />
      ) : (
        <>
          <header>
            <Brand />
            <nav>
              <a href="/">Back to home</a>
              <button
                className="text"
                onClick={() =>
                  alert(
                    "Upload CSV or XLSX, describe one cleaning task, review the preview or AI suggestions, then apply and download. Instructions and column names are shared with Groq. Cell values require separate approval.",
                  )
                }
              >
                Help
              </button>
            </nav>
          </header>
          <main className="workspace">
            <div className="workspace-title">
              <div>
                <p className="eyebrow">YOUR DATA, A LITTLE CLEARER</p>
                <h1>Let’s clean things up.</h1>
                <p>One instruction. A clear preview. You’re in control.</p>
              </div>
              <span className="private">
                <ShieldCheck size={16} /> Private, temporary workspace
              </span>
            </div>
            <div role="status" aria-live="polite">
              {notice && (
                <div className="success">
                  <Check size={16} />
                  {notice}
                </div>
              )}
              {running && (
                <div className="status">
                  <span className="spinner" />
                  {busy ||
                    "Generating suggestions… Your current data is unchanged."}
                </div>
              )}
            </div>
            {error && (
              <div role="alert" className="error">
                {error}
                <button
                  className="text"
                  aria-label="Dismiss error"
                  onClick={() => setError("")}
                >
                  <X size={17} />
                </button>
              </div>
            )}
            {config && !config.model_ready && (
              <div className="warning">
                AI is not connected yet. File upload, table preview and export
                are available. The server needs Groq configuration to generate
                cleaning rules.
              </div>
            )}
            <section
              className="card file-card"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!running) uploadFile(e.dataTransfer.files[0]);
              }}
            >
              <div className="file-icon">
                <FileSpreadsheet size={25} />
              </div>
              <div className="file-description">
                <h2>{w?.file?.name || "Upload your spreadsheet"}</h2>
                <p>
                  {w?.file
                    ? `${w.file.row_count.toLocaleString()} rows · ${w.file.columns.length} columns · Sheet: ${w.file.sheet}`
                    : "Drag & drop your file here, or choose a file."}
                </p>
                <small>UTF-8 CSV or XLSX · Max 10 MB</small>
              </div>
              <div className="file-actions">
                <button
                  className={w?.file ? "secondary" : ""}
                  disabled={!!running}
                  onClick={() => {
                    if (
                      !w?.file ||
                      confirm(
                        "Replacing the file discards current cleaning results after the new file is read. Download anything you need first.",
                      )
                    )
                      input.current.click();
                  }}
                >
                  <Upload size={16} />
                  {w?.file ? "Replace file" : "Choose file"}
                </button>
                {w?.file && (
                  <button
                    className="text danger"
                    disabled={!!running}
                    onClick={() => action("remove_file")}
                  >
                    Remove file
                  </button>
                )}
              </div>
            </section>
            {sheetChoices.length > 0 && (
              <section className="card">
                <h2>Choose a sheet to clean.</h2>
                <label>
                  Sheet
                  <select
                    defaultValue=""
                    onChange={(e) =>
                      uploadFile(pending.current, e.target.value)
                    }
                  >
                    <option value="" disabled>
                      Choose a sheet
                    </option>
                    {sheetChoices.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <p className="muted">
                  Only the selected table is exported. Other sheets, formulas
                  and formatting are not preserved.
                </p>
              </section>
            )}
            <section className="card editor">
              <div className="section-heading">
                <h2>
                  <Sparkles size={19} /> What would you like to clean?
                </h2>
                <div>
                  {reviewing && (
                    <button
                      className="text"
                      onClick={() => {
                        clearJob();
                        refresh(w, 1, null);
                      }}
                    >
                      Edit instruction
                    </button>
                  )}
                  <span className="step-label">01 / DESCRIBE</span>
                </div>
              </div>
              <label htmlFor="instruction">Describe what to find</label>
              <textarea
                id="instruction"
                disabled={!!reviewing}
                value={instruction}
                maxLength={2000}
                onChange={(e) => {
                  setInstruction(e.target.value);
                }}
                placeholder="e.g. Find email addresses in the Email column"
                rows={3}
              />
              <div className="examples">
                <span>Try an instruction:</span>
                {[
                  "Find email addresses in the Email column",
                  "Standardise Country values to full English country names",
                  "Identify missing-value markers in the Age column",
                ].map((v, i) => (
                  <button
                    className="example"
                    key={v}
                    onClick={() => {
                      setInstruction(v);
                      if (i === 0) setReplacement("REDACTED");
                    }}
                  >
                    {
                      [
                        "Find & replace",
                        "Standardise values",
                        "Recognise missing values",
                      ][i]
                    }{" "}
                    <ArrowRight size={12} />
                  </button>
                ))}
              </div>
              <div className="replacement">
                <label htmlFor="replacement">
                  Replacement value
                  <input
                    id="replacement"
                    value={replacement}
                    disabled={remove || p1 || reviewing}
                    onChange={(e) => setReplacement(e.target.value)}
                    placeholder="e.g. REDACTED"
                    maxLength={2000}
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={remove}
                    disabled={p1 || reviewing}
                    onChange={(e) => setRemove(e.target.checked)}
                  />
                  Remove matched text
                </label>
              </div>
              <p className="caption left-align">
                {p1
                  ? "Replacement value is only used for regex replacements."
                  : remove
                    ? "Matched text will be removed."
                    : !replacement
                      ? "Enter a replacement value for regex, or choose Remove matched text. AI value cleaning uses suggestions instead."
                      : "Your exact replacement text is used, including spaces."}
              </p>
              <div className="form-bottom">
                <p>
                  <ShieldCheck size={14} /> Your instruction and column names
                  are sent to Groq. Cell values are not sent for regex.
                </p>
                <button
                  className="ai"
                  disabled={!canGenerate}
                  onClick={generate}
                >
                  <Sparkles size={16} />
                  {running ? "Working…" : "Generate preview"}
                </button>
              </div>
            </section>
            {job?.status === "needs_input" && (
              <section className="card">
                <h2>{job.impact.message}</h2>
                <label>
                  Target column
                  <select
                    value={column}
                    onChange={(e) => setColumn(e.target.value)}
                  >
                    <option value="">Choose column</option>
                    {w.file.columns.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name || "Unnamed"} ({c.id})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={!(column || job.target_column_id) || !!running}
                  onClick={() =>
                    run("Updating instruction…", async () =>
                      setJob(
                        await api(`jobs/${job.job_id}/`, {
                          target_column_id: column || job.target_column_id,
                          replacement_value: replacement,
                          base_revision: w.revision,
                        }),
                      ),
                    )
                  }
                >
                  Continue
                </button>
              </section>
            )}
            {job?.status === "awaiting_consent" && (
              <section className="card">
                <p className="eyebrow">02 / REVIEW SCOPE</p>
                <h2>Review data shared with AI</h2>
                <p>
                  Only selected exact values and temporary IDs from{" "}
                  <b>
                    {
                      w.file.columns.find((c) => c.id === job.target_column_id)
                        ?.name
                    }
                  </b>{" "}
                  will be sent to Groq. Counts, neighbouring columns and
                  complete rows stay on this server.
                </p>
                <div className="scope-controls">
                  <label>
                    Search values
                    <input
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setScopePage(1);
                      }}
                      placeholder="Search exact values…"
                    />
                  </label>
                  <span>
                    {scopeInfo?.total || 0} unique values · Select up to 200
                  </span>
                </div>
                <div className="scope-list">
                  {scopeInfo?.items.map((v) => (
                    <label className="scope-item" key={v.id}>
                      <input
                        type="checkbox"
                        checked={scope.some((x) => x.id === v.id)}
                        disabled={
                          !scope.some((x) => x.id === v.id) &&
                          (scope.length >= 200 || v.value.length > 4000)
                        }
                        onChange={(e) =>
                          setScope(
                            e.target.checked
                              ? [...scope, v]
                              : scope.filter((x) => x.id !== v.id),
                          )
                        }
                      />
                      <span title={v.value}>{v.value}</span>
                      <small>{v.occurrences} rows</small>
                    </label>
                  ))}
                </div>
                <div className="pagination">
                  <button
                    className="secondary"
                    disabled={scopePage === 1}
                    onClick={() => setScopePage(scopePage - 1)}
                  >
                    Previous
                  </button>
                  <span>Page {scopePage}</span>
                  <button
                    className="secondary"
                    disabled={
                      scopePage * 50 >= (scopeInfo?.filtered_total || 0)
                    }
                    onClick={() => setScopePage(scopePage + 1)}
                  >
                    Next
                  </button>
                </div>
                <p>
                  {scope.length} values ·{" "}
                  {scope
                    .reduce((n, v) => n + v.value.length, 0)
                    .toLocaleString()}{" "}
                  / 40,000 characters ·{" "}
                  {scope.reduce((n, v) => n + v.occurrences, 0)} candidate rows
                </p>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  I agree to share these selected values with Groq for this
                  cleaning step.
                </label>
                <div className="actions">
                  <button
                    className="secondary"
                    onClick={() =>
                      run("Cancelling…", async () => {
                        await api(`jobs/${job.job_id}/scope-consent/`, {
                          approved: false,
                          base_revision: w.revision,
                        });
                        clearJob();
                      })
                    }
                  >
                    Cancel
                  </button>
                  <button
                    className="ai"
                    disabled={
                      !consent ||
                      !scope.length ||
                      scope.reduce((n, v) => n + v.value.length, 0) > 40000 ||
                      !!running
                    }
                    onClick={() =>
                      run("Sharing selected values…", async () => {
                        await api(`jobs/${job.job_id}/scope-consent/`, {
                          approved: true,
                          selected_value_ids: scope.map((v) => v.id),
                          scope_hash: job.scope_hash,
                          base_revision: w.revision,
                        });
                        setJob({ ...job, status: "queued" });
                      })
                    }
                  >
                    Share selected values & generate suggestions
                  </button>
                </div>
              </section>
            )}
            {job?.status === "ready" && p1 && (
              <section className="card">
                <div className="section-heading">
                  <h2>
                    Review{" "}
                    {job.operation === "normalise_missing"
                      ? "missing values"
                      : "suggestions"}
                  </h2>
                  <span className="step-label">02 / REVIEW</span>
                </div>
                <p>
                  Nothing has been changed yet. Every suggestion starts with
                  Keep.
                </p>
                {job.impact.partial_scope && (
                  <p className="warning">
                    Only selected values were processed. Other values remain
                    unchanged.
                  </p>
                )}
                {job.impact.consistency_reference && (
                  <p>
                    Previous approved mappings are considered locally for
                    consistency.
                  </p>
                )}
                <div className="actions">
                  <button
                    className="secondary"
                    onClick={() =>
                      setSelected(
                        suggestions
                          .filter(
                            (s) =>
                              s.ai_status ===
                              (job.operation === "normalise_missing"
                                ? "missing"
                                : "proposed"),
                          )
                          .map((s) => s.id),
                      )
                    }
                  >
                    Select all{" "}
                    {
                      suggestions.filter(
                        (s) =>
                          s.ai_status ===
                          (job.operation === "normalise_missing"
                            ? "missing"
                            : "proposed"),
                      ).length
                    }{" "}
                    eligible suggestions
                  </button>
                  <button className="text" onClick={() => setSelected([])}>
                    Keep all
                  </button>
                </div>
                <div className="table-wrap">
                  <table className="suggestion-table">
                    <thead>
                      <tr>
                        {[
                          "Original value",
                          "Proposed value",
                          "Occurrences",
                          "AI status / Reason",
                          "Action",
                        ].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {suggestions.map((s) => (
                        <tr key={s.id}>
                          <td>{s.original}</td>
                          <td>
                            {job.operation === "normalise_missing" ? (
                              <i className="null">
                                {s.ai_status === "valid"
                                  ? "Keep value"
                                  : "null (if approved)"}
                              </i>
                            ) : (
                              s.proposed
                            )}
                          </td>
                          <td>{s.occurrences}</td>
                          <td>
                            <span className={"badge " + s.ai_status}>
                              {s.ai_status.replace("_", " ")}
                            </span>
                            <small className="reason">{s.reason}</small>
                          </td>
                          <td>
                            <select
                              aria-label={`Action for ${s.original}`}
                              disabled={["valid", "unchanged"].includes(
                                s.ai_status,
                              )}
                              value={selected.includes(s.id) ? "apply" : "keep"}
                              onChange={(e) =>
                                setSelected(
                                  e.target.value === "apply"
                                    ? [...selected, s.id]
                                    : selected.filter((id) => id !== s.id),
                                )
                              }
                            >
                              <option value="keep">Keep</option>
                              <option value="apply">
                                {job.operation === "normalise_missing"
                                  ? "Treat as missing"
                                  : "Apply"}
                              </option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="review-bottom">
                  <span>
                    {selected.length} suggestions selected ·{" "}
                    {suggestions
                      .filter((s) => selected.includes(s.id))
                      .reduce((n, s) => n + s.occurrences, 0)}{" "}
                    rows may change
                  </span>
                  <button
                    disabled={!selected.length || !!running}
                    onClick={() => apply()}
                  >
                    Apply selected changes <Check size={16} />
                  </button>
                </div>
              </section>
            )}
            {table && (
              <section className="card table-card">
                <div className="section-heading">
                  <div>
                    <h2>
                      {job?.status === "ready" &&
                      job.operation === "regex_replace"
                        ? "Review your changes"
                        : applied
                          ? "Your cleaned data"
                          : "Your data"}
                    </h2>
                    <p>
                      {job?.status === "ready" &&
                      job.operation === "regex_replace"
                        ? `${job.impact.matches} matches · ${job.impact.changed_rows} rows affected · Preview only, not applied`
                        : applied
                          ? "Changes applied. Ready when you are."
                          : "A snapshot of your current table."}
                    </p>
                  </div>
                  <span className="step-label">
                    {job?.status === "ready" ? "02 / REVIEW" : "TABLE PREVIEW"}
                  </span>
                </div>
                {applied ||
                (job?.status === "ready" &&
                  job.operation === "regex_replace") ? (
                  <>
                    {!applied && (
                      <>
                        <div className="rule-row">
                          <details>
                            <summary>Show rule</summary>
                            <code>{job.plan.pattern}</code>
                            <p>
                              Flags: {job.plan.flags.join(", ") || "none"} ·
                              Replacement:{" "}
                              {job.action === "remove"
                                ? "empty text"
                                : job.replacement_value}
                            </p>
                          </details>
                          {positions.length > 0 && (
                            <div className="match-nav">
                              <button
                                className="secondary icon"
                                aria-label="Previous match"
                                onClick={() => navigateMatch(-1)}
                              >
                                <ChevronLeft size={16} />
                              </button>
                              <span>
                                Match {match + 1} of {positions.length}
                              </span>
                              <button
                                className="secondary icon"
                                aria-label="Next match"
                                onClick={() => navigateMatch(1)}
                              >
                                <ChevronRight size={16} />
                              </button>
                            </div>
                          )}
                        </div>
                        {job.impact.risk.requires_confirmation && (
                          <p className="warning">
                            This change may affect more data than expected.{" "}
                            {job.impact.risk.signals.join(" ")}
                          </p>
                        )}
                        {job.impact.matches === 0 && (
                          <p className="status">
                            0 matches found. No data was changed.
                          </p>
                        )}
                      </>
                    )}
                    <div className="dual">
                      <div className="pane original">
                        <h3>Original · Before this step</h3>
                        <Table
                          headers={table.headers}
                          rows={table.before}
                          before={table.rows}
                          offset={table.offset}
                          active={active}
                          highlights={positions}
                          scrollRef={left}
                          onScroll={() => scroll(left, right)}
                        />
                      </div>
                      <div className="pane preview">
                        <h3>
                          {applied
                            ? "Applied · After this step"
                            : "Preview · After this step"}
                        </h3>
                        <Table
                          headers={table.headers}
                          rows={table.rows}
                          before={table.before}
                          offset={table.offset}
                          active={active}
                          highlights={positions}
                          after
                          scrollRef={right}
                          onScroll={() => scroll(right, left)}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <Table
                    headers={table.headers}
                    rows={table.rows}
                    offset={table.offset}
                  />
                )}
                <div className="pagination">
                  <span>
                    {table.row_count ? table.offset + 1 : 0}–
                    {Math.min(table.offset + 50, table.row_count)} of{" "}
                    {table.row_count.toLocaleString()} rows
                  </span>
                  <div>
                    <button
                      className="secondary icon"
                      aria-label="Previous page"
                      disabled={page <= 1}
                      onClick={() =>
                        run("Loading rows…", () => refresh(w, page - 1))
                      }
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span>Page {page}</span>
                    <button
                      className="secondary icon"
                      aria-label="Next page"
                      disabled={page * 50 >= table.row_count}
                      onClick={() =>
                        run("Loading rows…", () => refresh(w, page + 1))
                      }
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
                {job?.status === "ready" &&
                  job.operation === "regex_replace" &&
                  job.impact.changed_rows > 0 && (
                    <div className="review-bottom">
                      <span>
                        Review the preview before changing your current data.
                      </span>
                      <button disabled={!!running} onClick={() => apply()}>
                        Apply changes <Check size={16} />
                      </button>
                    </div>
                  )}
              </section>
            )}
            {w?.file && (
              <section className="card export-card">
                <div>
                  <h2>
                    <Download size={19} />{" "}
                    {applied
                      ? "Ready to take it with you?"
                      : "Download current data"}
                  </h2>
                  <p>
                    Only applied changes are included. Your original upload is
                    unchanged.
                  </p>
                </div>
                <div className="actions">
                  <label className="visually-hidden" htmlFor="format">
                    Download format
                  </label>
                  <select
                    id="format"
                    value={format}
                    onChange={(e) => setFormat(e.target.value)}
                  >
                    <option value="csv">CSV</option>
                    <option value="xlsx">Excel (.xlsx)</option>
                  </select>
                  <a
                    className="button"
                    href={`/api/workspaces/${w.workspace_id}/export/?format=${format}`}
                  >
                    Download {applied ? "cleaned file" : "current data"}{" "}
                    <Download size={16} />
                  </a>
                </div>
                <p className="export-note">
                  Cleaned Data Export includes only the selected table. Other
                  sheets, formulas and formatting are not preserved. CSV and
                  XLSX represent missing values as blank cells; re-import may
                  not distinguish null from an empty string. Text that could
                  execute as a spreadsheet formula is escaped in CSV.
                </p>
                <div className="secondary-actions">
                  <button
                    className="text"
                    onClick={() => {
                      clearJob();
                      setNotice("Continue with your current cleaned data.");
                      refresh(w, 1, null);
                      document.getElementById("instruction").focus();
                    }}
                  >
                    Continue cleaning <ArrowRight size={14} />
                  </button>
                  <button
                    className="text"
                    disabled={!w.can_undo || !!running}
                    onClick={() => action("undo")}
                  >
                    <Undo2 size={14} /> Undo last change
                  </button>
                  <button
                    className="text"
                    disabled={!!running}
                    onClick={() => action("reset")}
                  >
                    <RotateCcw size={14} /> Reset to original
                  </button>
                </div>
              </section>
            )}
          </main>
        </>
      )}
      <footer>
        <p>Files are temporary. Download your results promptly.</p>
        <span>RegexGenie · A little magic for your spreadsheets.</span>
      </footer>
      <dialog ref={dialog} onCancel={() => setRisk(false)}>
        <div className="dialog-content">
          <p className="eyebrow">REVIEW BEFORE APPLYING</p>
          <h2>This change may affect more data than expected</h2>
          <p>{job?.impact?.risk?.signals.join(" ")}</p>
          <p>{job?.impact?.changed_rows} rows will change.</p>
          {table &&
            table.rows
              .map((r, i) =>
                JSON.stringify(r) !== JSON.stringify(table.before[i]) ? (
                  <p key={i} className="risk-sample">
                    Before: {JSON.stringify(table.before[i])}
                    <br />
                    After: {JSON.stringify(r)}
                  </p>
                ) : null,
              )
              .filter(Boolean)
              .slice(0, 2)}
          <div className="actions">
            <button className="secondary" onClick={() => setRisk(false)}>
              Go back
            </button>
            <button onClick={() => apply(true)}>
              I reviewed the changes — Apply
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
if (document.getElementById("root"))
  createRoot(document.getElementById("root")).render(<App />);
