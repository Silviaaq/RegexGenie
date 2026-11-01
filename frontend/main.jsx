import React, { useState, useRef, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Upload,
  FileSpreadsheet,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Download,
  Plus,
  ShieldCheck,
  Command,
  Columns2,
  Code2,
  X,
  Copy,
  Loader2,
  Info,
  AlertCircle,
  Trash2,
  SlidersHorizontal,
} from "lucide-react";
import { EXAMPLES, SAMPLE } from "./data";
import { utf16 } from "./utils";
import "./style.css";
async function api(path, options = {}) {
  const token = document.cookie.match(/csrftoken=([^;]+)/)?.[1];
  let res = await fetch("/api" + path, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      "X-CSRFToken": token || "",
      ...options.headers,
    },
  });
  if (!res.ok) {
    let e = await res.json().catch(() => ({
      message: "The service is unavailable. Please try again.",
    }));
    throw Error(e.message);
  }
  return res.json();
}
export function App() {
  const [data, setData] = useState(null),
    [book, setBook] = useState(null),
    [file, setFile] = useState(""),
    [sheet, setSheet] = useState(""),
    [instruction, setInstruction] = useState(""),
    [replacement, setReplacement] = useState(""),
    [override, setOverride] = useState(false),
    [result, setResult] = useState(null),
    [view, setView] = useState("upload"),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [page, setPage] = useState(0),
    [active, setActive] = useState(0),
    [rules, setRules] = useState(false),
    [download, setDownload] = useState(false),
    [modal, setModal] = useState(""),
    [toast, setToast] = useState(""),
    [drag, setDrag] = useState(false),
    [density, setDensity] = useState("comfortable"),
    [expires, setExpires] = useState(0);
  const input = useRef(),
    panels = useRef([]),
    sequence = useRef(0),
    scrolling = useRef(false);
  const [ready, setReady] = useState(false),
    [activeMatch, setActiveMatch] = useState(null);
  const size = 50;
  const matchMap = useMemo(() => {
    const map = new Map();
    for (const m of result?.matches || []) {
      let key = m.row + "-" + m.col;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(m);
    }
    return map;
  }, [result]);
  useEffect(() => {
    api("/config")
      .then((c) => {
        setReady(true);
        if (!c.model_ready)
          setError(
            "The AI service is not configured yet. Uploads work, but previews need a Groq connection.",
          );
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!expires) return;
    const t = setInterval(() => {
      if (Date.now() > expires) {
        sequence.current++;
        setData(null);
        setBook(null);
        setResult(null);
        setBusy("");
        setView("upload");
        setError("Your file has expired. Upload it again to continue.");
        setExpires(0);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [expires]);
  async function upload(f) {
    if (!f || busy || !ready) return;
    if (f.size > 2 * 1024 * 1024) {
      setError("This file exceeds 2 MB. Split it into smaller files.");
      return;
    }
    if (!/\.(csv|xlsx)$/i.test(f.name)) {
      setError("Choose a CSV or .xlsx file.");
      return;
    }
    const seq = ++sequence.current;
    setBusy("Parsing file");
    setError("");
    try {
      const form = new FormData();
      form.append("file", f);
      const b = await api("/datasets", { method: "POST", body: form });
      if (seq !== sequence.current) return;
      const previous = book;
      setBook(b);
      setFile(f.name);
      setSheet(b.sheets[0]);
      setData(null);
      setResult(null);
      setView("upload");
      setPage(0);
      setActiveMatch(null);
      setExpires(Date.parse(b.expires_at));
      if (previous)
        await api(`/datasets/${previous.dataset_id}`, {
          method: "DELETE",
        }).catch(() => {});
      await selectLive(b, b.sheets[0], seq);
    } catch (e) {
      if (seq === sequence.current) setError(e.message);
    } finally {
      if (seq === sequence.current) setBusy("");
    }
  }
  async function selectLive(b, s, seq = sequence.current) {
    const d = await api(`/datasets/${b.dataset_id}/select-sheet`, {
      method: "POST",
      body: JSON.stringify({ sheet_id: s }),
    });
    if (seq === sequence.current) setData(d);
  }
  async function changeSheet(s) {
    if (busy) return;
    const seq = ++sequence.current;
    setBusy("Parsing sheet");
    setError("");
    setSheet(s);
    setData(null);
    setResult(null);
    setPage(0);
    try {
      await selectLive(book, s, seq);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  function sample() {
    upload(new File([SAMPLE], "customer_directory.csv", { type: "text/csv" }));
    setInstruction(EXAMPLES[0].instruction);
  }
  async function generate() {
    if (busy || !data || !instruction.trim()) return;
    setBusy("Generating preview");
    setError("");
    const seq = ++sequence.current;
    try {
      const r = await api("/transformations", {
        method: "POST",
        body: JSON.stringify({
          dataset_id: book.dataset_id,
          sheet_id: sheet,
          dataset_version: data.dataset_version,
          instruction,
          ...(override ? { replacement } : {}),
        }),
      });
      let first = r.matches[0] || null,
        n = 0;
      if (r.target_count && !first) {
        first = await api(`/transformations/${r.id}/targets/1`);
        n = Math.floor(first.row / size);
        const batch = await api(
          `/transformations/${r.id}/rows?offset=${n * size}&limit=${size}`,
        );
        r.rows = batch.processed;
        r.original = batch.original;
        r.matches = batch.matches;
      }
      if (seq !== sequence.current) return;
      setResult(r);
      setData((d) => ({ ...d, rows: r.original }));
      setView("result");
      setPage(n);
      setActive(0);
      setActiveMatch(first);
      setRules(false);
      window.scrollTo({ top: 0 });
    } catch (e) {
      if (seq === sequence.current) setError(e.message);
    } finally {
      if (seq === sequence.current) setBusy("");
    }
  }
  async function loadPage(n) {
    if (busy) return;
    setBusy("Loading rows");
    setError("");
    const seq = ++sequence.current;
    try {
      if (view === "result") {
        const r = await api(
          `/transformations/${result.id}/rows?offset=${n * size}&limit=${size}`,
        );
        if (seq !== sequence.current) return;
        setResult((prev) => ({
          ...prev,
          rows: r.processed,
          matches: r.matches,
        }));
        setData((prev) => ({ ...prev, rows: r.original }));
      } else {
        const r = await api(
          `/datasets/${book.dataset_id}/rows?sheet_id=${encodeURIComponent(sheet)}&offset=${n * size}&limit=${size}`,
        );
        if (seq !== sequence.current) return;
        setData((prev) => ({ ...prev, rows: r.rows }));
      }
      setPage(n);
    } catch (e) {
      if (seq === sequence.current) setError(e.message);
    } finally {
      if (seq === sequence.current) setBusy("");
    }
  }
  async function navigate(i) {
    if (busy) return;
    setBusy("Locating match");
    setError("");
    const seq = ++sequence.current;
    try {
      const m = await api(`/transformations/${result.id}/targets/${i + 1}`);
      if (seq !== sequence.current) return;
      const n = Math.floor(m.row / size);
      if (n !== page) {
        const r = await api(
          `/transformations/${result.id}/rows?offset=${n * size}&limit=${size}`,
        );
        if (seq !== sequence.current) return;
        setResult((prev) => ({
          ...prev,
          rows: r.processed,
          matches: r.matches,
        }));
        setData((prev) => ({ ...prev, rows: r.original }));
        setPage(n);
      }
      setActive(i);
      setActiveMatch(m);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    if (view !== "result" || !activeMatch) return;
    requestAnimationFrame(() =>
      panels.current.forEach((p) => {
        const cell = p?.querySelector(
          `[data-cell="${activeMatch.row}-${activeMatch.col}"]`,
        );
        if (cell) {
          p.scrollTop = Math.max(
            0,
            p.scrollTop +
              cell.getBoundingClientRect().top -
              p.getBoundingClientRect().top -
              p.clientHeight / 2,
          );
          p.scrollLeft = Math.max(
            0,
            p.scrollLeft +
              cell.getBoundingClientRect().left -
              p.getBoundingClientRect().left -
              65,
          );
        }
      }),
    );
  }, [activeMatch, view, page]);
  function syncScroll(side) {
    if (scrolling.current) return;
    const from = panels.current[side],
      to = panels.current[1 - side];
    if (!to || view !== "result") return;
    scrolling.current = true;
    to.scrollTop = from.scrollTop;
    to.scrollLeft = from.scrollLeft;
    requestAnimationFrame(() => {
      scrolling.current = false;
    });
  }
  async function remove() {
    if (busy) return;
    setBusy("Deleting file");
    sequence.current++;
    try {
      if (book) await api(`/datasets/${book.dataset_id}`, { method: "DELETE" });
      reset();
      setToast("File and results deleted.");
    } catch (e) {
      setError(e.message);
      setModal("");
    } finally {
      setBusy("");
    }
  }
  function reset() {
    setData(null);
    setBook(null);
    setResult(null);
    setFile("");
    setSheet("");
    setInstruction("");
    setReplacement("");
    setOverride(false);
    setView("upload");
    setError("");
    setExpires(0);
    setModal("");
    setActiveMatch(null);
  }
  async function save(format) {
    if (busy) return;
    setDownload(false);
    setBusy("Preparing download");
    setError("");
    try {
      const res = await fetch(
        `/api/transformations/${result.id}/download?format=${format}`,
      );
      if (!res.ok) {
        const e = await res.json();
        throw Error(e.message);
      }
      const blob = await res.blob(),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download =
        file.replace(/\.[^.]+$/, "").replace(/[\\/\x00-\x1f]/g, "_") +
        "_processed." +
        format;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setToast("Download ready. Check your browser downloads.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  async function edit() {
    if (busy) return;
    const seq = ++sequence.current;
    setBusy("Loading original");
    setError("");
    try {
      await selectLive(book, sheet, seq);
      if (seq !== sequence.current) return;
      setPage(0);
      setView("upload");
      setDownload(false);
      setResult(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  const current = activeMatch,
    count = result?.target_count || 0,
    rows = data?.row_count || data?.rows.length || 0,
    isResult = view === "result" && result;
  function renderCell(value, r, c, side) {
    if (!isResult) return value || <span className="empty-cell">—</span>;
    const all = matchMap.get(r + "-" + c) || [];
    if (!all.length) return value || <span className="empty-cell">—</span>;
    let nodes = [],
      last = 0;
    all.forEach((m, i) => {
      let start = side ? m.result_start : m.start,
        end = side ? m.result_end : m.end;
      start = utf16(value, start);
      end = utf16(value, end);
      let selected = m.ordinal === current?.ordinal;
      nodes.push(value.slice(last, start));
      nodes.push(
        <mark
          key={i}
          className={selected ? "current" : ""}
          title={side && start === end ? "Content removed" : undefined}
        >
          {start === end ? (
            <span className="deleted">∅</span>
          ) : (
            value.slice(start, end)
          )}
        </mark>,
      );
      last = end;
    });
    nodes.push(value.slice(last));
    return nodes;
  }
  function table(side = 0) {
    const source = side ? result.rows : data.rows;
    return (
      <div
        className={"table-scroll " + density}
        onScroll={() => syncScroll(side)}
        ref={(el) => (panels.current[side] = el)}
      >
        <table>
          <thead>
            <tr>
              <th className="row-num">#</th>
              {data.headers.map((h, c) => (
                <th
                  key={c}
                  style={{
                    width: h === "ID" ? 70 : h === "Email" ? 290 : 160,
                    minWidth: h === "ID" ? 70 : h === "Email" ? 290 : 160,
                    maxWidth: h === "ID" ? 70 : h === "Email" ? 290 : 160,
                  }}
                  className={isResult && result.col === c ? "target-head" : ""}
                >
                  <span className="type">{h === "ID" ? "#" : "Aa"}</span>
                  {h || "Unnamed column"}
                  {isResult && result.col === c && <span className="col-dot" />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {source.map((row, ri) => {
              let r = page * size + ri;
              return (
                <tr
                  key={r}
                  className={isResult && current?.row === r ? "active-row" : ""}
                >
                  <td className="row-num">{r + 1}</td>
                  {row.map((v, c) => (
                    <td
                      key={c}
                      data-cell={`${r}-${c}`}
                      title={v}
                      style={{
                        width:
                          data.headers[c] === "ID"
                            ? 70
                            : data.headers[c] === "Email"
                              ? 290
                              : 160,
                        minWidth:
                          data.headers[c] === "ID"
                            ? 70
                            : data.headers[c] === "Email"
                              ? 290
                              : 160,
                        maxWidth:
                          data.headers[c] === "ID"
                            ? 70
                            : data.headers[c] === "Email"
                              ? 290
                              : 160,
                      }}
                    >
                      {renderCell(v, r, c, side)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="RegexGenie home">
          <span className="brand-icon">
            <span />
            <span />
            <span />
          </span>
          RegexGenie<span className="brand-period">.</span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <button
          className="side-active"
          disabled={!!busy}
          onClick={() => {
            if (result) setView("result");
          }}
        >
          <Columns2 size={17} />
          Data cleaner
          <span className="side-dot" />
        </button>
        <div className="side-note">
          <span className="thin-line" />
          <p>
            A little less noise.
            <br />A lot more clarity.
          </p>
        </div>
        <div className="sidebar-bottom">
          <div className="mode-dot" />
          AI workspace
          <button
            title="About this workspace"
            onClick={() => setModal("about")}
          >
            <Info size={15} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace
            <ChevronRight size={14} />
            <span>Data cleaner</span>
          </div>
          <button className="quiet help" onClick={() => setModal("guide")}>
            Quick guide
            <ArrowUpRight size={14} />
          </button>
        </header>
        <main>
          <div className="page-top">
            <div>
              <div className="eyebrow">
                DATA WORKSPACE <span>/</span>{" "}
                {isResult ? "02 — REVIEW" : "01 — PREPARE"}
              </div>
              <h1>
                {isResult
                  ? "A clear view of every change."
                  : "Clean data. Clear intent."}
              </h1>
              <p className="subtitle">
                {isResult
                  ? "Compare your results, then download when everything looks right."
                  : "Upload your data. Describe a change. Review the difference."}
              </p>
            </div>
            <div className="steps">
              <span className={!isResult ? "step active" : "step complete"}>
                <i>{isResult ? <Check size={12} /> : 1}</i>Prepare
              </span>
              <span className="step-line" />
              <span className={isResult ? "step active" : "step"}>
                <i>2</i>Review
              </span>
            </div>
          </div>
          {error && (
            <div className="error" role="alert">
              <AlertCircle size={18} />
              <div>
                <strong>Let’s adjust one thing</strong>
                <p>{error}</p>
              </div>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {!isResult ? (
            <>
              {!data && book && (
                <div className="file-bar">
                  <strong>{file}</strong>
                  <select
                    aria-label="Select sheet"
                    value={sheet}
                    onChange={(e) => changeSheet(e.target.value)}
                    disabled={!!busy}
                  >
                    {book.sheets.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <button className="quiet" onClick={() => setModal("delete")}>
                    Delete File & Results
                  </button>
                </div>
              )}
              {!data ? (
                <section
                  className={"upload-card " + (drag ? "dragging" : "")}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDrag(true);
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDrag(false);
                    if (!busy) upload(e.dataTransfer.files[0]);
                  }}
                >
                  <div className="upload-icon">
                    {busy ? (
                      <Loader2 className="spin" size={26} />
                    ) : (
                      <Upload size={26} />
                    )}
                  </div>
                  <h2>{busy || "Your next clean dataset starts here"}</h2>
                  <p>Drag and drop your file, or browse to upload.</p>
                  <button
                    className="primary"
                    onClick={() => input.current.click()}
                    disabled={!!busy || !ready}
                  >
                    <Plus size={16} />
                    Choose file
                  </button>
                  <div className="file-limits">
                    CSV or .xlsx <span>·</span> Max 2 MB · Up to 5,000 rows and
                    50 columns
                  </div>
                  <div className="sample-row">
                    <span>Just exploring?</span>
                    <button
                      className="text-button"
                      onClick={sample}
                      disabled={!!busy || !ready}
                    >
                      Try Sample Data
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </section>
              ) : (
                <section className="data-card">
                  <div className="file-bar">
                    <div className="file-icon">
                      <FileSpreadsheet size={21} />
                    </div>
                    <div className="file-title">
                      <strong>{file}</strong>
                      <span>
                        {rows.toLocaleString()} rows <b>·</b>{" "}
                        {data.headers.length} columns <b>·</b> Original file
                      </span>
                    </div>
                    {book.sheets.length > 1 && (
                      <select
                        aria-label="Select sheet"
                        value={sheet}
                        onChange={(e) => changeSheet(e.target.value)}
                        disabled={!!busy}
                      >
                        {book.sheets.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    )}
                    <button
                      className="secondary small"
                      disabled={!!busy}
                      onClick={() => input.current.click()}
                    >
                      Replace file
                    </button>
                  </div>
                  {data.warning && (
                    <div className="warning">{data.warning}</div>
                  )}
                  <div className="table-title">
                    <span>Original data</span>
                    <span className="table-caption">READ-ONLY PREVIEW</span>
                  </div>
                  {table()}
                  <div className="table-footer">
                    <span>{rows.toLocaleString()} rows</span>
                    <span>Original data is never overwritten.</span>
                    {pager()}
                  </div>
                </section>
              )}
              {!data && (
                <div className="principles">
                  <div>
                    <span className="principle-icon">
                      <Command size={18} />
                    </span>
                    <strong>Describe, don’t configure</strong>
                    <p>
                      Use plain language to tell us what
                      <br />
                      you’d like to change.
                    </p>
                  </div>
                  <div>
                    <span className="principle-icon">
                      <Columns2 size={18} />
                    </span>
                    <strong>See the difference</strong>
                    <p>
                      Review original and cleaned data
                      <br />
                      side by side, before downloading.
                    </p>
                  </div>
                  <div>
                    <span className="principle-icon">
                      <ShieldCheck size={18} />
                    </span>
                    <strong>You’re in control</strong>
                    <p>
                      Your original stays untouched.
                      <br />
                      Export only when you’re ready.
                    </p>
                  </div>
                </div>
              )}
              <section className="instruction-panel">
                <div className="instruction-heading">
                  <h2>
                    <span className="command-symbol">⌘</span>What would you like
                    to change?
                  </h2>
                  <span>ONE INSTRUCTION AT A TIME</span>
                </div>
                <div className="input-wrap">
                  <textarea
                    aria-label="Cleaning instruction"
                    maxLength={2000}
                    placeholder="e.g. Find email addresses in the Email column and replace them with 'REDACTED'."
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    disabled={!!busy}
                  />
                </div>
                <div className="examples">
                  <span>Try an example</span>
                  {EXAMPLES.map((x, i) => (
                    <button
                      key={i}
                      disabled={!!busy}
                      onClick={() => {
                        setInstruction(x.instruction);
                        setError("");
                      }}
                    >
                      {x.label}
                      <ArrowUpRight size={12} />
                    </button>
                  ))}
                  <button
                    className="copy-example"
                    title="Copy first example"
                    onClick={() => {
                      navigator.clipboard
                        .writeText(EXAMPLES[0].instruction)
                        .then(() => setToast("Example copied."))
                        .catch(() => setToast("Select an example to use it."));
                    }}
                  >
                    <Copy size={13} />
                  </button>
                </div>
                <div className="instruction-bottom">
                  <div className="replacement">
                    <label htmlFor="replace">
                      Replacement value <span>optional</span>
                    </label>
                    <div>
                      <input
                        id="replace"
                        maxLength={2000}
                        placeholder="Use value from instruction"
                        value={replacement}
                        onChange={(e) => {
                          setReplacement(e.target.value);
                          setOverride(e.target.value !== "");
                        }}
                        disabled={!!busy}
                      />
                      <label className="delete-check">
                        <input
                          type="checkbox"
                          disabled={!!busy}
                          checked={override && replacement === ""}
                          onChange={(e) => {
                            setOverride(e.target.checked);
                            setReplacement("");
                          }}
                        />
                        Replace with empty text
                      </label>
                    </div>
                  </div>
                  <button
                    className="primary generate"
                    disabled={!data || !instruction.trim() || !!busy}
                    onClick={generate}
                  >
                    {busy ? (
                      <Loader2 size={16} className="spin" />
                    ) : (
                      <span className="sparkle" aria-hidden="true">
                        ✧
                      </span>
                    )}
                    {busy || "Generate Preview"}
                    {!busy && <ArrowRight size={16} />}
                  </button>
                </div>
                <div className="privacy">
                  <ShieldCheck size={13} />
                  Avoid entering sensitive information in your instruction.
                  {data && (
                    <button onClick={() => setModal("delete")}>
                      Delete File & Results
                    </button>
                  )}
                </div>
              </section>
            </>
          ) : (
            <>
              <section className="result-info">
                <div className="result-file">
                  <FileSpreadsheet size={18} />
                  <strong>{file}</strong>
                  <span className="chip">{sheet}</span>
                  <span className="success-chip">
                    <Check size={12} />
                    Preview ready
                  </span>
                </div>
                <div className="interpretation">
                  <span className="interpret-icon">↳</span>
                  <p>
                    <span>Interpreted as:</span> {result.interpretation}
                  </p>
                  <button
                    className="quiet"
                    aria-expanded={rules}
                    onClick={() => setRules(!rules)}
                  >
                    <Code2 size={14} />
                    Show rule
                    <ChevronDown size={13} className={rules ? "rotate" : ""} />
                  </button>
                </div>
                {rules && (
                  <pre className="rule">
                    {JSON.stringify(result.plan, null, 2)}
                  </pre>
                )}
              </section>
              <div className="comparison-toolbar">
                <div className="result-count">
                  <span className="blue-dot" />
                  Matches<strong>{count.toLocaleString()}</strong>
                  <span className="divider" />
                  {result.changed_cells.toLocaleString()} cells changed
                </div>
                <div className="match-nav">
                  <span className="match-text">
                    {current?.text || "No matches"}
                  </span>
                  <span className="fraction">{`${count ? active + 1 : 0}/${count}`}</span>
                  <button
                    aria-label="Previous match"
                    disabled={!!busy || !current || active === 0}
                    onClick={() => navigate(active - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    aria-label="Next match"
                    disabled={!!busy || !current || active === count - 1}
                    onClick={() => navigate(active + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
              {!count && (
                <div className="zero-state">
                  <Info size={16} />
                  No matches found. Your data is unchanged. You can edit your
                  instruction or download this result.
                </div>
              )}
              <div className="comparison">
                {[0, 1].map((side) => (
                  <section className="compare-panel" key={side}>
                    <div className="compare-title">
                      <div>
                        <span className={"panel-dot " + (side ? "blue" : "")} />
                        <h2>{side ? "Preview" : "Original"}</h2>
                      </div>
                      <span>{side ? "PROPOSED CHANGES" : "UNMODIFIED"}</span>
                    </div>
                    {table(side)}
                    <div className="table-footer">
                      <span>{rows.toLocaleString()} rows</span>
                      <span>
                        {side
                          ? "Changes are highlighted"
                          : "Your source, preserved"}
                      </span>
                    </div>
                  </section>
                ))}
              </div>
              <div className="comparison-bottom">
                <div className="legend">
                  <span>
                    <i className="legend-match" />
                    Match
                  </span>
                  <span>
                    <i className="legend-current" />
                    Current match
                  </span>
                  <span>
                    <i className="legend-deleted">∅</i>Removed
                  </span>
                </div>
                <button
                  className="quiet density"
                  onClick={() =>
                    setDensity(
                      density === "comfortable" ? "compact" : "comfortable",
                    )
                  }
                >
                  <SlidersHorizontal size={13} />
                  {density === "comfortable" ? "Comfortable" : "Compact"}
                </button>
                {pager()}
              </div>
              <div className="result-actions">
                <button
                  className="delete-link"
                  onClick={() => setModal("delete")}
                >
                  <Trash2 size={13} />
                  Delete File & Results
                </button>
                <div className="action-right">
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={edit}
                  >
                    <ArrowLeft size={15} />
                    Edit Instruction
                  </button>
                  <div className="download-wrap">
                    <button
                      className="primary"
                      disabled={!!busy}
                      onClick={() => setDownload(!download)}
                      aria-expanded={download}
                    >
                      <Download size={16} />
                      Download
                      <ChevronDown size={14} />
                    </button>
                    {download && (
                      <div className="download-menu">
                        <span>DOWNLOAD FULL RESULT</span>
                        <button onClick={() => save("csv")}>
                          <FileSpreadsheet size={17} />
                          <div>
                            CSV<span>UTF-8 · Universal compatibility</span>
                          </div>
                        </button>
                        <button onClick={() => save("xlsx")}>
                          <FileSpreadsheet size={17} />
                          <div>
                            Excel<span>.xlsx · Values stored as text</span>
                          </div>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="result-footnote">
                <ShieldCheck size={13} />
                Files are temporary. Download your results promptly. You may
                need to upload again if the service sleeps or restarts. Download
                includes all rows, not just this page.
              </div>
            </>
          )}
          <input
            ref={input}
            type="file"
            accept=".csv,.xlsx"
            hidden
            onChange={(e) => {
              upload(e.target.files[0]);
              e.target.value = "";
            }}
          />
          <p className="temporary-note">
            Files are temporary. Download your results promptly. You may need to
            upload again if the service sleeps or restarts.
          </p>
          <footer className="footer">
            <span>
              REGEXGENIE <span className="footer-separator">/</span> A little
              clarity goes a long way.
            </span>
            <span>
              CSV & Excel <span>·</span> One change at a time
            </span>
          </footer>
        </main>
      </div>
      {busy && (
        <div className="busy-status" role="status">
          <Loader2 size={14} className="spin" />
          {busy}…
        </div>
      )}
      {toast && (
        <div role="status" className="toast">
          <Check size={15} />
          {toast}
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal("")}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Close dialog"
              onClick={() => setModal("")}
            >
              <X size={18} />
            </button>
            <h2 id="modal-title">
              {modal === "delete"
                ? "Delete this workspace?"
                : modal === "guide"
                  ? "From raw data to ready."
                  : "A precise preview. An honest boundary."}
            </h2>
            {modal === "delete" ? (
              <>
                <p>
                  This removes the current file and all generated results.
                  Download anything you need before continuing.
                </p>
                <div className="modal-actions">
                  <button className="secondary" onClick={() => setModal("")}>
                    Keep working
                  </button>
                  <button
                    className="primary danger"
                    disabled={!!busy}
                    onClick={remove}
                  >
                    Delete File & Results
                  </button>
                </div>
              </>
            ) : modal === "guide" ? (
              <>
                <ol>
                  <li>
                    <strong>Upload your data.</strong> Choose one CSV or Excel
                    sheet.
                  </li>
                  <li>
                    <strong>Describe one change.</strong> Name the target column
                    and replacement value.
                  </li>
                  <li>
                    <strong>Review the difference.</strong> Blue highlights show
                    matched content. Use the arrows to move between matches.
                  </li>
                  <li>
                    <strong>Download.</strong> Export the full result as CSV or
                    Excel.
                  </li>
                </ol>
                <p>
                  Use “Replace with empty text” to remove matched content. New
                  previews always start from the original file.
                </p>
              </>
            ) : (
              <>
                <p>
                  RegexGenie uses a Django API to validate and execute
                  model-generated regex rules.
                </p>
                <p>
                  Only the instruction, optional replacement, column names and
                  row count are sent to Groq. Cell values are not sent.
                </p>
                <p>
                  Upload limits: 2 MB, 5,000 data rows and 50 columns. Choose
                  one sheet and describe one regex replacement in one named
                  column.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
  function pager() {
    return (
      <div className="pager">
        <span>
          {Math.min(page * size + 1, rows)}–{Math.min((page + 1) * size, rows)}{" "}
          of {rows.toLocaleString()}
        </span>
        <button
          aria-label="Previous page"
          disabled={!!busy || page === 0}
          onClick={() => loadPage(page - 1)}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          aria-label="Next page"
          disabled={!!busy || (page + 1) * size >= rows}
          onClick={() => loadPage(page + 1)}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    );
  }
}
if (document.getElementById("root"))
  createRoot(document.getElementById("root")).render(<App />);
