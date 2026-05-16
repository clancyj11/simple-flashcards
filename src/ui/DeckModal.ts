import { App, Modal } from "obsidian";
import { Store } from "../store";
import { collectDecks, DeckSummary } from "../queue";

/** Lists every deck with its due/new/total counts; pick one to review. */
export class DeckModal extends Modal {
  private store: Store;
  private onSelect: (deck: string) => void;

  constructor(app: App, store: Store, onSelect: (deck: string) => void) {
    super(app);
    this.store = store;
    this.onSelect = onSelect;
    this.modalEl.addClass("sf-deck-modal");
  }

  async onOpen(): Promise<void> {
    const { contentEl, titleEl } = this;
    titleEl.setText("Review a deck");
    contentEl.empty();
    contentEl.createDiv({ cls: "sf-empty", text: "Scanning vault…" });

    let decks: DeckSummary[];
    try {
      decks = await collectDecks(this.app.vault, this.store);
    } catch (e) {
      contentEl.empty();
      contentEl.createDiv({ cls: "sf-empty", text: "Failed to scan vault." });
      console.error("Simple Flashcards: deck scan failed", e);
      return;
    }

    contentEl.empty();
    if (!decks.length) {
      contentEl.createDiv({ cls: "sf-empty", text: "No flashcards found in the vault." });
      return;
    }

    for (const d of decks) {
      const row = contentEl.createDiv({ cls: "sf-deck-row" });
      row.createSpan({ cls: "sf-deck-name", text: d.deck });
      const counts = row.createSpan({ cls: "sf-deck-counts" });
      counts.createSpan({ cls: "sf-rate-good", text: `${d.due} due` });
      counts.createSpan({ cls: "sf-rate-easy", text: `${d.fresh} new` });
      counts.createSpan({ cls: "sf-progress", text: `${d.total} total` });
      row.addEventListener("click", () => {
        this.close();
        this.onSelect(d.deck);
      });
    }
  }
}
