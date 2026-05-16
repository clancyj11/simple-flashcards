import { App, Modal } from "obsidian";
import { Card, Rating } from "../types";
import { Store } from "../store";
import { applyRating } from "../scheduler";

const RATINGS: Array<{ rating: Rating; label: string; cls: string }> = [
  { rating: "again", label: "Again", cls: "sf-rate-again" },
  { rating: "hard", label: "Hard", cls: "sf-rate-hard" },
  { rating: "good", label: "Good", cls: "sf-rate-good" },
  { rating: "easy", label: "Easy", cls: "sf-rate-easy" },
];

/** Render a cloze line into `el`, with each target span blanked or revealed. */
function renderCloze(
  el: HTMLElement,
  lineText: string,
  spans: Array<[number, number]>,
  reveal: boolean,
) {
  el.empty();
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (start > cursor) el.appendText(lineText.slice(cursor, start));
    const target = el.createSpan({ text: lineText.slice(start, end) });
    target.addClass(reveal ? "sf-cloze-filled" : "sf-cloze-blank");
    cursor = end;
  }
  if (cursor < lineText.length) el.appendText(lineText.slice(cursor));
}

export class ReviewModal extends Modal {
  private store: Store;
  private queue: Card[];
  private index = 0;
  private closeCallback?: () => void;

  constructor(app: App, store: Store, queue: Card[], closeCallback?: () => void) {
    super(app);
    this.store = store;
    this.queue = [...queue];
    this.closeCallback = closeCallback;
    this.modalEl.addClass("sf-review-modal");
  }

  onOpen(): void {
    this.renderCard();
  }

  onClose(): void {
    this.closeCallback?.();
  }

  private renderCard(): void {
    const { contentEl } = this;
    contentEl.empty();

    if (this.index >= this.queue.length) {
      contentEl.createDiv({ cls: "sf-empty", text: "All done — no cards left to review." });
      const close = contentEl.createEl("button", { text: "Close" });
      close.addEventListener("click", () => this.close());
      return;
    }

    const card = this.queue[this.index];
    const srEnabled = this.store.settings.spacedRepetitionEnabled;

    contentEl.createDiv({
      cls: "sf-progress",
      text: `Card ${this.index + 1} of ${this.queue.length} · ${card.deck}`,
    });

    const face = contentEl.createDiv({ cls: "sf-card-face" });
    const promptEl = face.createDiv({ cls: "sf-card-prompt" });

    if (card.type === "cloze" && card.lineText && card.clozeSpans) {
      renderCloze(promptEl, card.lineText, card.clozeSpans, false);
    } else {
      promptEl.setText(card.front);
    }

    let revealed = false;
    const revealBtn = contentEl.createEl("button", { text: "Show answer", cls: "mod-cta" });
    const buttonRow = contentEl.createDiv({ cls: "sf-button-row" });

    const suspendBtn = contentEl.createEl("button", { text: "Suspend card", cls: "sf-suspend" });
    suspendBtn.addEventListener("click", () => this.suspend(card));

    const showAnswer = () => {
      if (revealed) return;
      revealed = true;
      revealBtn.remove();

      if (card.type === "cloze" && card.lineText && card.clozeSpans) {
        renderCloze(promptEl, card.lineText, card.clozeSpans, true);
      } else {
        face.createDiv({ cls: "sf-card-answer" }).setText(card.back);
      }

      if (srEnabled) {
        for (const { rating, label, cls } of RATINGS) {
          const btn = buttonRow.createEl("button", { text: label, cls });
          btn.addEventListener("click", () => this.rate(card, rating));
        }
      } else {
        const next = buttonRow.createEl("button", { text: "Next", cls: "mod-cta" });
        next.addEventListener("click", () => this.advance());
      }
    };

    revealBtn.addEventListener("click", showAnswer);

    // Spacebar reveals; 1-4 rate.
    this.scope.register([], " ", (evt) => {
      evt.preventDefault();
      showAnswer();
      return false;
    });
    if (srEnabled) {
      RATINGS.forEach(({ rating }, i) => {
        this.scope.register([], String(i + 1), (evt) => {
          if (!revealed) return false;
          evt.preventDefault();
          this.rate(card, rating);
          return false;
        });
      });
    }
  }

  private async rate(card: Card, rating: Rating): Promise<void> {
    const current = this.store.ensureSchedule(card);
    const next = applyRating(current, rating, this.store.settings);
    this.store.setSchedule(card.id, next);
    await this.store.save();

    // "Again" cards come back later in the same session.
    if (rating === "again") this.queue.push(card);
    this.advance();
  }

  private async suspend(card: Card): Promise<void> {
    const sched = this.store.ensureSchedule(card);
    sched.suspended = true;
    await this.store.save();
    this.advance();
  }

  private advance(): void {
    this.index += 1;
    this.renderCard();
  }
}
