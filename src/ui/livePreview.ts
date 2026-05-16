import { Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Settings } from "../types";
import { scanCards } from "../parser";

const DELIM_MARK = Decoration.mark({ class: "sf-lp-delim" });
const HEADER_RE = /:::\s*$/;
const INLINE_DELIM = /(?<=\s)(>>|<<|<>|::)(?=\s)/g;
const END_DELIM = /(;;)\s*$/;

/**
 * Always-on (setting-gated) styling of card syntax in the editor: the `:::`
 * block marker and delimiter tokens on actual card lines get an accent.
 * Cosmetic only — separate from the inline-review extension.
 */
export function livePreviewExtension(getSettings: () => Settings): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = this.build(u.view);
        }
      }

      private build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const settings = getSettings();
        if (!settings.livePreviewStyling) return builder.finish();

        // Only style delimiters that the parser actually treats as cards.
        const cardLines = new Set(
          scanCards(view.state.doc.toString(), "__lp__", settings).map((c) => c.startLine),
        );

        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            const line = view.state.doc.lineAt(pos);
            const marks: Array<[number, number]> = [];

            if (HEADER_RE.test(line.text)) {
              const idx = line.text.length - line.text.replace(/:::\s*$/, "").length;
              const start = line.from + line.text.length - idx;
              marks.push([start, start + 3]);
            } else if (cardLines.has(line.number - 1)) {
              let m: RegExpExecArray | null;
              INLINE_DELIM.lastIndex = 0;
              while ((m = INLINE_DELIM.exec(line.text))) {
                marks.push([line.from + m.index, line.from + m.index + m[1].length]);
              }
              const end = line.text.match(END_DELIM);
              if (end) {
                const start = line.from + (end.index ?? 0);
                marks.push([start, start + 2]);
              }
            }

            marks.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            for (const [s, e] of marks) builder.add(s, e, DELIM_MARK);

            pos = line.to + 1;
          }
        }
        return builder.finish();
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}
