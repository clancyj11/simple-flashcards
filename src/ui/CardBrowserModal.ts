import { App, Modal, TFile } from "obsidian";
import { Store } from "../store";
import { CardRow, collectCards, CardStatus } from "../queue";

const STATUS_RANK: Record<CardStatus, number> = {
  due: 0,
  new: 1,
  scheduled: 2,
  suspended: 3,
};

const STATUS_CLASS: Record<CardStatus, string> = {
  due: "sf-rate-good",
  new: "sf-rate-easy",
  scheduled: "sf-progress",
  suspended: "sf-rate-again",
};

function statusLabel(row: CardRow): string {
  if (row.status === "scheduled" && row.schedule) {
    return new Date(row.schedule.due).toLocaleDateString();
  }
  return row.status;
}

/** Searchable modal listing every flashcard in the vault. */
export class CardBrowserModal extends Modal {
  private store: Store;
  private rows: CardRow[] = [];
  private filter = "";

  constructor(app: App, store: Store) {
    super(app);
    this.store = store;
    this.modalEl.addClass("sf-browser-modal");
  }

  async onOpen(): Promise<void> {
    const { contentEl, titleEl } = this;
    titleEl.setText("All flashcards");
    contentEl.empty();
    contentEl.createDiv({ cls: "sf-empty", text: "Scanning vault…" });

    try {
      this.rows = await collectCards(this.app.vault, this.store);
    } catch (e) {
      contentEl.empty();
      contentEl.createDiv({ cls: "sf-empty", text: "Failed to scan vault." });
      console.error("Simple Flashcards: card scan failed", e);
      return;
    }
    this.rows.sort(
      (a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
        (a.schedule?.due ?? 0) - (b.schedule?.due ?? 0),
    );

    contentEl.empty();
    titleEl.setText(`All flashcards (${this.rows.length})`);

    const search = contentEl.createEl("input", {
      type: "text",
      placeholder: "Search front, back, or deck…",
      cls: "sf-browser-search",
    });
    const list = contentEl.createDiv({ cls: "sf-browser-list" });
    search.addEventListener("input", () => {
      this.filter = search.value.toLowerCase();
      this.renderList(list);
    });
    this.renderList(list);
  }

  private renderList(list: HTMLElement): void {
    list.empty();
    const matches = this.rows.filter((r) => {
      if (!this.filter) return true;
      return (
        r.card.front.toLowerCase().includes(this.filter) ||
        r.card.back.toLowerCase().includes(this.filter) ||
        r.card.deck.toLowerCase().includes(this.filter)
      );
    });

    if (!matches.length) {
      list.createDiv({ cls: "sf-empty", text: "No cards match." });
      return;
    }

    for (const row of matches) {
      const el = list.createDiv({ cls: "sf-browser-row" });
      const main = el.createDiv({ cls: "sf-browser-main" });
      main.createSpan({ cls: "sf-browser-front", text: row.card.front });
      const meta = el.createDiv({ cls: "sf-browser-meta" });
      meta.createSpan({ cls: "sf-progress", text: row.card.deck });
      meta.createSpan({ cls: "sf-progress", text: row.card.type });
      meta.createSpan({ cls: STATUS_CLASS[row.status], text: statusLabel(row) });
      el.addEventListener("click", () => this.openCard(row));
    }
  }

  private openCard(row: CardRow): void {
    const file = this.app.vault.getAbstractFileByPath(row.card.file);
    if (!(file instanceof TFile)) return;
    this.close();
    void this.app.workspace.getLeaf(false).openFile(file, {
      eState: { line: row.card.startLine },
    });
  }
}
