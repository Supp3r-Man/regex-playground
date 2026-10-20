// Regex core: matching, text segmentation, replacement, a partial pattern explainer and URL-hash state.
// Loaded as a plain script in the page and the Web Worker, and with require() in Node tests. No DOM access in here.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PlaygroundCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULT_LIMIT = 1000;
  const FLAG_CHARS = "dgimsuy"; // the flags the page offers; runMatches accepts anything the engine accepts

  function describeError(e) {
    return e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
  }

  // Advance past index i the way String.prototype.matchAll does: one UTF-16 unit, or a whole surrogate pair under /u.
  function advance(text, i, unicode) {
    if (unicode && i + 1 < text.length) {
      const hi = text.charCodeAt(i);
      const lo = text.charCodeAt(i + 1);
      if (hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) return i + 2;
    }
    return i + 1;
  }

  function pair(p) {
    return p ? [p[0], p[1]] : null;
  }

  // Run a pattern over a text and collect matches. Never throws: a bad pattern or flag set returns { ok: false, error }.
  // Without the g flag only the first match is returned, as with RegExp.prototype.exec. All indices are UTF-16 code units.
  // This function cannot stop a catastrophically backtracking pattern: the page runs it in a Worker and terminates it.
  function runMatches(pattern, flags, text, opts) {
    pattern = String(pattern);
    flags = String(flags);
    text = String(text);
    let limit = opts && Number.isInteger(opts.limit) && opts.limit >= 1 ? opts.limit : DEFAULT_LIMIT;
    let re;
    try {
      re = new RegExp(pattern, flags);
    } catch (e) {
      return { ok: false, error: describeError(e), flags: flags, hasIndices: false, matches: [], truncated: false, limit: limit };
    }
    const global = re.global;
    const unicode = re.unicode || re.unicodeSets === true;
    const matches = [];
    let truncated = false;
    // Every iteration moves lastIndex forward (empty matches are stepped over by hand), so the loop ends; the guard is belt and braces.
    let guard = text.length * 2 + limit + 10;
    while (guard-- > 0) {
      const m = re.exec(text);
      if (m === null) break;
      if (matches.length >= limit) {
        truncated = true;
        break;
      }
      const groupNames = m.groups ? Object.keys(m.groups) : [];
      const groups = [];
      for (let g = 1; g < m.length; g++) {
        groups.push({ number: g, text: m[g] === undefined ? null : m[g], indices: m.indices ? pair(m.indices[g]) : null });
      }
      const named = groupNames.map((name) => ({
        name: name,
        text: m.groups[name] === undefined ? null : m.groups[name],
        indices: m.indices && m.indices.groups ? pair(m.indices.groups[name]) : null,
      }));
      matches.push({ index: m.index, end: m.index + m[0].length, text: m[0], groups: groups, named: named, indices: m.indices ? pair(m.indices[0]) : null });
      if (!global) break;
      if (m[0] === "") re.lastIndex = advance(text, re.lastIndex > m.index ? re.lastIndex : m.index, unicode);
    }
    return { ok: true, error: null, flags: re.flags, hasIndices: re.hasIndices === true, matches: matches, truncated: truncated, limit: limit };
  }

  // Split text into ordered, non-overlapping segments { text, matchIndex } whose texts concatenate to the input.
  // matchIndex is the position in `matches`, or null for text between matches. An empty match becomes a segment with
  // text "" (the page draws a marker for it). A match that overlaps an earlier one, or lies outside the text, is skipped.
  function segmentText(text, matches) {
    text = String(text);
    const segments = [];
    let cursor = 0;
    (matches || []).forEach((m, k) => {
      if (!m || !Number.isInteger(m.index) || !Number.isInteger(m.end)) return;
      if (m.index < cursor || m.end < m.index || m.end > text.length) return;
      if (m.index > cursor) segments.push({ text: text.slice(cursor, m.index), matchIndex: null });
      segments.push({ text: text.slice(m.index, m.end), matchIndex: k });
      cursor = m.end;
    });
    if (cursor < text.length) segments.push({ text: text.slice(cursor), matchIndex: null });
    return segments;
  }

  // Replacement with JavaScript syntax ($1, $<name>, $&, $$, $`, $'), done by String.prototype.replace.
  // Without the g flag only the first match is replaced. Same Worker caveat as runMatches.
  function applyReplacement(pattern, flags, text, replacement) {
    let re;
    try {
      re = new RegExp(String(pattern), String(flags));
    } catch (e) {
      return { ok: false, error: describeError(e), result: "" };
    }
    try {
      return { ok: true, error: null, result: String(text).replace(re, String(replacement)) };
    } catch (e) {
      return { ok: false, error: describeError(e), result: "" };
    }
  }

  // ---- the explainer: a small hand-written tokenizer. It is partial; see EXPLAIN_LIMITS. ----

  const EXPLAIN_LIMITS = [
    "Inline modifier groups such as (?i:...) are recognised but not explained.",
    "Unicode property names inside \\p{...} are shown, not looked up.",
    "Class set syntax from the v flag (nested classes, && and --) is not understood; the characters are read as in a plain class.",
    "Duplicate named groups, and the choice between a backreference and a legacy octal escape (\\1 when there is no group 1), are not resolved.",
    "It reports a few obvious syntax errors but does not validate the pattern: the engine's own error message is the authority.",
    "It does not know the flags, so it describes ^, $ and . for both the default and the m / s flag.",
  ];

  function hex(n, width) {
    let s = n.toString(16).toUpperCase();
    while (s.length < width) s = "0" + s;
    return s;
  }

  // A readable name for a code point: the quoted character when printable, otherwise just U+XXXX.
  function charName(cp) {
    if (cp === 0x20) return '" " (a space)';
    if (cp > 0x20 && cp < 0x7f) return '"' + String.fromCodePoint(cp) + '"';
    if (cp > 0x9f && !(cp >= 0xd800 && cp <= 0xdfff) && cp !== 0x2028 && cp !== 0x2029 && cp !== 0xa0 && cp !== 0xfeff) {
      return '"' + String.fromCodePoint(cp) + '" (U+' + hex(cp, 4) + ")";
    }
    return "U+" + hex(cp, 4);
  }

  const SET_NOUNS = {
    d: "a digit (0-9)",
    D: "any character that is not a digit",
    w: "a word character (A-Z, a-z, 0-9 or _)",
    W: "any character that is not a word character",
    s: "a whitespace character (space, tab, line break or another Unicode space)",
    S: "any character that is not whitespace",
  };
  const CHAR_NOUNS = { t: "a tab", n: "a line feed (newline)", r: "a carriage return", v: "a vertical tab", f: "a form feed" };

  // Read the escape that starts at pattern[i] === "\\". Returns { end, kind, cp, noun, full }:
  // kind is "set" (\d, \w ...), "char" (a single character, cp set), "anchor", "backref" or "unknown".
  function readEscape(p, i, inClass) {
    if (i + 1 >= p.length) return { end: i + 1, kind: "unknown", noun: "a backslash at the end of the pattern (a syntax error)" };
    const c = p[i + 1];
    let m;
    if (SET_NOUNS[c]) return { end: i + 2, kind: "set", noun: SET_NOUNS[c] };
    if (CHAR_NOUNS[c]) return { end: i + 2, kind: "char", cp: c === "t" ? 9 : c === "n" ? 10 : c === "r" ? 13 : c === "v" ? 11 : 12, noun: CHAR_NOUNS[c] };
    if (c === "b" && inClass) return { end: i + 2, kind: "char", cp: 8, noun: "a backspace character" };
    if (c === "b") return { end: i + 2, kind: "anchor", full: "Word boundary: the position between a word character and a non-word character (or the start or end of the text)." };
    if (c === "B") return { end: i + 2, kind: "anchor", full: "Not a word boundary: a position with word characters on both sides or on neither side." };
    if (c === "0" && !/[0-9]/.test(p[i + 2] || "")) return { end: i + 2, kind: "char", cp: 0, noun: "the NUL character (U+0000)" };
    if (/[0-9]/.test(c)) {
      if (inClass || c === "0") return { end: i + 2, kind: "unknown", noun: "a legacy octal escape (not explained)" };
      m = /^[0-9]+/.exec(p.slice(i + 1));
      return { end: i + 1 + m[0].length, kind: "backref", full: "Backreference: matches the same text that capturing group " + m[0] + " matched." };
    }
    if (c === "k" && !inClass && (m = /^\\k<([^>]+)>/.exec(p.slice(i)))) {
      return { end: i + m[0].length, kind: "backref", full: 'Named backreference: matches the same text that the group named "' + m[1] + '" matched.' };
    }
    if (c === "x" && (m = /^\\x([0-9a-fA-F]{2})/.exec(p.slice(i)))) {
      const cp = parseInt(m[1], 16);
      return { end: i + 4, kind: "char", cp: cp, noun: "the character " + charName(cp) };
    }
    if (c === "u" && (m = /^\\u\{([0-9a-fA-F]{1,6})\}/.exec(p.slice(i)))) {
      const cp = parseInt(m[1], 16);
      if (cp <= 0x10ffff) return { end: i + m[0].length, kind: "char", cp: cp, noun: "the character " + charName(cp) };
    }
    if (c === "u" && (m = /^\\u([0-9a-fA-F]{4})/.exec(p.slice(i)))) {
      const cp = parseInt(m[1], 16);
      return { end: i + 6, kind: "char", cp: cp, noun: "the character " + charName(cp) };
    }
    if (c === "c" && (m = /^\\c([A-Za-z])/.exec(p.slice(i)))) {
      return { end: i + 3, kind: "char", cp: m[1].toUpperCase().charCodeAt(0) - 64, noun: "the control character Ctrl+" + m[1].toUpperCase() };
    }
    if ((c === "p" || c === "P") && (m = /^\\[pP]\{([^}]*)\}/.exec(p.slice(i)))) {
      return { end: i + m[0].length, kind: "set", noun: (c === "p" ? "any character with" : "any character without") + " the Unicode property " + m[1] + " (needs the u or v flag)" };
    }
    if (c === "c") return { end: i + 2, kind: "unknown", noun: "a \\c escape without a letter (not explained)" };
    const cp = p.codePointAt(i + 1);
    return { end: i + 1 + (cp > 0xffff ? 2 : 1), kind: "char", cp: cp, noun: "the literal character " + charName(cp) };
  }

  const LOOK = {
    "?=": ["lookahead", "Start of a positive lookahead: the text that follows must match what is inside, but it is not consumed."],
    "?!": ["negative lookahead", "Start of a negative lookahead: the text that follows must NOT match what is inside; nothing is consumed."],
    "?<=": ["lookbehind", "Start of a positive lookbehind: the text before this point must match what is inside; nothing is consumed."],
    "?<!": ["negative lookbehind", "Start of a negative lookbehind: the text before this point must NOT match what is inside; nothing is consumed."],
  };

  function joinItems(items) {
    return items.join("; ");
  }

  // Describe a [...] class starting at p[i] === "[". Returns { end, description } or null when it is never closed.
  function readClass(p, i) {
    let j = i + 1;
    const negated = p[j] === "^";
    if (negated) j++;
    const items = [];
    function atom() {
      if (p[j] === "\\") {
        const e = readEscape(p, j, true);
        j = e.end;
        return { cp: e.kind === "char" ? e.cp : null, noun: e.noun || "an escape this tool does not explain" };
      }
      const cp = p.codePointAt(j);
      j += cp > 0xffff ? 2 : 1;
      return { cp: cp, noun: "the character " + charName(cp) };
    }
    while (j < p.length && p[j] !== "]") {
      const a = atom();
      if (a.cp !== null && p[j] === "-" && j + 1 < p.length && p[j + 1] !== "]") {
        const save = j;
        j++;
        const b = atom();
        if (b.cp !== null) {
          items.push(a.cp > b.cp ? "a range from " + charName(a.cp) + " to " + charName(b.cp) + " that is out of order (a syntax error)" : "any character from " + charName(a.cp) + " to " + charName(b.cp));
          continue;
        }
        j = save; // "-" next to a class escape such as \w: read the pieces separately
      }
      items.push(a.noun);
      if (a.cp !== null && p[j] === "-" && j + 1 < p.length && p[j + 1] !== "]") {
        j++;
        items.push("the character " + charName(45));
        items.push(atom().noun);
      }
    }
    if (j >= p.length) return null;
    let description;
    if (items.length === 0) {
      description = negated ? "Matches any single character, including line breaks." : "An empty character class: it can never match anything.";
    } else {
      description = "Matches one character that is " + (negated ? "not " : "") + "one of: " + joinItems(items) + ".";
    }
    return { end: j + 1, description: description };
  }

  // Break a pattern into tokens { type, text, description, start, end, depth }. Never throws, whatever the input.
  // type: literal, any, escape, class, quantifier, group-open, group-close, anchor, alternation, backreference, unknown.
  function explain(pattern) {
    const p = String(pattern);
    const tokens = [];
    const stack = []; // open groups: { label, start }
    let groupCount = 0;
    let canQuantify = false;
    let i = 0;

    function push(type, start, end, description) {
      tokens.push({ type: type, text: p.slice(start, end), description: description, start: start, end: end, depth: stack.length });
    }

    while (i < p.length) {
      const c = p[i];
      let m;
      if (c === "\\") {
        const e = readEscape(p, i, false);
        if (e.kind === "anchor") {
          push("anchor", i, e.end, e.full);
          canQuantify = false;
        } else if (e.kind === "backref") {
          push("backreference", i, e.end, e.full);
          canQuantify = true;
        } else if (e.kind === "unknown") {
          push("unknown", i, e.end, "Matches " + e.noun + ".");
          canQuantify = true;
        } else {
          push("escape", i, e.end, "Matches " + e.noun + ".");
          canQuantify = true;
        }
        i = e.end;
      } else if (c === "[") {
        const cls = readClass(p, i);
        if (!cls) {
          push("unknown", i, p.length, "A character class that is never closed with ] (a syntax error).");
          i = p.length;
        } else {
          push("class", i, cls.end, cls.description);
          i = cls.end;
          canQuantify = true;
        }
      } else if (c === "(") {
        let len = 1;
        let description;
        let label;
        if (p[i + 1] !== "?") {
          groupCount++;
          label = "capturing group " + groupCount;
          description = "Start of capturing group " + groupCount + ": the text it matches is remembered.";
        } else if (p.startsWith("(?:", i)) {
          len = 3;
          label = "non-capturing group";
          description = "Start of a non-capturing group: groups items together without remembering the match.";
        } else if ((m = /^\(\?<([^>=!][^>]*)>/.exec(p.slice(i)))) {
          groupCount++;
          len = m[0].length;
          label = 'named group "' + m[1] + '" (group ' + groupCount + ")";
          description = 'Start of capturing group ' + groupCount + ' named "' + m[1] + '".';
        } else if ((m = /^\(\?(<=|<!|=|!)/.exec(p.slice(i)))) {
          len = m[0].length;
          label = LOOK["?" + m[1]][0];
          description = LOOK["?" + m[1]][1];
        } else if ((m = /^\(\?[a-zA-Z]*(?:-[a-zA-Z]*)?:/.exec(p.slice(i)))) {
          len = m[0].length;
          label = "modifier group";
          description = "Start of a group with inline modifiers (flags switched on or off inside it). This tool does not explain which flags.";
        } else {
          len = 2;
          label = "group";
          description = "Start of a group form this tool does not recognise.";
        }
        push("group-open", i, i + len, description);
        stack.push({ label: label, start: i });
        i += len;
        canQuantify = false;
      } else if (c === ")") {
        if (stack.length === 0) {
          push("unknown", i, i + 1, "A closing parenthesis with no opening one (a syntax error).");
        } else {
          const g = stack.pop();
          push("group-close", i, i + 1, "End of the " + g.label + ".");
        }
        i++;
        canQuantify = true;
      } else if (c === "|") {
        push("alternation", i, i + 1, "Alternation: match what is on the left of this bar or what is on the right. It splits the enclosing group, or the whole pattern.");
        i++;
        canQuantify = false;
      } else if (c === "^") {
        push("anchor", i, i + 1, "Start of the text (start of any line when the m flag is set).");
        i++;
        canQuantify = false;
      } else if (c === "$") {
        push("anchor", i, i + 1, "End of the text (end of any line when the m flag is set).");
        i++;
        canQuantify = false;
      } else if (c === ".") {
        push("any", i, i + 1, "Matches any one character except a line break (any character at all when the s flag is set).");
        i++;
        canQuantify = true;
      } else if (c === "*" || c === "+" || c === "?" || (c === "{" && (m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(p.slice(i))))) {
        let len = 1;
        let base;
        if (c === "*") base = "zero or more times";
        else if (c === "+") base = "one or more times";
        else if (c === "?") base = "zero or one time (optional)";
        else {
          len = m[0].length;
          const lo = parseInt(m[1], 10);
          if (m[2] === undefined) base = "exactly " + lo + (lo === 1 ? " time" : " times");
          else if (m[3] === "") base = lo + " or more times";
          else if (parseInt(m[3], 10) < lo) base = "an impossible range (a syntax error)";
          else base = "between " + lo + " and " + parseInt(m[3], 10) + " times";
        }
        const lazy = p[i + len] === "?";
        if (lazy) len++;
        const suffix = lazy ? ", as few as possible (lazy)" : ", as many as possible (greedy)";
        if (!canQuantify) push("unknown", i, i + len, "A quantifier with nothing before it to repeat (a syntax error).");
        else push("quantifier", i, i + len, "Repeats the previous item " + base + suffix + ".");
        i += len;
        canQuantify = false;
      } else {
        const cp = p.codePointAt(i);
        const len = cp > 0xffff ? 2 : 1;
        push("literal", i, i + len, "Matches the character " + charName(cp) + ".");
        i += len;
        canQuantify = true;
      }
    }
    stack.forEach((g) => {
      tokens.push({ type: "unknown", text: "", description: "The " + g.label + " opened at position " + g.start + " is never closed (a syntax error).", start: p.length, end: p.length, depth: 0 });
    });
    return tokens;
  }

  // ---- URL hash state: #p=<pattern>&f=<flags>&t=<text>&r=<replacement>, percent-encoded. Nothing leaves the browser. ----

  const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

  // encodeURIComponent throws on a lone surrogate, so those become %uXXXX. A real "%" is always encoded as %25,
  // so "%u" can never appear in normal output and the encoding stays unambiguous.
  function encodeField(s) {
    s = String(s);
    if (!LONE_SURROGATE.test(s)) return encodeURIComponent(s);
    let out = "";
    let run = "";
    for (let i = 0; i < s.length; i++) {
      const unit = s.charCodeAt(i);
      const isHigh = unit >= 0xd800 && unit <= 0xdbff;
      const isLow = unit >= 0xdc00 && unit <= 0xdfff;
      if (isHigh && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) {
        run += s[i] + s[i + 1];
        i++;
      } else if (isHigh || isLow) {
        out += encodeURIComponent(run) + "%u" + hex(unit, 4);
        run = "";
      } else {
        run += s[i];
      }
    }
    return out + encodeURIComponent(run);
  }

  function decodeField(s) {
    return s
      .split(/(%u[0-9a-fA-F]{4})/)
      .map((part, i) => (i % 2 === 1 ? String.fromCharCode(parseInt(part.slice(2), 16)) : decodeURIComponent(part)))
      .join("");
  }

  function encodeState(state) {
    const s = state || {};
    return "p=" + encodeField(s.pattern || "") + "&f=" + encodeField(s.flags || "") + "&t=" + encodeField(s.text || "") + "&r=" + encodeField(s.replacement || "");
  }

  // Parse a hash (with or without the leading "#"). Never throws: missing, unknown or malformed fields become "".
  function decodeState(hash) {
    const state = { pattern: "", flags: "", text: "", replacement: "" };
    if (typeof hash !== "string") return state;
    const keys = { p: "pattern", f: "flags", t: "text", r: "replacement" };
    hash
      .replace(/^#/, "")
      .split("&")
      .forEach((part) => {
        const eq = part.indexOf("=");
        if (eq < 1) return;
        const name = keys[part.slice(0, eq)];
        if (!name) return;
        try {
          state[name] = decodeField(part.slice(eq + 1));
        } catch (e) {
          state[name] = ""; // malformed percent-escape: drop this field, keep the others
        }
      });
    return state;
  }

  return {
    DEFAULT_LIMIT: DEFAULT_LIMIT,
    FLAG_CHARS: FLAG_CHARS,
    EXPLAIN_LIMITS: EXPLAIN_LIMITS,
    runMatches: runMatches,
    segmentText: segmentText,
    applyReplacement: applyReplacement,
    explain: explain,
    encodeState: encodeState,
    decodeState: decodeState,
  };
});
