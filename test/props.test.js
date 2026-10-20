// Seeded random tests. The seeds are fixed, so a failure is reproducible: re-run with the same seed and iteration.
const test = require("node:test");
const assert = require("node:assert/strict");
const { runMatches, segmentText, encodeState, decodeState, explain } = require("../src/core.js");

// mulberry32: a small, well-known seeded PRNG.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];
function randomString(r, alphabet, maxLen) {
  const n = Math.floor(r() * (maxLen + 1));
  let s = "";
  for (let i = 0; i < n; i++) s += pick(r, alphabet);
  return s;
}

const TEXT_ALPHABET = ["a", "b", "c", " ", "\n", "1", "é", "\u{1F600}", "\u{1F44D}", "-"];
const PATTERNS = ["a*", "b+", "(?:)", "\\w+", "\\d", "[ab]", "(a|b)c?", "^\\w", "\\b", ".", "a{2}", "(?<=a)b", "\\s*", "x*"];
const FLAGS = ["g", "gu", "gm", "gi", "gs", "gy", "", "u", "gmu"];

test("segmentText: for random patterns and texts the segments rebuild the input and never overlap (seed 20261019)", () => {
  const r = rng(20261019);
  for (let iter = 0; iter < 400; iter++) {
    const text = randomString(r, TEXT_ALPHABET, 30);
    const pattern = pick(r, PATTERNS);
    const flags = pick(r, FLAGS);
    const found = runMatches(pattern, flags, text);
    assert.equal(found.ok, true, `iteration ${iter}: /${pattern}/${flags}`);
    const segs = segmentText(text, found.matches);
    const where = `iteration ${iter}: /${pattern}/${flags} on ${JSON.stringify(text)}`;
    assert.equal(segs.map((s) => s.text).join(""), text, where);
    // Walk the segments: each one must sit exactly where the cursor is, and matched ones must equal the match's own span.
    let cursor = 0;
    let lastMatch = -1;
    for (const s of segs) {
      assert.equal(text.slice(cursor, cursor + s.text.length), s.text, where);
      if (s.matchIndex !== null) {
        const m = found.matches[s.matchIndex];
        assert.equal(m.index, cursor, where);
        assert.equal(m.end, cursor + s.text.length, where);
        assert.ok(s.matchIndex > lastMatch, "match order " + where);
        lastMatch = s.matchIndex;
      } else {
        assert.ok(s.text.length > 0, "gaps are never empty " + where);
      }
      cursor += s.text.length;
    }
    assert.equal(cursor, text.length, where);
    // Every match produced by the engine must show up exactly once.
    assert.deepEqual(segs.filter((s) => s.matchIndex !== null).map((s) => s.matchIndex), found.matches.map((_, k) => k), where);
  }
});

test("segmentText: for random, unsorted and overlapping match lists the segments still rebuild the input (seed 7)", () => {
  const r = rng(7);
  for (let iter = 0; iter < 400; iter++) {
    const text = randomString(r, TEXT_ALPHABET, 25);
    const matches = [];
    const count = Math.floor(r() * 8);
    for (let k = 0; k < count; k++) {
      const index = Math.floor(r() * (text.length + 3)) - 1;
      matches.push({ index: index, end: index + Math.floor(r() * 6) - 1 });
    }
    const segs = segmentText(text, matches);
    const where = `iteration ${iter}: ${JSON.stringify(matches)} on ${JSON.stringify(text)}`;
    assert.equal(segs.map((s) => s.text).join(""), text, where);
    let cursor = 0;
    for (const s of segs) {
      if (s.matchIndex !== null) {
        const m = matches[s.matchIndex];
        assert.equal(m.index, cursor, where);
        assert.equal(text.slice(m.index, m.end), s.text, where);
      }
      cursor += s.text.length;
    }
  }
});

const STATE_ALPHABET = ["a", "b", " ", "%", "&", "=", "#", "+", "?", "/", "\\", "\n", "\t", "u", "%u0041", "%25", "é", "日", "\u{1F600}", "\u{1F3FD}", "\ud800", "\udc00", "\ud83d", "\ude00", "$", "<", ">", "{", "}"];
const FLAG_LETTERS = ["d", "g", "i", "m", "s", "u", "y"];

