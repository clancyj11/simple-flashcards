import { Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { Card, Rating, Settings } from "../types";
import { scanCards } from "../parser";

/** Bridge the CM6 extension to the plugin (settings + rating persistence). */
export interface InlineController {
  getSettings(): Settings;
  rate(cards: Card[], rating: Rating): Promise<void>;
}

/** Toggle inline-review mode for a specific editor. */
export const toggleInlineEffect = StateEffect.define<boolean>();

/** Per-editor on/off state for inline review. */
const inlineActiveField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(toggleInlineEffect)) value = e.value;
    }
    return value;
  },
});

export function isInlineActive(view: EditorView): boolean {
  return view.state.field(inlineActiveField, false) ?? false;
}

const RATINGS: Array<{ rating: Rating; label: string; cls: string }> = [
  { rating: "again", label: "Again", cls: "sf-rate-again" },
  { rating: "hard", label: "Hard", cls: "sf-rate-hard" },
  { rating: "good", label: "Good", cls: "sf-rate-good" },
  { rating: "easy", label: "Easy", cls: "sf-rate-easy" },
];

interface LineRegion {
  /** Doc line numbers (1-based) covered by this card group. */
  startLine: number;
  endLine: number;
  cards: Card[];
  /** Blur spans, as absolute doc offsets. */
  blur: Array<[number, number]>;
  done: boolean;
}

/** Locate the answer/cloze spans to blur on a given raw line. */
function blurSpansForLine(rawLine: string, lineStart: number): Array<[number, number]> {
  const spans: Array<[number, number]> = [];

  // Cloze: every `{...}` group. `{n|text}` blurs only the text portion.
  let i = 0;
  let foundCloze = false;
  while (i < rawLine.length) {
    if (rawLine[i] === "{") {
      const close = rawLine.indexOf("}", i + 1);
      if (close > i + 1) {
        const prefix = rawLine.slice(i + 1, close).match(/^\d+\|/);
        const innerStart = i + 1 + (prefix ? prefix[0].length : 0);
        spans.push([lineStart + innerStart, lineStart + close]);
        foundCloze = true;
        i = close + 1;
        continue;
      }
    }
    i++;
  }
  if (foundCloze) return spans;

  // Directional / basic: hide the answer side. `<<` prompts from the right,
  // so its answer is the left side; the others hide everything after the delimiter.
  for (const delim of [">>", "<<", "<>", "::"]) {
    const idx = rawLine.indexOf(delim);
    if (idx > 0 && rawLine.slice(idx + delim.length).trim()) {
      if (delim === "<<") {
        spans.push([lineStart, lineStart + idx]);
      } else {
        spans.push([lineStart + idx + delim.length, lineStart + rawLine.length]);
      }
      return spans;
    }
  }
  return spans;
}

class ControlWidget extends WidgetType {
  constructor(
    private region: LineRegion,
    private revealed: boolean,
    private onReveal: () => void,
    private onRate: (r: Rating) => void,
  ) {
    super();
  }

  eq(other: ControlWidget): boolean {
    return (
      other.region.cards.map((c) => c.id).join() ===
        this.region.cards.map((c) => c.id).join() &&
      other.revealed === this.revealed &&
      other.region.done === this.region.done
    );
  }

  toDOM(): HTMLElement {
    const bar = document.createElement("span");
    bar.className = "sf-inline-bar";
    if (this.region.done) {
      bar.createEl("span", { text: "✓ reviewed", cls: "sf-progress" });
      return bar;
    }
    if (!this.revealed) {
      const btn = bar.createEl("button", { text: "Reveal" });
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.onReveal();
      });
    } else {
      for (const { rating, label, cls } of RATINGS) {
        const btn = bar.createEl("button", { text: label, cls });
        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          this.onRate(rating);
        });
      }
    }
    return bar;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export function inlineReviewExtension(controller: InlineController): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      /** Card-group key (startLine) -> revealed. */
      private revealed = new Set<number>();
      private done = new Set<number>();

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(u: ViewUpdate): void {
        const toggled = u.transactions.some((t) =>
          t.effects.some((e) => e.is(toggleInlineEffect)),
        );
        if (u.docChanged) {
          this.revealed.clear();
          this.done.clear();
        }
        if (u.docChanged || u.viewportChanged || toggled) {
          this.decorations = this.build(u.view);
        }
      }

      private build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        if (!isInlineActive(view)) return builder.finish();

        const text = view.state.doc.toString();
        const cards = scanCards(text, "__inline__", controller.getSettings());

        // Group cards by their start line.
        const groups = new Map<number, LineRegion>();
        for (const card of cards) {
          let g = groups.get(card.startLine);
          if (!g) {
            g = {
              startLine: card.startLine,
              endLine: card.endLine,
              cards: [],
              blur: [],
              done: false,
            };
            groups.set(card.startLine, g);
          }
          g.cards.push(card);
          g.endLine = Math.max(g.endLine, card.endLine);
        }

        const sorted = [...groups.values()].sort((a, b) => a.startLine - b.startLine);

        for (const region of sorted) {
          const key = region.startLine;
          region.done = this.done.has(key);
          const isRevealed = this.revealed.has(key) || region.done;

          // Collect blur spans across every line in the group.
          for (let ln = region.startLine; ln <= region.endLine; ln++) {
            const docLine = view.state.doc.line(ln + 1); // parser is 0-based
            const raw = docLine.text;
            if (ln === region.startLine) {
              region.blur.push(...blurSpansForLine(raw, docLine.from));
            } else if (raw.trim()) {
              // multiline answer line: blur the whole line
              region.blur.push([docLine.from, docLine.to]);
            }
          }

          if (!isRevealed) {
            for (const [from, to] of region.blur) {
              if (to > from) {
                builder.add(from, to, Decoration.mark({ class: "sf-inline-hidden" }));
              }
            }
          }

          const endLine = view.state.doc.line(region.endLine + 1);
          builder.add(
            endLine.to,
            endLine.to,
            Decoration.widget({
              side: 1,
              widget: new ControlWidget(
                region,
                isRevealed,
                () => {
                  this.revealed.add(key);
                  this.decorations = this.build(view);
                  view.dispatch({});
                },
                (rating) => {
                  void controller.rate(region.cards, rating);
                  this.done.add(key);
                  this.decorations = this.build(view);
                  view.dispatch({});
                },
              ),
            }),
          );
        }

        return builder.finish();
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );

  return [inlineActiveField, plugin];
}
