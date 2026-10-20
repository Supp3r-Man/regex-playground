const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { runMatches, applyReplacement, segmentText, encodeState, decodeState } = require("../src/core.js");

const texts = (r) => r.matches.map((m) => m.text);
const starts = (r) => r.matches.map((m) => m.index);

test("a literal pattern finds every non-overlapping match with its index and end", () => {
  const r = runMatches("cat", "g", "a cat and a cat");
  assert.equal(r.ok, true);
  assert.deepEqual(starts(r), [2, 12]);
  assert.deepEqual(r.matches.map((m) => m.end), [5, 15]);
  assert.deepEqual(texts(r), ["cat", "cat"]);
  assert.equal(r.truncated, false);
});

test("without the g flag only the first match is returned", () => {
  const r = runMatches("a", "", "banana");
  assert.deepEqual(starts(r), [1]);
});

test("the i flag ignores case, and no match gives an empty list rather than an error", () => {
  assert.deepEqual(texts(runMatches("hello", "gi", "Hello HELLO hello")), ["Hello", "HELLO", "hello"]);
  const none = runMatches("xyz", "g", "abc");
  assert.equal(none.ok, true);
  assert.deepEqual(none.matches, []);
});

test("numbered groups are reported in order, and indices are null without the d flag", () => {
  const r = runMatches("(\\d+)-(\\d+)", "", "tel 10-20");
  assert.deepEqual(r.matches[0].groups, [
    { number: 1, text: "10", indices: null },
    { number: 2, text: "20", indices: null },
  ]);
  assert.equal(r.matches[0].indices, null);
  assert.equal(r.hasIndices, false);
});

test("named groups are reported with their names, alongside the numbered ones", () => {
  const r = runMatches("(?<year>\\d{4})-(?<month>\\d{2})", "", "on 2024-03-15");
  assert.deepEqual(
    r.matches[0].named.map((g) => [g.name, g.text]),
    [["year", "2024"], ["month", "03"]]
  );
  assert.deepEqual(r.matches[0].groups.map((g) => g.text), ["2024", "03"]);
});

test("a group that did not take part has text null, numbered and named", () => {
  const a = runMatches("(a)?(b)", "", "b");
  assert.deepEqual(a.matches[0].groups.map((g) => g.text), [null, "b"]);
  const b = runMatches("(?<x>a)?b", "", "b");
  assert.equal(b.matches[0].named[0].name, "x");
  assert.equal(b.matches[0].named[0].text, null);
});

test("alternation across matches reports the right group as unmatched each time", () => {
  const r = runMatches("(a)|(b)", "g", "ab");
  assert.deepEqual(r.matches.map((m) => m.groups.map((g) => g.text)), [["a", null], [null, "b"]]);
});

test("the d flag adds start and end indices for the match and every group, null for unmatched ones", () => {
  const r = runMatches("(?<w>b+)(c)?", "d", "xbby");
  assert.equal(r.hasIndices, true);
  const m = r.matches[0];
  assert.deepEqual(m.indices, [1, 3]);
  assert.deepEqual(m.groups[0].indices, [1, 3]);
  assert.equal(m.groups[1].indices, null);
  assert.deepEqual(m.named[0].indices, [1, 3]);
});

test("lookbehind and lookahead assertions are honoured", () => {
  const text = "$5 and 7 and $42";
  assert.deepEqual(texts(runMatches("(?<=\\$)\\d+", "g", text)), ["5", "42"]);
  assert.deepEqual(starts(runMatches("(?<=\\$)\\d+", "g", text)), [1, 14]);
  assert.deepEqual(texts(runMatches("(?<!\\$)\\b\\d+", "g", text)), ["7"]);
  assert.deepEqual(texts(runMatches("\\w+(?=:)", "g", "a: b c: d")), ["a", "c"]);
  assert.deepEqual(texts(runMatches("\\w+(?!\\w|:)", "g", "ab: cd")), ["cd"]);
});

test("backreferences match repeated text", () => {
  assert.deepEqual(texts(runMatches("(\\w)\\1", "g", "aabbcd")), ["aa", "bb"]);
  assert.deepEqual(texts(runMatches("(?<c>\\w)\\k<c>", "g", "xyyz")), ["yy"]);
});

test("multiline and dotAll flags change what ^, $ and . match", () => {
  assert.deepEqual(texts(runMatches("^\\w", "gm", "ab\ncd")), ["a", "c"]);
  assert.deepEqual(texts(runMatches("^\\w", "g", "ab\ncd")), ["a"]);
  assert.equal(runMatches("a.b", "", "a\nb").matches.length, 0);
  assert.equal(runMatches("a.b", "s", "a\nb").matches.length, 1);
});

test("the u flag treats an astral character as one code point; indices stay in UTF-16 units", () => {
  assert.equal(runMatches("^.$", "u", "\u{1F600}").matches.length, 1);
  assert.equal(runMatches("^.$", "", "\u{1F600}").matches.length, 0);
  const r = runMatches("b", "", "a\u{1F600}b");
  assert.equal(r.matches[0].index, 3);
});

