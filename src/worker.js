// Runs the user's regex away from the page. The page terminates this worker if a run takes too long,
// which is the only way to stop a pattern that backtracks catastrophically.
importScripts("core.js");

self.onmessage = function (event) {
  const d = event.data;
  let out;
  try {
    const found = PlaygroundCore.runMatches(d.pattern, d.flags, d.text, { limit: d.limit });
    const replaced = found.ok && d.replacement !== "" ? PlaygroundCore.applyReplacement(d.pattern, d.flags, d.text, d.replacement) : null;
    out = { id: d.id, found: found, replaced: replaced };
  } catch (e) {
    out = { id: d.id, found: { ok: false, error: "Runner error: " + (e && e.message ? e.message : String(e)), matches: [], truncated: false, hasIndices: false, flags: "", limit: 0 }, replaced: null };
  }
  self.postMessage(out);
};
