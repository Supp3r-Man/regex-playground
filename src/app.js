// Browser UI. Pure logic lives in core.js and lib.js (both tested in Node); this file only touches the DOM.
// All text from the user or from matches is inserted with textContent / createTextNode, never as HTML.
(function () {
  "use strict";

  const RUN_TIMEOUT_MS = 2000;
  const DEBOUNCE_MS = 150;
  const core = window.PlaygroundCore;
  const lib = window.PlaygroundLib;

  const $ = (id) => document.getElementById(id);
  const el = {
    pattern: $("pattern"),
    preset: $("preset"),
    flags: $("flags"),
    text: $("text"),
    replacement: $("replacement"),
    shareUrl: $("share-url"),
    copy: $("copy"),
    clear: $("clear"),
    status: $("status"),
    matchCount: $("match-count"),
    highlight: $("highlight"),
    table: $("table"),
    replaceBlock: $("replace-block"),
    replaced: $("replaced"),
    replaceNote: $("replace-note"),
    explain: $("explain"),
    explainLimits: $("explain-limits"),
    cheat: $("cheat"),
  };

  const FLAG_NAMES = { d: "indices", g: "global", i: "ignore case", m: "multiline", s: "dotAll", u: "unicode", y: "sticky" };
  const flagBoxes = {};

  let worker = null;
  let runTimer = null;
  let killTimer = null;
  let runId = 0;
  let lastHash = "";

  function node(tag, props, children) {
    const n = document.createElement(tag);
    if (props) Object.keys(props).forEach((k) => (k === "text" ? (n.textContent = props[k]) : n.setAttribute(k, props[k])));
    (children || []).forEach((c) => n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return n;
  }

  // ---- state in and out of the inputs and the URL hash ----

  function readState() {
    let flags = "";
    core.FLAG_CHARS.split("").forEach((f) => {
      if (flagBoxes[f].checked) flags += f;
    });
    return { pattern: el.pattern.value, flags: flags, text: el.text.value, replacement: el.replacement.value };
  }

  function writeState(state) {
    el.pattern.value = state.pattern;
    el.text.value = state.text;
    el.replacement.value = state.replacement;
    const flags = lib.normaliseFlags(state.flags, core.FLAG_CHARS);
    core.FLAG_CHARS.split("").forEach((f) => (flagBoxes[f].checked = flags.indexOf(f) !== -1));
  }

  function publish(state) {
    const encoded = core.encodeState(state);
    lastHash = "#" + encoded;
    try {
      history.replaceState(null, "", lastHash);
    } catch (e) {
      /* some browsers refuse this on file:// pages; the share field below still shows the link */
    }
    el.shareUrl.value = location.href.split("#")[0] + lastHash;
  }

  // ---- running the matcher in a Worker with a timeout ----

  function stopWorker() {
    clearTimeout(killTimer);
    if (worker) {
      worker.terminate();
      worker = null;
    }
  }

  function setStatus(kind, headline, detail) {
    el.status.className = "status " + kind;
    el.status.replaceChildren(headline);
    if (detail) el.status.appendChild(node("span", { class: "detail", text: detail }));
  }

  function startRun() {
    const state = readState();
    publish(state);
    renderExplanation(state.pattern);
    stopWorker();
    const id = ++runId;
    if (state.pattern === "") {
      renderIdle(state);
      return;
    }
    setStatus("info", "Matching...");
    let w;
    try {
      w = new Worker("src/worker.js");
    } catch (e) {
      renderFailure(state, "error", "The matcher could not start", "Could not start the worker (" + e.message + "). Open this page over http, for example with `npm start`, not from a file:// URL.");
      return;
    }
    worker = w;
    killTimer = setTimeout(() => {
      if (id !== runId) return;
      stopWorker();
      renderFailure(state, "timeout", "Timed out: possible catastrophic backtracking", "No result after " + RUN_TIMEOUT_MS / 1000 + " seconds, so the matcher was stopped. Nested quantifiers such as (a+)+ can take exponential time on text that almost matches. The page is still responsive; change the pattern or the text and it will run again.");
    }, RUN_TIMEOUT_MS);
    w.onmessage = (ev) => {
      if (!ev.data || ev.data.id !== id) return;
      stopWorker();
      render(state, ev.data.found, ev.data.replaced);
    };
    w.onerror = (ev) => {
      if (id !== runId) return;
      stopWorker();
      renderFailure(state, "error", "The matcher failed", "Worker error: " + (ev.message || "unknown"));
    };
    w.postMessage({ id: id, pattern: state.pattern, flags: state.flags, text: state.text, replacement: state.replacement, limit: core.DEFAULT_LIMIT });
  }

  function schedule() {
    clearTimeout(runTimer);
    runTimer = setTimeout(startRun, DEBOUNCE_MS);
  }

  // ---- rendering ----

  function plainText(state) {
    el.highlight.replaceChildren(document.createTextNode(state.text));
  }

  function clearResults(message) {
    el.matchCount.textContent = "";
    el.table.replaceChildren(node("p", { class: "muted", text: message }));
    el.replaceBlock.hidden = true;
  }

  function renderIdle(state) {
    setStatus("info", "Type a pattern to start.");
    plainText(state);
    clearResults("No matches to show.");
  }

  function renderFailure(state, kind, headline, detail) {
    setStatus(kind, headline, detail);
    plainText(state);
    clearResults("No matches to show.");
  }

  function render(state, found, replaced) {
    if (!found.ok) {
      renderFailure(state, "error", "Invalid pattern", found.error);
      return;
    }
    const n = found.matches.length;
    let headline = n === 0 ? "No matches" : n === 1 ? "1 match" : n + " matches";
    const notes = [];
    if (found.truncated) {
      headline = "First " + found.limit + " matches shown";
      notes.push("There are more than " + found.limit + " matches; the rest are not listed or highlighted.");
    }
    if (state.flags.indexOf("g") === -1 && n > 0) notes.push("Without the g flag only the first match is found.");
    if (state.flags.indexOf("d") !== -1 && !found.hasIndices) notes.push("This browser did not report d-flag indices.");
    setStatus(n === 0 && !found.truncated ? "none" : "ok", headline, notes.join(" "));
    el.matchCount.textContent = n === 0 ? "" : "(" + n + (found.truncated ? "+" : "") + ")";
    renderHighlight(state.text, found.matches);
    renderTable(found);
    renderReplace(state, replaced);
  }

  function renderHighlight(text, matches) {
    el.highlight.replaceChildren();
    core.segmentText(text, matches).forEach((seg) => {
      if (seg.matchIndex === null) {
        el.highlight.appendChild(document.createTextNode(seg.text));
        return;
      }
      const m = matches[seg.matchIndex];
      const cls = "m m" + (seg.matchIndex % 2) + (seg.text === "" ? " empty" : "");
      const title = seg.text === "" ? "Empty match " + (seg.matchIndex + 1) + " at index " + m.index : "Match " + (seg.matchIndex + 1) + " at index " + m.index;
      el.highlight.appendChild(node("span", { class: cls, title: title, text: seg.text }));
    });
  }

  function cellValue(text) {
    return text === null ? node("span", { class: "muted", text: "(did not participate)" }) : node("code", { text: lib.truncate(lib.showInvisibles(text), 120) });
  }

  function pairText(p) {
    return p ? " [" + p[0] + ", " + p[1] + "]" : "";
  }

  function renderTable(found) {
    if (found.matches.length === 0) {
      el.table.replaceChildren(node("p", { class: "muted", text: "No matches to show." }));
      return;
    }
    const head = ["#", "Index", "Text", "Groups"].concat(found.hasIndices ? ["Indices (d)"] : []);
    const body = node("tbody");
    found.matches.forEach((m, k) => {
      const list = node("ul", { class: "groups" });
      m.groups.forEach((g) => {
        list.appendChild(node("li", {}, [node("span", { class: "gname", text: String(g.number) }), cellValue(g.text), node("span", { class: "muted", text: pairText(g.indices) })]));
      });
      m.named.forEach((g) => {
        list.appendChild(node("li", {}, [node("span", { class: "gname named", text: g.name }), cellValue(g.text), node("span", { class: "muted", text: pairText(g.indices) })]));
      });
      const cells = [
        node("td", { text: String(k + 1) }),
        node("td", { text: m.index + "–" + m.end }),
        node("td", {}, [cellValue(m.text)]),
        node("td", {}, [m.groups.length || m.named.length ? list : node("span", { class: "muted", text: "none" })]),
      ];
      if (found.hasIndices) cells.push(node("td", { class: "mono", text: m.indices ? "[" + m.indices[0] + ", " + m.indices[1] + "]" : "" }));
      body.appendChild(node("tr", {}, cells));
    });
    el.table.replaceChildren(node("table", { class: "cases" }, [node("thead", {}, [node("tr", {}, head.map((h) => node("th", { scope: "col", text: h })))]), body]));
  }

  function renderReplace(state, replaced) {
    if (!replaced) {
      el.replaceBlock.hidden = true;
      return;
    }
    el.replaceBlock.hidden = false;
    if (!replaced.ok) {
      el.replaced.textContent = replaced.error;
      el.replaceNote.textContent = "";
      return;
    }
    el.replaced.textContent = replaced.result;
    el.replaceNote.textContent = state.flags.indexOf("g") === -1 ? "Without the g flag only the first match is replaced." : "";
  }

  function renderExplanation(pattern) {
    el.explain.replaceChildren();
    if (pattern === "") {
      el.explain.appendChild(node("li", { class: "muted", text: "Type a pattern to see it explained." }));
      return;
    }
    core.explain(pattern).forEach((t) => {
      const li = node("li", { class: "tok t-" + t.type }, [node("code", { text: t.text === "" ? "(end)" : t.text }), node("span", { class: "desc", text: t.description })]);
      li.style.setProperty("--depth", String(t.depth));
      el.explain.appendChild(li);
    });
  }

  // ---- static parts: flags, presets, cheat sheet ----

  function buildFlags() {
    core.FLAG_CHARS.split("").forEach((f) => {
      const box = node("input", { type: "checkbox", id: "flag-" + f, value: f });
      box.addEventListener("change", schedule);
      flagBoxes[f] = box;
      el.flags.appendChild(node("label", { class: "flag", title: FLAG_NAMES[f] }, [box, node("code", { text: f }), node("span", { class: "muted", text: FLAG_NAMES[f] })]));
    });
  }

  function buildPresets() {
    el.preset.appendChild(node("option", { value: "", text: "Choose an example..." }));
    lib.PRESETS.forEach((p) => el.preset.appendChild(node("option", { value: p.id, text: p.name })));
    el.preset.addEventListener("change", () => {
      const p = lib.PRESETS.find((x) => x.id === el.preset.value);
      el.preset.value = "";
      if (!p) return;
      writeState(p);
      clearTimeout(runTimer);
      startRun();
    });
  }

  function buildCheatSheet() {
    lib.CHEAT_SHEET.forEach((section) => {
      const rows = section[1].map((r) => node("tr", {}, [node("td", {}, [node("code", { text: r[0] })]), node("td", { text: r[1] })]));
      el.cheat.appendChild(node("h3", { text: section[0] }));
      el.cheat.appendChild(node("table", { class: "cheat" }, [node("tbody", {}, rows)]));
    });
    core.EXPLAIN_LIMITS.forEach((s) => el.explainLimits.appendChild(node("li", { text: s })));
  }

  // ---- events ----

  [el.pattern, el.text, el.replacement].forEach((c) => c.addEventListener("input", schedule));

  el.clear.addEventListener("click", () => {
    writeState({ pattern: "", flags: "", text: "", replacement: "" });
    clearTimeout(runTimer);
    startRun();
    el.pattern.focus();
  });

  el.copy.addEventListener("click", () => {
    const done = () => {
      el.copy.textContent = "Copied";
      setTimeout(() => (el.copy.textContent = "Copy link"), 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(el.shareUrl.value).then(done, () => el.shareUrl.select());
    } else {
      el.shareUrl.select();
    }
  });
  el.shareUrl.addEventListener("focus", () => el.shareUrl.select());

  // Back/forward or a pasted link with a different hash: load it. replaceState above never fires this event.
  window.addEventListener("hashchange", () => {
    if (location.hash === lastHash) return;
    writeState(core.decodeState(location.hash));
    clearTimeout(runTimer);
    startRun();
  });

  // ---- start ----

  buildFlags();
  buildPresets();
  buildCheatSheet();
  const hasHash = /^#?(.*&)?[ptfr]=/.test(location.hash);
  writeState(hasHash ? core.decodeState(location.hash) : lib.PRESETS[0]);
  startRun();
})();
