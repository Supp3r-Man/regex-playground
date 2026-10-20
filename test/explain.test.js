const test = require("node:test");
const assert = require("node:assert/strict");
const { explain, EXPLAIN_LIMITS } = require("../src/core.js");

// [type, text, description] for each token, to keep the expected values readable.
const brief = (pattern) => explain(pattern).map((t) => [t.type, t.text, t.description]);

test("a literal character is explained with its quoted form, including space and emoji", () => {
  assert.deepEqual(explain("a"), [{ type: "literal", text: "a", description: 'Matches the character "a".', start: 0, end: 1, depth: 0 }]);
  assert.deepEqual(brief(" "), [["literal", " ", 'Matches the character " " (a space).']]);
  const e = explain("\u{1F600}");
  assert.equal(e.length, 1);
  assert.equal(e[0].end, 2);
  assert.equal(e[0].description, 'Matches the character "\u{1F600}" (U+1F600).');
});

test("an empty pattern has no tokens", () => {
  assert.deepEqual(explain(""), []);
});

test("the dot", () => {
  assert.deepEqual(brief("."), [["any", ".", "Matches any one character except a line break (any character at all when the s flag is set)."]]);
});

test("class escapes", () => {
  assert.deepEqual(brief("\\d\\D\\w\\W\\s\\S"), [
    ["escape", "\\d", "Matches a digit (0-9)."],
    ["escape", "\\D", "Matches any character that is not a digit."],
    ["escape", "\\w", "Matches a word character (A-Z, a-z, 0-9 or _)."],
    ["escape", "\\W", "Matches any character that is not a word character."],
    ["escape", "\\s", "Matches a whitespace character (space, tab, line break or another Unicode space)."],
    ["escape", "\\S", "Matches any character that is not whitespace."],
  ]);
});

test("character escapes: control characters, hex, unicode, NUL, caret notation and escaped metacharacters", () => {
  assert.deepEqual(brief("\\n\\t\\r\\v\\f\\0"), [
    ["escape", "\\n", "Matches a line feed (newline)."],
    ["escape", "\\t", "Matches a tab."],
    ["escape", "\\r", "Matches a carriage return."],
    ["escape", "\\v", "Matches a vertical tab."],
    ["escape", "\\f", "Matches a form feed."],
    ["escape", "\\0", "Matches the NUL character (U+0000)."],
  ]);
  assert.deepEqual(brief("\\x41\\u00e9\\u{1F600}\\cJ"), [
    ["escape", "\\x41", 'Matches the character "A".'],
    ["escape", "\\u00e9", 'Matches the character "é" (U+00E9).'],
    ["escape", "\\u{1F600}", 'Matches the character "\u{1F600}" (U+1F600).'],
    ["escape", "\\cJ", "Matches the control character Ctrl+J."],
  ]);
  assert.deepEqual(brief("\\.\\\\\\("), [
    ["escape", "\\.", 'Matches the literal character ".".'],
    ["escape", "\\\\", 'Matches the literal character "\\".'],
    ["escape", "\\(", 'Matches the literal character "(".'],
  ]);
});

test("unicode property escapes are shown, not looked up", () => {
  assert.deepEqual(brief("\\p{L}\\P{Lu}"), [
    ["escape", "\\p{L}", "Matches any character with the Unicode property L (needs the u or v flag)."],
    ["escape", "\\P{Lu}", "Matches any character without the Unicode property Lu (needs the u or v flag)."],
  ]);
});

test("character classes: ranges, negation, escapes inside, special characters, empty classes", () => {
  assert.deepEqual(brief("[a-z]"), [["class", "[a-z]", 'Matches one character that is one of: any character from "a" to "z".']]);
  assert.deepEqual(brief("[^0-9_]"), [["class", "[^0-9_]", 'Matches one character that is not one of: any character from "0" to "9"; the character "_".']]);
  assert.deepEqual(brief("[\\d.]"), [["class", "[\\d.]", 'Matches one character that is one of: a digit (0-9); the character ".".']]);
  assert.deepEqual(brief("[\\w-]"), [["class", "[\\w-]", 'Matches one character that is one of: a word character (A-Z, a-z, 0-9 or _); the character "-".']]);
  assert.deepEqual(brief("[a-\\d]"), [["class", "[a-\\d]", 'Matches one character that is one of: the character "a"; the character "-"; a digit (0-9).']]);
  assert.deepEqual(brief("[\\]x]"), [["class", "[\\]x]", 'Matches one character that is one of: the literal character "]"; the character "x".']]);
  assert.deepEqual(brief("[\\b]"), [["class", "[\\b]", "Matches one character that is one of: a backspace character."]]);
  assert.deepEqual(brief("[]"), [["class", "[]", "An empty character class: it can never match anything."]]);
  assert.deepEqual(brief("[^]"), [["class", "[^]", "Matches any single character, including line breaks."]]);
  assert.match(explain("[z-a]")[0].description, /out of order \(a syntax error\)/);
});

