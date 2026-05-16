import { Card, CardSchedule, DATA_VERSION, DEFAULT_SETTINGS, PluginData, Settings } from "./types";
import { newSchedule } from "./scheduler";

/** Obsidian's Plugin exposes these; typed here to avoid a hard import. */
export interface DataIO {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

const RECONCILE_THRESHOLD = 0.6;

/** Sørensen–Dice similarity over character bigrams. Returns 0..1. */
export function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    bigrams.set(g, (bigrams.get(g) ?? 0) + 1);
  }
  let intersect = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const count = bigrams.get(g) ?? 0;
    if (count > 0) {
      bigrams.set(g, count - 1);
      intersect++;
    }
  }
  return (2 * intersect) / (a.length + b.length - 2);
}

/**
 * Owns the single `data.json`: plugin settings plus per-card schedules.
 * Card *content* is never stored here — only scheduling state, keyed by card id.
 */
export class Store {
  private io: DataIO;
  data: PluginData;

  constructor(io: DataIO) {
    this.io = io;
    this.data = { version: DATA_VERSION, settings: { ...DEFAULT_SETTINGS }, cards: {} };
  }

  async load(): Promise<void> {
    const raw = (await this.io.loadData()) as Partial<PluginData> | null;
    this.data = {
      version: DATA_VERSION,
      settings: { ...DEFAULT_SETTINGS, ...(raw?.settings ?? {}) },
      cards: raw?.cards ?? {},
    };
  }

  async save(): Promise<void> {
    await this.io.saveData(this.data);
  }

  get settings(): Settings {
    return this.data.settings;
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    this.data.settings = { ...this.data.settings, ...patch };
    await this.save();
  }

  getSchedule(id: string): CardSchedule | undefined {
    return this.data.cards[id];
  }

  /** Return the stored schedule, creating a fresh one if the card is new. */
  ensureSchedule(card: Card): CardSchedule {
    let s = this.data.cards[card.id];
    if (!s) {
      s = newSchedule(this.data.settings, card);
      this.data.cards[card.id] = s;
    } else {
      // Keep the reconciliation metadata current.
      s.file = card.file;
      s.text = card.raw;
    }
    return s;
  }

  setSchedule(id: string, schedule: CardSchedule): void {
    this.data.cards[id] = schedule;
  }

  removeSchedule(id: string): void {
    delete this.data.cards[id];
  }

  /**
   * Sync stored schedules against a full vault scan.
   *
   * A card whose text was edited gets a new id, orphaning its schedule. For
   * each such new card we look for an orphaned schedule **in the same file**
   * with similar text and migrate its progress. Orphans with no match are
   * pruned. `allCards` must be the complete set from a full vault scan.
   */
  reconcile(allCards: Card[]): void {
    const liveById = new Map(allCards.map((c) => [c.id, c]));

    const orphans: Array<{ id: string; sched: CardSchedule }> = [];
    for (const [id, sched] of Object.entries(this.data.cards)) {
      if (!liveById.has(id)) orphans.push({ id, sched });
    }

    const newCards = allCards.filter((c) => !this.data.cards[c.id]);
    const claimed = new Set<string>();

    for (const card of newCards) {
      let best: { id: string; sched: CardSchedule } | null = null;
      let bestScore = RECONCILE_THRESHOLD;
      for (const orphan of orphans) {
        if (claimed.has(orphan.id)) continue;
        if (orphan.sched.file !== card.file || !orphan.sched.text) continue;
        const score = diceSimilarity(orphan.sched.text, card.raw);
        if (score > bestScore) {
          bestScore = score;
          best = orphan;
        }
      }
      if (best) {
        claimed.add(best.id);
        this.data.cards[card.id] = { ...best.sched, file: card.file, text: card.raw };
        delete this.data.cards[best.id];
      }
    }

    // Drop orphans that were not migrated.
    for (const orphan of orphans) {
      if (!claimed.has(orphan.id)) delete this.data.cards[orphan.id];
    }
  }
}
