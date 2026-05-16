import { Card, CardType, DEFAULT_DECK, Settings } from "./types";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find the first `#prefix/Path` deck tag in `text` and strip every such tag.
 * A bare `#prefix` (no path) maps to the default deck.
 */
function extractDeck(text: string, prefix: string): { deck: string | null; stripped: string } {
  const re = new RegExp(`(^|\\s)#${escapeRegex(prefix)}(/[\\w/-]+)?(?=\\s|$)`, "g");
  let deck: string | null = null;
  const stripped = text.replace(re, (_m, lead: string, path?: string) => {
    if (deck === null) deck = path ? path.slice(1) : DEFAULT_DECK;
    return lead;
  });
  return { deck, stripped: stripped.replace(/[ \t]{2,}/g, " ").trim() };
}

/** djb2 string hash -> base36. Deterministic, no crypto needed. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function cardId(file: string, type: CardType, raw: string, variant: string): string {
  return hash(`${file}|${type}|${raw}|${variant}`);
}

/** Whitespace-normalized `front | back`, used to fuzzy-match cards after edits. */
function normalizeRaw(front: string, back: string): string {
  return `${front} | ${back}`.replace(/\s+/g, " ").trim();
}

/** Leading markdown markers (list bullets, ordered numbers, blockquote `>`). */
const MARKER_RE = /^(\s*(?:[-*+]\s+|\d+[.)]\s+|>\s?)*)/;

/** A line whose content ends with `:::` opens a flashcard block. */
const HEADER_RE = /:::\s*$/;