test("quantifiers: greedy, lazy and counted, each attached to the previous item", () => {
  assert.deepEqual(brief("a*a+a?"), [
    ["literal", "a", 'Matches the character "a".'],
    ["quantifier", "*", "Repeats the previous item zero or more times, as many as possible (greedy)."],
    ["literal", "a", 'Matches the character "a".'],
    ["quantifier", "+", "Repeats the previous item one or more times, as many as possible (greedy)."],
    ["literal", "a", 'Matches the character "a".'],
    ["quantifier", "?", "Repeats the previous item zero or one time (optional), as many as possible (greedy)."],
  ]);
  assert.deepEqual(brief("a*?").slice(1), [["quantifier", "*?", "Repeats the previous item zero or more times, as few as possible (lazy)."]]);
  assert.deepEqual(brief("a+?").slice(1), [["quantifier", "+?", "Repeats the previous item one or more times, as few as possible (lazy)."]]);
  assert.deepEqual(brief("a??").slice(1), [["quantifier", "??", "Repeats the previous item zero or one time (optional), as few as possible (lazy)."]]);
  assert.deepEqual(brief("a{3}").slice(1), [["quantifier", "{3}", "Repeats the previous item exactly 3 times, as many as possible (greedy)."]]);
  assert.deepEqual(brief("a{1}").slice(1)[0][2], "Repeats the previous item exactly 1 time, as many as possible (greedy).");
  assert.deepEqual(brief("a{2,}").slice(1), [["quantifier", "{2,}", "Repeats the previous item 2 or more times, as many as possible (greedy)."]]);
  assert.deepEqual(brief("a{2,5}?").slice(1), [["quantifier", "{2,5}?", "Repeats the previous item between 2 and 5 times, as few as possible (lazy)."]]);
  assert.match(brief("a{5,2}")[1][2], /impossible range \(a syntax error\)/);
});

test("a brace that is not a quantifier is an ordinary character", () => {
  assert.deepEqual(brief("a{,3}").map((t) => t[0]), ["literal", "literal", "literal", "literal", "literal"]);
  assert.deepEqual(brief("{x}").map((t) => t[0]), ["literal", "literal", "literal"]);
});

test("capturing, non-capturing and named groups are numbered in order and nest by depth", () => {
  assert.deepEqual(brief("(a)"), [
    ["group-open", "(", "Start of capturing group 1: the text it matches is remembered."],
    ["literal", "a", 'Matches the character "a".'],
    ["group-close", ")", "End of the capturing group 1."],
  ]);
  assert.deepEqual(brief("(?:a)"), [
    ["group-open", "(?:", "Start of a non-capturing group: groups items together without remembering the match."],
    ["literal", "a", 'Matches the character "a".'],
    ["group-close", ")", "End of the non-capturing group."],
  ]);
  assert.deepEqual(brief("(?<id>a)"), [
    ["group-open", "(?<id>", 'Start of capturing group 1 named "id".'],
    ["literal", "a", 'Matches the character "a".'],
    ["group-close", ")", 'End of the named group "id" (group 1).'],
  ]);
  assert.deepEqual(explain("(a(b))").map((t) => t.depth), [0, 1, 1, 2, 1, 0]);
  const numbered = explain("(a)(?:b)(?<n>c)(d)").filter((t) => t.type === "group-open").map((t) => t.description);
  assert.match(numbered[0], /capturing group 1:/);
  assert.match(numbered[1], /non-capturing/);
  assert.match(numbered[2], /capturing group 2 named "n"/);
  assert.match(numbered[3], /capturing group 3:/);
});

