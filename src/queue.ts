import { TFile, Vault } from "obsidian";
import { Card, CardSchedule } from "./types";
import { scanCards } from "./parser";
import { Store } from "./store";
import { isDue, isNew } from "./scheduler";

export type QueueScope =
  | { kind: "vault" }
  | { kind: "file"; file: TFile }
  | { kind: "deck"; deck: string };

export interface DeckSummary {
  deck: string;
  total: number;
  due: number;
  fresh: number;
}

export type CardStatus = "new" | "due" | "scheduled" | "suspended";

export interface CardRow {
  card: Card;
  schedule: CardSchedule | undefined;
  status: CardStatus;
}

/** A deck includes its sub-decks (e.g. "Spanish" covers "Spanish/Verbs"). */
function inDeck(card: Card, deck: string): boolean {
  return card.deck === deck || card.deck.startsWith(deck + "/");
}

/** Scan every Markdown file in the vault and return all derived cards. */
async function scanVault(vault: Vault, store: Store): Promise<Card[]> {
  const all: Card[] = [];
  for (const file of vault.getMarkdownFiles()) {
    const text = await vault.cachedRead(file);
    all.push(...scanCards(text, file.path, store.settings));
  }
  return all;
}

function statusOf(card: Card, store: Store, now: number): CardStatus {
  const sched = store.getSchedule(card.id);
  if (!sched) return "new";
  if (sched.suspended) return "suspended";
  if (isNew(sched)) return "new";
  return isDue(sched, now) ? "due" : "scheduled";
}

/**
 * Scan the requested scope, join cards with their stored schedules, and return
 * the cards to study this session.
 *
 * With spaced repetition ON: due cards first, then up to `newCardsPerSession`
 * brand-new cards. With it OFF: every card, in document order (flip-through).
 */
export async function buildQueue(
  vault: Vault,
  store: Store,
  scope: QueueScope,
): Promise<Card[]> {
  let all: Card[];
  if (scope.kind === "file") {
    const text = await vault.cachedRead(scope.file);
    all = scanCards(text, scope.file.path, store.settings);
  } else {
    all = await scanVault(vault, store);
    store.reconcile(all);
  }

  if (scope.kind === "deck") {
    all = all.filter((c) => inDeck(c, scope.deck));
  }

  if (!store.settings.spacedRepetitionEnabled) {
    return all;
  }

  const now = Date.now();
  const due: Card[] = [];
  const fresh: Card[] = [];
  for (const card of all) {
    const sched = store.getSchedule(card.id);
    if (sched?.suspended) continue;
    if (!sched || isNew(sched)) {
      fresh.push(card);
    } else if (isDue(sched, now)) {
      due.push(card);
    }
  }

  due.sort((a, b) => store.getSchedule(a.id)!.due - store.getSchedule(b.id)!.due);
  return [...due, ...fresh.slice(0, store.settings.newCardsPerSession)];
}

/**
 * Summarise every deck in the vault: total, due, and new card counts.
 * Returned sorted by deck path.
 */
export async function collectDecks(vault: Vault, store: Store): Promise<DeckSummary[]> {
  const all = await scanVault(vault, store);
  store.reconcile(all);

  const now = Date.now();
  const byDeck = new Map<string, DeckSummary>();
  const get = (deck: string): DeckSummary => {
    let s = byDeck.get(deck);
    if (!s) {
      s = { deck, total: 0, due: 0, fresh: 0 };
      byDeck.set(deck, s);
    }
    return s;
  };

  for (const card of all) {
    const summary = get(card.deck);
    summary.total += 1;
    const status = statusOf(card, store, now);
    if (status === "new") summary.fresh += 1;
    else if (status === "due") summary.due += 1;
  }

  return [...byDeck.values()].sort((a, b) => a.deck.localeCompare(b.deck));
}

/** Every card in the vault joined with its schedule and status, for the browser. */
export async function collectCards(vault: Vault, store: Store): Promise<CardRow[]> {
  const all = await scanVault(vault, store);
  store.reconcile(all);
  const now = Date.now();
  return all.map((card) => ({
    card,
    schedule: store.getSchedule(card.id),
    status: statusOf(card, store, now),
  }));
}