test("encodeState then decodeState is the identity for random states, with and without the leading # (seed 99)", () => {
  const r = rng(99);
  for (let iter = 0; iter < 500; iter++) {
    const state = {
      pattern: r() < 0.2 ? "" : randomString(r, STATE_ALPHABET, 20),
      flags: FLAG_LETTERS.filter(() => r() < 0.4).join(""),
      text: r() < 0.2 ? "" : randomString(r, STATE_ALPHABET, 40),
      replacement: r() < 0.3 ? "" : randomString(r, STATE_ALPHABET, 10),
    };
    const encoded = encodeState(state);
    const where = `iteration ${iter}: ${JSON.stringify(state)}`;
    assert.match(encoded, /^[A-Za-z0-9\-_.!~*'()%=&]*$/, "only URL-safe characters: " + where);
    assert.deepEqual(decodeState("#" + encoded), state, where);
    assert.deepEqual(decodeState(encoded), state, where);
  }
});

test("decodeState never throws on random garbage (seed 5)", () => {
  const r = rng(5);
  const alphabet = ["%", "&", "=", "#", "p", "f", "t", "r", "u", "0", "A", "e", "9", "%u", "%E0", "%uD800", "x", " "];
  for (let iter = 0; iter < 1000; iter++) {
    const s = decodeState(randomString(r, alphabet, 25));
    assert.deepEqual(Object.keys(s), ["pattern", "flags", "text", "replacement"]);
    for (const k of Object.keys(s)) assert.equal(typeof s[k], "string");
  }
});

// A naive scanner written independently of RegExp, valid ONLY for patterns that are plain letters (no metacharacters).
function naiveLiteralMatches(literal, text, ignoreCase) {
  const L = ignoreCase ? literal.toLowerCase() : literal;
  const T = ignoreCase ? text.toLowerCase() : text;
  const out = [];
  if (literal === "") {
    for (let i = 0; i <= text.length; i++) out.push([i, i]);
    return out;
  }
  let i = 0;
  while (i + L.length <= T.length) {
    if (T.startsWith(L, i)) {
      out.push([i, i + L.length]);
      i += L.length;
    } else {
      i++;
    }
  }
  return out;
}

test("cross-check: for literal-only patterns runMatches agrees with a naive scanner, with and without i (seed 31)", () => {
  const r = rng(31);
  for (let iter = 0; iter < 500; iter++) {
    const ignoreCase = r() < 0.5;
    const literal = randomString(r, ["a", "b", "A", "B"], 3);
    const text = randomString(r, ["a", "b", "A", "B", "c", " "], 25);
    const got = runMatches(literal, ignoreCase ? "gi" : "g", text);
    const where = `iteration ${iter}: /${literal}/${ignoreCase ? "gi" : "g"} on ${JSON.stringify(text)}`;
    assert.deepEqual(got.matches.map((m) => [m.index, m.end]), naiveLiteralMatches(literal, text, ignoreCase), where);
  }
});

test("explain never throws on random pattern-like input, and its tokens tile the pattern in order (seed 12)", () => {
  const r = rng(12);
  const alphabet = ["a", "\\", "[", "]", "(", ")", "?", "<", ">", "=", "!", ":", "|", "*", "+", "{", "}", ",", "1", "2", "^", "$", ".", "-", "n", "k", "p", "u", "x", "c", "\u{1F600}", "\ud800", " "];
  for (let iter = 0; iter < 1500; iter++) {
    const pattern = randomString(r, alphabet, 14);
    const tokens = explain(pattern);
    const where = `iteration ${iter}: ${JSON.stringify(pattern)}`;
    let cursor = 0;
    for (const t of tokens) {
      if (t.text === "") continue; // end-of-pattern notes about unclosed groups
      assert.equal(t.start, cursor, where);
      assert.equal(pattern.slice(t.start, t.end), t.text, where);
      assert.ok(t.description.length > 0, where);
      cursor = t.end;
    }
    assert.equal(cursor, pattern.length, where);
  }
});