test("zero-length matches: /a*/g on 'baac' gives four matches and stops", () => {
  const r = runMatches("a*", "g", "baac");
  assert.deepEqual(texts(r), ["", "aa", "", ""]);
  assert.deepEqual(starts(r), [0, 1, 3, 4]);
});

test("zero-length matches step over an emoji by code unit without the u flag and by code point with it", () => {
  assert.deepEqual(starts(runMatches("(?:)", "g", "\u{1F600}")), [0, 1, 2]);
  assert.deepEqual(starts(runMatches("(?:)", "gu", "\u{1F600}")), [0, 2]);
  assert.deepEqual(starts(runMatches("(?:)", "gu", "a\u{1F600}b")), [0, 1, 3, 4]);
});

test("empty text: an empty-matching pattern matches once, others not at all", () => {
  assert.equal(runMatches("(?:)", "g", "").matches.length, 1);
  assert.equal(runMatches("a*", "g", "").matches.length, 1);
  assert.equal(runMatches("a", "g", "").matches.length, 0);
});

test("the sticky flag only matches at lastIndex", () => {
  assert.equal(runMatches("a", "y", "ba").matches.length, 0);
  assert.equal(runMatches("a", "gy", "aab").matches.length, 2);
  assert.deepEqual(texts(runMatches("\\d", "gy", "12x3")), ["1", "2"]);
  assert.deepEqual(starts(runMatches("x*", "gy", "ab")), [0, 1, 2]);
});

test("the match limit caps the list and says so, and an exact fit is not reported as truncated", () => {
  const r = runMatches("a", "g", "a".repeat(5000), { limit: 1000 });
  assert.equal(r.matches.length, 1000);
  assert.equal(r.truncated, true);
  assert.equal(r.limit, 1000);
  const exact = runMatches("a", "g", "a".repeat(1000), { limit: 1000 });
  assert.equal(exact.matches.length, 1000);
  assert.equal(exact.truncated, false);
  const small = runMatches("a", "g", "aaaa", { limit: 2 });
  assert.deepEqual([small.matches.length, small.truncated], [2, true]);
});

test("the default limit is 1000, and nonsense limits fall back to it", () => {
  assert.equal(runMatches("a", "g", "a".repeat(1500)).matches.length, 1000);
  assert.equal(runMatches("a", "g", "a".repeat(1500), { limit: 0 }).limit, 1000);
  assert.equal(runMatches("a", "g", "a".repeat(1500), { limit: "5" }).limit, 1000);
});

test("the limit also works for zero-length matches, which cannot loop forever", () => {
  const r = runMatches("(?:)", "g", "x".repeat(2000), { limit: 10 });
  assert.equal(r.matches.length, 10);
  assert.equal(r.truncated, true);
  assert.equal(runMatches("(?:)", "g", "x".repeat(2000)).matches.length, 1000);
});

test("invalid patterns return the engine's message instead of throwing", () => {
  const cases = [["(", /Unterminated group/], ["[", /Unterminated character class/], ["a**", /Nothing to repeat/], ["\\", /\\ at end of pattern/], ["(?<n", /Invalid capture group name/]];
  for (const [pattern, message] of cases) {
    const r = runMatches(pattern, "g", "text");
    assert.equal(r.ok, false, pattern);
    assert.match(r.error, message, pattern);
    assert.deepEqual(r.matches, []);
  }
  assert.equal(runMatches("(?<n>a)(?<n>b)", "", "ab").ok, false, "duplicate group names in one alternative");
});

test("invalid, duplicate and unknown flags return the engine's message", () => {
  for (const flags of ["z", "gg", "gx", "uv"]) {
    const r = runMatches("a", flags, "a");
    assert.equal(r.ok, false, flags);
    assert.match(r.error, /Invalid flags/, flags);
  }
  assert.equal(runMatches("a", "", "a").ok, true);
});

test("a result can be posted to a Worker: it survives structuredClone unchanged", () => {
  const r = runMatches("(?<a>x)(y)?", "dg", "xy x");
  assert.deepEqual(structuredClone(r), r);
});

test("non-string inputs are coerced rather than crashing", () => {
  const r = runMatches(undefined, "g", null);
  assert.equal(r.ok, true);
  assert.equal(r.matches.length, 0); // pattern "undefined" in text "null"
});

test("segmentText splits text around matches, keeping empty matches as empty segments", () => {
  const text = "baac";
  const segs = segmentText(text, runMatches("a*", "g", text).matches);
  assert.deepEqual(segs, [
    { text: "", matchIndex: 0 },
    { text: "b", matchIndex: null },
    { text: "aa", matchIndex: 1 },
    { text: "", matchIndex: 2 },
    { text: "c", matchIndex: null },
    { text: "", matchIndex: 3 },
  ]);
});