/** Ranges of inline code (`...`) within a string, as [start, end) pairs. */
function inlineCodeRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /`+/g;
  let m: RegExpExecArray | null;
  let open: { idx: number; len: number } | null = null;
  while ((m = re.exec(line))) {
    if (!open) {
      open = { idx: m.index, len: m[0].length };
    } else if (m[0].length === open.len) {
      ranges.push([open.idx, m.index + m[0].length]);
      open = null;
    }
  }
  return ranges;
}

/** Ranges of `$...$` and single-line `$$...$$` math, so LaTeX `{}` isn't read as cloze. */
function mathRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === "$") {
      if (line[i + 1] === "$") {
        const close = line.indexOf("$$", i + 2);
        if (close >= 0) {
          ranges.push([i, close + 2]);
          i = close + 2;
          continue;
        }
        i += 2;
        continue;
      }
      const close = line.indexOf("$", i + 1);
      if (close > i) {
        ranges.push([i, close + 1]);
        i = close + 1;
        continue;
      }
    }
    i++;
  }
  return ranges;
}

function insideRange(idx: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => idx >= s && idx < e);
}

function indentWidth(line: string): number {
  const m = line.match(/^[ \t]*/);
  return m ? m[0].replace(/\t/g, "    ").length : 0;
}

/** Find a delimiter token in `content`, not inside code/math, with text on both sides. */
function findDelimiter(
  content: string,
  delim: string,
  ranges: Array<[number, number]>,
  offset: number,
): number {
  let from = 0;
  while (true) {
    const idx = content.indexOf(delim, from);
    if (idx < 0) return -1;
    if (insideRange(idx + offset, ranges)) {
      from = idx + delim.length;
      continue;
    }
    const before = content.slice(0, idx).trim();
    const after = content.slice(idx + delim.length).trim();
    if (before && after) return idx;
    from = idx + delim.length;
  }
}

interface ClozeSpan {
  start: number;
  end: number;
  /** Group number for `{n|text}`, or null for an ungrouped `{text}`. */
  group: number | null;
}

interface ClozeResult {
  cleanText: string;
  spans: ClozeSpan[];
}

/**
 * Strip `{` `}` markers, returning clean text and each deletion span.
 * `{2|text}` assigns the span to group 2 (same-numbered spans hide together).
 */
function parseCloze(content: string, ranges: Array<[number, number]>, offset: number): ClozeResult {
  let cleanText = "";
  const spans: ClozeSpan[] = [];
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === "{" && !insideRange(i + offset, ranges)) {
      const close = content.indexOf("}", i + 1);
      if (close > i + 1) {
        const inner = content.slice(i + 1, close);
        const grouped = inner.match(/^(\d+)\|([\s\S]+)$/);
        const value = grouped ? grouped[2] : inner;
        const group = grouped ? Number(grouped[1]) : null;
        const start = cleanText.length;
        cleanText += value;
        spans.push({ start, end: cleanText.length, group });
        i = close + 1;
        continue;
      }
    }
    cleanText += ch;
    i++;
  }
  return { cleanText, spans };
}

/** Group cloze spans into cards: ungrouped -> one each, grouped -> one per number. */
function clozeCards(
  spans: ClozeSpan[],
): Array<{ variant: string; spans: Array<[number, number]> }> {
  const cards: Array<{ variant: string; spans: Array<[number, number]> }> = [];
  const groups = new Map<number, Array<[number, number]>>();
  spans.forEach((sp, idx) => {
    if (sp.group === null) {
      cards.push({ variant: String(idx), spans: [[sp.start, sp.end]] });
    } else {
      let bucket = groups.get(sp.group);
      if (!bucket) {
        bucket = [];
        groups.set(sp.group, bucket);
      }
      bucket.push([sp.start, sp.end]);
    }
  });
  for (const [num, bucket] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    cards.push({ variant: `g${num}`, spans: bucket });
  }
  return cards;
}

/** Collect indented child lines beneath a prompt line (used for `;;` answers). */
function collectChildren(
  lines: string[],
  promptLine: number,
  promptIndent: number,
  deckPrefix: string,
): Array<{ text: string; line: number }> {
  const children: Array<{ text: string; line: number }> = [];
  for (let j = promptLine + 1; j < lines.length; j++) {
    const child = lines[j];
    if (!child.trim()) {
      children.push({ text: "", line: j });
      continue;
    }
    if (indentWidth(child) <= promptIndent) break;
    const markerLen = (child.match(MARKER_RE)?.[1] ?? "").length;
    children.push({ text: extractDeck(child.slice(markerLen).trim(), deckPrefix).stripped, line: j });
  }
  while (children.length && children[children.length - 1].text === "") children.pop();
  return children;
}

/**
 * Parse one direct-child line of a `:::` block into card(s). A line only
 * produces cards if it contains a delimiter (`::`, `>>`, `<<`, `<>`, `{}`, `;;`).
 */
function parseLine(
  lines: string[],
  lineNo: number,
  blockDeck: string,
  file: string,
  settings: Settings,
): Card[] {
  const line = lines[lineNo];
  const markerLen = (line.match(MARKER_RE)?.[1] ?? "").length;
  const rawContent = line.slice(markerLen);
  if (!rawContent.trim()) return [];

  const lineDeck = extractDeck(rawContent, settings.deckTagPrefix);
  const deck = lineDeck.deck ?? blockDeck;
  const content = lineDeck.deck ? lineDeck.stripped : rawContent;
  // A nested `:::` header is not itself a card.
  if (HEADER_RE.test(content)) return [];
  const ranges = lineDeck.deck
    ? []
    : [...inlineCodeRanges(line), ...mathRanges(line)];
  const out: Card[] = [];

  // --- Multiline: child ends with `;;`, answer is its own indented block ---
  if (settings.enableMultiline && /;;\s*$/.test(content)) {
    const promptText = content.replace(/;;\s*$/, "").trim();
    const children = collectChildren(lines, lineNo, indentWidth(line), settings.deckTagPrefix);
    const back = children.map((c) => c.text).join("\n").trim();
    if (promptText && back) {
      out.push({
        id: cardId(file, "multiline", `${promptText};;${back}`, ""),
        file,
        deck,
        type: "multiline",
        front: promptText,
        back,
        raw: normalizeRaw(promptText, back),
        startLine: lineNo,
        endLine: children.length ? children[children.length - 1].line : lineNo,
      });
    }
    return out;
  }

  // --- Cloze: `{...}` groups ---
  if (settings.enableCloze && content.includes("{")) {
    const { cleanText, spans } = parseCloze(content, ranges, markerLen);
    if (spans.length) {
      for (const { variant, spans: cardSpans } of clozeCards(spans)) {
        const back = cardSpans.map(([s, e]) => cleanText.slice(s, e)).join(", ");
        out.push({
          id: cardId(file, "cloze", cleanText, variant),
          file,
          deck,
          type: "cloze",
          front: cleanText,
          back,
          raw: normalizeRaw(cleanText, back),
          lineText: cleanText,
          clozeSpans: cardSpans,
          startLine: lineNo,
          endLine: lineNo,
        });
      }
      return out;
    }
  }

  // --- Directional / basic: pick the leftmost matching delimiter ---
  const candidates: Array<{ type: CardType; delim: string; idx: number; enabled: boolean }> = [
    { type: "forward", delim: ">>", idx: -1, enabled: settings.enableForward },
    { type: "backward", delim: "<<", idx: -1, enabled: settings.enableBackward },
    { type: "bidirectional", delim: "<>", idx: -1, enabled: settings.enableBidirectional },
    { type: "basic", delim: "::", idx: -1, enabled: settings.enableBasic },
  ];
  for (const c of candidates) {
    if (c.enabled) c.idx = findDelimiter(content, c.delim, ranges, markerLen);
  }
  const matched = candidates
    .filter((c) => c.enabled && c.idx >= 0)
    .sort((a, b) => a.idx - b.idx)[0];
  if (!matched) return out;

  const left = content.slice(0, matched.idx).trim();
  const right = content.slice(matched.idx + matched.delim.length).trim();
  if (!left || !right) return out;
  const hashRaw = `${left}${matched.delim}${right}`;

  if (matched.type === "bidirectional") {
    out.push({
      id: cardId(file, "bidirectional", hashRaw, "fwd"),
      file,
      deck,
      type: "bidirectional",
      front: left,
      back: right,
      raw: normalizeRaw(left, right),
      startLine: lineNo,
      endLine: lineNo,
    });
    out.push({
      id: cardId(file, "bidirectional", hashRaw, "rev"),
      file,
      deck,
      type: "bidirectional",
      front: right,
      back: left,
      raw: normalizeRaw(right, left),
      startLine: lineNo,
      endLine: lineNo,
    });
  } else {
    // Backward cards prompt from the right-hand side.
    const front = matched.type === "backward" ? right : left;
    const back = matched.type === "backward" ? left : right;
    out.push({
      id: cardId(file, matched.type, hashRaw, ""),
      file,
      deck,
      type: matched.type,
      front,
      back,
      raw: normalizeRaw(front, back),
      startLine: lineNo,
      endLine: lineNo,
    });
  }
  return out;
}

/** True for every line that sits inside a fenced code block or `$$` math block. */
function computeBlockedLines(lines: string[]): boolean[] {
  const blocked = new Array<boolean>(lines.length).fill(false);
  let fence = false;
  let fenceMarker = "";
  let math = false;
  for (let i = 0; i < lines.length; i++) {
    const fm = lines[i].match(/^\s*(```+|~~~+)/);
    if (fm) {
      blocked[i] = true;
      if (!fence) {
        fence = true;
        fenceMarker = fm[1][0];
      } else if (fm[1][0] === fenceMarker) {
        fence = false;
      }
      continue;
    }
    if (fence) {
      blocked[i] = true;
      continue;
    }
    const dd = (lines[i].match(/\$\$/g) ?? []).length;
    if (math) {
      blocked[i] = true;
      if (dd % 2 === 1) math = false;
      continue;
    }
    if (dd % 2 === 1) {
      blocked[i] = true;
      math = true;
    }
  }
  return blocked;
}

