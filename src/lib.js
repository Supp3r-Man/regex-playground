// UI-independent data and helpers: example presets, the cheat sheet and text display helpers. Tested in Node.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PlaygroundLib = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // All sample data is made up. `expect` is the number of matches the test suite checks for each preset.
  const PRESETS = [
    {
      id: "dates",
      name: "Dates with named groups",
      pattern: "(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})",
      flags: "g",
      text: "Released 2024-03-15, patched 2024-04-02 and archived 1999-12-31.",
      replacement: "$<day>/$<month>/$<year>",
      expect: 3,
    },
    {
      id: "emails",
      name: "Email-like words (simplified)",
      pattern: "\\b[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+\\b",
      flags: "gi",
      text: "Contact ann.lee@example.com or BOB+news@mail.example.org. Not valid: @nobody, plain@, a@b.",
      replacement: "<$&>",
      expect: 2,
    },
    {
      id: "zero-length",
      name: "Zero-length matches",
      pattern: "a*",
      flags: "g",
      text: "baaac",
      replacement: "-",
      expect: 4,
    },
    {
      id: "lazy",
      name: "Greedy versus lazy",
      pattern: "<.+?>",
      flags: "g",
      text: "<b>bold</b> and <i>italic</i> text",
      replacement: "[tag]",
      expect: 4,
    },
    {
      id: "lookaround",
      name: "Lookbehind and lookahead",
      pattern: "(?<=\\$)\\d+(?:\\.\\d{2})?(?!\\d)",
      flags: "g",
      text: "Prices: $12.50, EUR 8, $300 and 7 apples",
      replacement: "<$&>",
      expect: 2,
    },
    {
      id: "backreference",
      name: "Repeated words (backreference)",
      pattern: "\\b(\\w+)\\s+\\1\\b",
      flags: "gi",
      text: "This is is a test of the the regex tester tester.",
      replacement: "$1",
      expect: 3,
    },
    {
      id: "multiline",
      name: "Line starts (multiline flag)",
      pattern: "^(\\w+):\\s*(.*)$",
      flags: "gm",
      text: "name: Ada\nrole: engineer\nnotes without a colon\nid: 42",
      replacement: "$2 ($1)",
      expect: 3,
    },
    {
      id: "sticky",
      name: "Sticky flag",
      pattern: "\\d+,?",
      flags: "gy",
      text: "12,34,x56",
      replacement: "",
      expect: 2,
    },
    {
      id: "unicode",
      name: "Unicode letters (u flag)",
      pattern: "\\p{L}+",
      flags: "gu",
      text: "naïve café 日本語 and emoji 😀 x2",
      replacement: "_",
      expect: 6,
    },
    {
      id: "catastrophic",
      name: "Catastrophic backtracking (times out)",
      pattern: "(a+)+$",
      flags: "",
      text: "aaaaaaaaaaaaaaaaaaaaaaaaaaaa!",
      replacement: "",
      expect: null, // never finishes; the page stops it after the timeout
    },
  ];

  // [section, [[syntax, meaning], ...]]
  const CHEAT_SHEET = [
    ["Characters", [[".", "any character except a line break"], ["\\d \\w \\s", "digit, word character, whitespace (capital letter = the opposite)"], ["[abc] [^abc] [a-z]", "one of, none of, a range"], ["\\. \\\\ \\(", "a literal metacharacter"]]],
    ["Quantifiers", [["* + ?", "zero or more, one or more, zero or one"], ["{3} {2,} {2,5}", "exactly 3, at least 2, between 2 and 5"], ["*? +? ??", "the same, but as few as possible (lazy)"]]],
    ["Groups", [["(x)", "capturing group, numbered from 1"], ["(?<name>x)", "named capturing group"], ["(?:x)", "non-capturing group"], ["\\1 \\k<name>", "backreference to an earlier group"], ["a|b", "a or b"]]],
    ["Assertions", [["^ $", "start and end of the text (of each line with m)"], ["\\b \\B", "word boundary, not a word boundary"], ["(?=x) (?!x)", "lookahead: followed by x, not followed by x"], ["(?<=x) (?<!x)", "lookbehind: preceded by x, not preceded by x"]]],
    ["Flags", [["g", "all matches, not just the first"], ["i", "ignore case"], ["m", "^ and $ match at each line"], ["s", ". also matches line breaks"], ["u", "Unicode mode (code points, \\p{...})"], ["y", "sticky: match only at lastIndex"], ["d", "report the start and end index of each group"]]],
    ["Replacement", [["$1 $<name>", "text of a numbered or named group"], ["$& $$", "the whole match, a literal dollar sign"], ["$` $'", "the text before and after the match"]]],
  ];

  // Show whitespace that would otherwise be invisible in a table cell. An empty string becomes "(empty)".
  function showInvisibles(text) {
    if (text === "") return "(empty)";
    return String(text)
      .replace(/\n/g, "↵")
      .replace(/\r/g, "␍")
      .replace(/\t/g, "⇥")
      .replace(/^ +| +$/g, (s) => "·".repeat(s.length));
  }

  function truncate(text, max) {
    text = String(text);
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }

  // The flag letters in canonical order, for the checkboxes: keeps only known letters, no duplicates.
  function normaliseFlags(flags, allowed) {
    const seen = new Set(String(flags));
    return allowed.split("").filter((f) => seen.has(f)).join("");
  }

  return { PRESETS: PRESETS, CHEAT_SHEET: CHEAT_SHEET, showInvisibles: showInvisibles, truncate: truncate, normaliseFlags: normaliseFlags };
});