test("segmentText edge cases: no matches, empty text, overlapping and out-of-range matches", () => {
  assert.deepEqual(segmentText("abc", []), [{ text: "abc", matchIndex: null }]);
  assert.deepEqual(segmentText("", []), []);
  const overlapping = [{ index: 0, end: 3 }, { index: 1, end: 2 }, { index: 3, end: 4 }, { index: 2, end: 9 }, { index: 5, end: 99 }];
  assert.deepEqual(segmentText("abcd", overlapping), [
    { text: "abc", matchIndex: 0 },
    { text: "d", matchIndex: 2 },
  ]);
  assert.deepEqual(segmentText("ab", [null, { index: "x" }, { index: 1, end: 0 }]), [{ text: "ab", matchIndex: null }]);
});

test("replacement uses JavaScript syntax: $1, $<name>, $&, $$, $` and $'", () => {
  assert.equal(applyReplacement("(\\w+) (\\w+)", "", "hello world", "$2 $1").result, "world hello");
  assert.equal(applyReplacement("(?<a>x)(?<b>y)", "", "xy", "$<b>$<a>").result, "yx");
  assert.equal(applyReplacement("b", "g", "abcb", "[$&]").result, "a[b]c[b]");
  assert.equal(applyReplacement("b", "g", "abcb", "$$").result, "a$c$");
  assert.equal(applyReplacement("b", "", "abc", "[$`|$']").result, "a[a|c]c");
});

test("replacement: without g only the first match, with g all; empty replacement deletes", () => {
  assert.equal(applyReplacement("a", "", "aaa", "b").result, "baa");
  assert.equal(applyReplacement("a", "g", "aaa", "b").result, "bbb");
  assert.equal(applyReplacement("a", "g", "banana", "").result, "bnn");
  assert.equal(applyReplacement("", "g", "ab", "-").result, "-a-b-");
});

test("replacement follows the engine's rules for references that do not exist", () => {
  assert.equal(applyReplacement("(a)", "", "a", "$<x>").result, "$<x>"); // no named groups: literal
  assert.equal(applyReplacement("a", "", "a", "$0").result, "$0");
  assert.equal(applyReplacement("(a)", "", "a", "$10").result, "a0"); // $1 then a literal 0
  assert.equal(applyReplacement("(?<x>a)", "", "a", "$<nope>").result, ""); // named groups exist: unknown name is empty
});

test("replacement reports invalid patterns", () => {
  const r = applyReplacement("(", "g", "x", "y");
  assert.equal(r.ok, false);
  assert.match(r.error, /Unterminated group/);
});

test("encodeState produces a known percent-encoded hash and decodeState reads it back", () => {
  const state = { pattern: "a b", flags: "gi", text: "x&y=z#", replacement: "$1" };
  assert.equal(encodeState(state), "p=a%20b&f=gi&t=x%26y%3Dz%23&r=%241");
  assert.deepEqual(decodeState("#" + encodeState(state)), state);
});

test("state round-trips unicode, emoji, empty fields and lone surrogates", () => {
  const samples = [
    { pattern: "café|日本", flags: "u", text: "\u{1F600}\u{1F44D}\u{1F3FD} x", replacement: "\u{1F680}" },
    { pattern: "", flags: "", text: "", replacement: "" },
    { pattern: "\\u{1F600}", flags: "gu", text: "line1\nline2\ttab", replacement: "%u0041 %25 %" },
    { pattern: "a", flags: "g", text: "lone \ud800 high, lone \udc00 low, 𐀀 pair", replacement: "" },
  ];
  for (const s of samples) assert.deepEqual(decodeState(encodeState(s)), s);
});

test("a malformed or hostile hash never throws and keeps what it can read", () => {
  assert.deepEqual(decodeState("#p=%E0%A4%A&f=g"), { pattern: "", flags: "g", text: "", replacement: "" });
  assert.deepEqual(decodeState("p=a&p=b"), { pattern: "b", flags: "", text: "", replacement: "" });
  assert.deepEqual(decodeState("p=a+b"), { pattern: "a+b", flags: "", text: "", replacement: "" });
  assert.deepEqual(decodeState("#garbage&=&x=1&&p"), { pattern: "", flags: "", text: "", replacement: "" });
  for (const bad of [undefined, null, 5, {}, "", "#", "%", "%u", "%uZZZZ", "t=%u12"]) {
    const s = decodeState(bad);
    assert.deepEqual(Object.keys(s), ["pattern", "flags", "text", "replacement"]);
  }
  assert.equal(decodeState("t=%u12").text, "");
});

test("a pattern that backtracks catastrophically never returns; it needs an outside timeout (vm here, Worker.terminate in the page)", () => {
  const sandbox = { runMatches };
  assert.throws(() => vm.runInNewContext("runMatches('(a+)+$', '', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!')", sandbox, { timeout: 300 }), /timed out/);
});

test("the same pattern is fast when the text matches, so the timeout is about the input, not the pattern alone", () => {
  const started = Date.now();
  assert.equal(runMatches("(a+)+$", "", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").matches.length, 1);
  assert.ok(Date.now() - started < 1000);
});
