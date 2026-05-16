import { Editor, MarkdownFileInfo, MarkdownView, Menu, Notice, Plugin } from "obsidian";
import { EditorView } from "@codemirror/view";
import { Store } from "./store";
import { buildQueue } from "./queue";
import { applyRating } from "./scheduler";
import { scanCards } from "./parser";
import { Card, Rating } from "./types";
import { ReviewModal } from "./ui/ReviewModal";
import { DeckModal } from "./ui/DeckModal";
import { CardBrowserModal } from "./ui/CardBrowserModal";
import { SimpleFlashcardsSettingTab } from "./settings";
import { inlineReviewExtension, isInlineActive, toggleInlineEffect } from "./ui/inlineReview";
import { livePreviewExtension } from "./ui/livePreview";

export default class SimpleFlashcardsPlugin extends Plugin {
  store!: Store;

  async onload(): Promise<void> {
    this.store = new Store(this);
    await this.store.load();

    this.registerEditorExtension(
      inlineReviewExtension({
        getSettings: () => this.store.settings,
        rate: async (cards: Card[], rating: Rating) => {
          for (const card of cards) {
            const next = applyRating(this.store.ensureSchedule(card), rating, this.store.settings);
            this.store.setSchedule(card.id, next);
          }
          await this.store.save();
        },
      }),
    );
    this.registerEditorExtension(livePreviewExtension(() => this.store.settings));

    this.addSettingTab(new SimpleFlashcardsSettingTab(this.app, this));

    this.addRibbonIcon("layers", "Review flashcards", () => this.reviewVault());

    this.addCommand({
      id: "review-due-cards",
      name: "Review due cards (whole vault)",
      callback: () => this.reviewVault(),
    });

    this.addCommand({
      id: "review-current-note",
      name: "Review current note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.reviewFile();
        return true;
      },
    });

    this.addCommand({
      id: "review-deck",
      name: "Review a deck…",
      callback: () => {
        new DeckModal(this.app, this.store, (deck) => void this.reviewDeck(deck)).open();
      },
    });

    this.addCommand({
      id: "browse-cards",
      name: "Browse all flashcards",
      callback: () => new CardBrowserModal(this.app, this.store).open(),
    });

    this.addCommand({
      id: "toggle-inline-review",
      name: "Toggle inline review for current note",
      checkCallback: (checking) => {
        const cm = this.activeEditorView();
        if (!cm) return false;
        if (!checking) {
          cm.dispatch({ effects: toggleInlineEffect.of(!isInlineActive(cm)) });
        }
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, info) =>
        this.addCardMenuItems(menu, editor, info),
      ),
    );
  }

  private addCardMenuItems(menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo): void {
    const file = info.file;
    if (!file) return;
    const line = editor.getCursor().line;
    const cards = scanCards(editor.getValue(), file.path, this.store.settings).filter(
      (c) => line >= c.startLine && line <= c.endLine,
    );
    if (!cards.length) return;

    const label = cards.length === 1 ? "card" : `${cards.length} cards`;

    menu.addItem((item) =>
      item
        .setTitle(`Flashcards: review this ${label}`)
        .setIcon("layers")
        .onClick(() => new ReviewModal(this.app, this.store, cards).open()),
    );

    menu.addItem((item) =>
      item
        .setTitle(`Flashcards: reset schedule`)
        .setIcon("rotate-ccw")
        .onClick(async () => {
          for (const c of cards) this.store.removeSchedule(c.id);
          await this.store.save();
          new Notice(`Reset ${label}.`);
        }),
    );

    const allSuspended = cards.every((c) => this.store.getSchedule(c.id)?.suspended);
    menu.addItem((item) =>
      item
        .setTitle(`Flashcards: ${allSuspended ? "unsuspend" : "suspend"} this ${label}`)
        .setIcon(allSuspended ? "play" : "pause")
        .onClick(async () => {
          for (const c of cards) this.store.ensureSchedule(c).suspended = !allSuspended;
          await this.store.save();
        }),
    );
  }

  private activeEditorView(): EditorView | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return null;
    // Obsidian exposes the underlying CodeMirror 6 instance as `editor.cm`.
    const cm = (view.editor as unknown as { cm?: EditorView }).cm;
    return cm ?? null;
  }

  private async reviewVault(): Promise<void> {
    const queue = await buildQueue(this.app.vault, this.store, { kind: "vault" });
    await this.store.save();
    this.openReview(queue);
  }

  private async reviewDeck(deck: string): Promise<void> {
    const queue = await buildQueue(this.app.vault, this.store, { kind: "deck", deck });
    await this.store.save();
    this.openReview(queue);
  }

  private async reviewFile(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    const queue = await buildQueue(this.app.vault, this.store, { kind: "file", file });
    this.openReview(queue);
  }

  private openReview(queue: Card[]): void {
    if (!queue.length) {
      new Notice("No flashcards due.");
      return;
    }
    new ReviewModal(this.app, this.store, queue).open();
  }
}