/**
 * Scan note text and derive every flashcard. Cards only exist inside a `:::`
 * block: a line ending with `:::` opens the block, and only its direct child
 * lines that contain a card delimiter become cards. Pure — never mutates the file.
 */
export function scanCards(text: string, file: string, settings: Settings): Card[] {
  const lines = text.split("\n");
  const blocked = computeBlockedLines(lines);
  const cards: Card[] = [];

  // Pre-pass: the first `#deck/...` tag anywhere becomes the note-level deck.
  let noteDeck: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (blocked[i]) continue;
    const d = extractDeck(lines[i], settings.deckTagPrefix).deck;
    if (d) {
      noteDeck = d;
      break;
    }
  }

  for (let ln = 0; ln < lines.length; ln++) {
    if (blocked[ln]) continue;
    const line = lines[ln];
    const markerLen = (line.match(MARKER_RE)?.[1] ?? "").length;
    const rawContent = line.slice(markerLen);
    if (!rawContent.trim()) continue;

    const header = extractDeck(rawContent, settings.deckTagPrefix);
    if (!HEADER_RE.test(header.stripped)) continue;

    // A `:::` block: scan only its direct children for delimiter cards.
    const headerIndent = indentWidth(line);
    const blockDeck = header.deck ?? noteDeck ?? DEFAULT_DECK;
    let childIndent = -1;
    let blockEnd = ln;
    for (let j = ln + 1; j < lines.length; j++) {
      const child = lines[j];
      if (!child.trim()) {
        blockEnd = j;
        continue;
      }
      const ci = indentWidth(child);
      if (ci <= headerIndent) break;
      blockEnd = j;
      if (childIndent < 0) childIndent = ci;
      if (blocked[j] || ci > childIndent) continue; // grandchildren are ignored
      cards.push(...parseLine(lines, j, blockDeck, file, settings));
    }
    ln = blockEnd; // skip past the block so nested `:::` are not re-scanned
  }

  return cards;
}