test("lookahead and lookbehind, positive and negative", () => {
  assert.deepEqual(brief("(?=a)"), [
    ["group-open", "(?=", "Start of a positive lookahead: the text that follows must match what is inside, but it is not consumed."],
    ["literal", "a", 'Matches the character "a".'],
    ["group-close", ")", "End of the lookahead."],
  ]);
  assert.deepEqual(brief("(?!a)")[0], ["group-open", "(?!", "Start of a negative lookahead: the text that follows must NOT match what is inside; nothing is consumed."]);
  assert.deepEqual(brief("(?!a)")[2], ["group-close", ")", "End of the negative lookahead."]);
  assert.deepEqual(brief("(?<=a)")[0], ["group-open", "(?<=", "Start of a positive lookbehind: the text before this point must match what is inside; nothing is consumed."]);
  assert.deepEqual(brief("(?<=a)")[2], ["group-close", ")", "End of the lookbehind."]);
  assert.deepEqual(brief("(?<!a)")[0], ["group-open", "(?<!", "Start of a negative lookbehind: the text before this point must NOT match what is inside; nothing is consumed."]);
  assert.deepEqual(brief("(?<!a)")[2], ["group-close", ")", "End of the negative lookbehind."]);
});

test("lookarounds do not take a group number", () => {
  const d = explain("(?=a)(b)").filter((t) => t.type === "group-open").map((t) => t.description);
  assert.match(d[1], /capturing group 1:/);
});

test("anchors and word boundaries", () => {
  assert.deepEqual(brief("^a$"), [
    ["anchor", "^", "Start of the text (start of any line when the m flag is set)."],
    ["literal", "a", 'Matches the character "a".'],
    ["anchor", "$", "End of the text (end of any line when the m flag is set)."],
  ]);
  assert.deepEqual(brief("\\b\\B"), [
    ["anchor", "\\b", "Word boundary: the position between a word character and a non-word character (or the start or end of the text)."],
    ["anchor", "\\B", "Not a word boundary: a position with word characters on both sides or on neither side."],
  ]);
});

test("alternation", () => {
  assert.deepEqual(brief("a|b")[1], ["alternation", "|", "Alternation: match what is on the left of this bar or what is on the right. It splits the enclosing group, or the whole pattern."]);
});

test("backreferences: numbered, multi-digit and named", () => {
  assert.deepEqual(brief("\\1"), [["backreference", "\\1", "Backreference: matches the same text that capturing group 1 matched."]]);
  assert.deepEqual(brief("\\12"), [["backreference", "\\12", "Backreference: matches the same text that capturing group 12 matched."]]);
  assert.deepEqual(brief("\\k<name>"), [["backreference", "\\k<name>", 'Named backreference: matches the same text that the group named "name" matched.']]);
});

test("things the explainer admits it does not explain are marked, not guessed", () => {
  assert.deepEqual(brief("(?i:a)")[0], ["group-open", "(?i:", "Start of a group with inline modifiers (flags switched on or off inside it). This tool does not explain which flags."]);
  assert.deepEqual(brief("(?~a)")[0], ["group-open", "(?", "Start of a group form this tool does not recognise."]);
  assert.deepEqual(brief("\\c")[0], ["unknown", "\\c", "Matches a \\c escape without a letter (not explained)."]);
  assert.ok(EXPLAIN_LIMITS.length >= 4);
  assert.ok(EXPLAIN_LIMITS.every((s) => typeof s === "string" && s.length > 20));
});

test("obvious syntax errors are flagged, and the engine agrees that each one is an error", () => {
  const cases = [
    [")", /closing parenthesis with no opening one/],
    ["(a", /capturing group 1 opened at position 0 is never closed/],
    ["*a", /nothing before it to repeat/],
    ["a**", /nothing before it to repeat/],
    ["|*", /nothing before it to repeat/],
    ["^*", /nothing before it to repeat/],
    ["(*", /nothing before it to repeat/],
    ["{2}", /nothing before it to repeat/],
    ["a\\", /backslash at the end of the pattern/],
    ["[abc", /never closed with \]/],
  ];
  for (const [pattern, message] of cases) {
    assert.ok(explain(pattern).some((t) => t.type === "unknown" && message.test(t.description)), pattern);
    assert.throws(() => new RegExp(pattern), SyntaxError, "the engine also rejects " + pattern);
  }
});

test("a realistic pattern is explained end to end", () => {
  const tokens = explain("^(?<user>[\\w.+-]+)@(\\w+\\.)+com$");
  assert.deepEqual(tokens.map((t) => t.text), ["^", "(?<user>", "[\\w.+-]", "+", ")", "@", "(", "\\w", "+", "\\.", ")", "+", "c", "o", "m", "$"]);
  assert.deepEqual(tokens.map((t) => t.type), ["anchor", "group-open", "class", "quantifier", "group-close", "literal", "group-open", "escape", "quantifier", "escape", "group-close", "quantifier", "literal", "literal", "literal", "anchor"]);
  assert.deepEqual(tokens.map((t) => t.depth), [0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0]);
});
