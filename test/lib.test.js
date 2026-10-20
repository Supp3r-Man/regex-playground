const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PRESETS, CHEAT_SHEET, showInvisibles, truncate, normaliseFlags } = require("../src/lib.js");
const { runMatches, applyReplacement, explain, encodeState, decodeState, FLAG_CHARS } = require("../src/core.js");

test("there are at least six presets with unique ids and every field filled in", () => {
  assert.ok(PRESETS.length >= 6);
  assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length);
  for (const p of PRESETS) {
    for (const k of ["id", "name", "pattern", "text"]) assert.ok(typeof p[k] === "string" && p[k].length > 0, p.id + "." + k);
    assert.equal(typeof p.flags, "string");
    assert.equal(typeof p.replacement, "string");
    assert.equal(normaliseFlags(p.flags, FLAG_CHARS), p.flags.split("").sort((a, b) => FLAG_CHARS.indexOf(a) - FLAG_CHARS.indexOf(b)).join(""), p.id + " uses only offered flags");
  }
});

test("every preset with a finite result gives exactly the match count it claims", () => {
  for (const p of PRESETS.filter((x) => x.expect !== null)) {
    const r = runMatches(p.pattern, p.flags, p.text);
    assert.equal(r.ok, true, p.id);
    assert.equal(r.matches.length, p.expect, p.id);
    assert.equal(applyReplacement(p.pattern, p.flags, p.text, p.replacement).ok, true, p.id);
  }
});

test("presets cover the features they are named for", () => {
  const byId = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
  assert.deepEqual(runMatches(byId.dates.pattern, byId.dates.flags, byId.dates.text).matches[1].named.map((g) => g.text), ["2024", "04", "02"]);
  assert.equal(applyReplacement(byId.dates.pattern, byId.dates.flags, byId.dates.text, byId.dates.replacement).result.slice(9, 19), "15/03/2024");
  assert.ok(runMatches(byId["zero-length"].pattern, "g", byId["zero-length"].text).matches.some((m) => m.text === ""));
  assert.deepEqual(runMatches(byId.lazy.pattern, "g", byId.lazy.text).matches.map((m) => m.text), ["<b>", "</b>", "<i>", "</i>"]);
  assert.deepEqual(runMatches(byId.lookaround.pattern, "g", byId.lookaround.text).matches.map((m) => m.text), ["12.50", "300"]);
  assert.equal(applyReplacement(byId.backreference.pattern, "gi", byId.backreference.text, "$1").result, "This is a test of the regex tester.");
  assert.ok(byId.catastrophic, "the catastrophic example is present");
});

test("every preset round-trips through the URL hash and can be explained without an unknown token", () => {
  for (const p of PRESETS) {
    const state = { pattern: p.pattern, flags: p.flags, text: p.text, replacement: p.replacement };
    assert.deepEqual(decodeState(encodeState(state)), state, p.id);
    assert.equal(explain(p.pattern).filter((t) => t.type === "unknown").length, 0, p.id);
  }
});

test("the cheat sheet has named sections of non-empty [syntax, meaning] rows", () => {
  assert.ok(CHEAT_SHEET.length >= 5);
  for (const [name, rows] of CHEAT_SHEET) {
    assert.ok(name.length > 0 && rows.length > 0, name);
    for (const [syntax, meaning] of rows) assert.ok(syntax.length > 0 && meaning.length > 0, name);
  }
});

test("showInvisibles makes whitespace visible and labels the empty string", () => {
  assert.equal(showInvisibles(""), "(empty)");
  assert.equal(showInvisibles("a\nb\tc\r"), "a↵b⇥c␍");
  assert.equal(showInvisibles("  x  y "), "··x  y·");
  assert.equal(showInvisibles(" "), "·");
});

test("truncate shortens long text with an ellipsis and leaves short text alone", () => {
  assert.equal(truncate("abc", 5), "abc");
  assert.equal(truncate("abcdef", 4), "abc…");
  assert.equal(truncate("abcde", 5), "abcde");
});

test("normaliseFlags keeps only offered letters, once each, in canonical order", () => {
  assert.equal(normaliseFlags("yigxg", "dgimsuy"), "giy");
  assert.equal(normaliseFlags("", "dgimsuy"), "");
  assert.equal(normaliseFlags("vq", "dgimsuy"), "");
});

test("the page never builds HTML from strings (a static check of the source, not a browser test)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
});

test("every script and stylesheet that index.html references exists, and the page loads core before app", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const refs = [...html.matchAll(/(?:src|href)="(src\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 4);
  for (const ref of refs) assert.ok(fs.existsSync(path.join(__dirname, "..", ref)), ref);
  assert.ok(html.indexOf("src/core.js") < html.indexOf("src/app.js"));
  assert.ok(html.indexOf("src/lib.js") < html.indexOf("src/app.js"));
});
