export type CardType =
  | "basic"
  | "forward"
  | "backward"
  | "bidirectional"
  | "cloze"
  | "multiline";

/** A card derived from note text. Transient — rebuilt on every scan. */
export interface Card {
  /** Stable id: hash of file path + raw card text + variant discriminator. */
  id: string;
  file: string;
  type: CardType;
  /** Deck path, e.g. "Spanish/Verbs". "Default" when no deck tag applies. */
  deck: string;
  /** Text shown as the prompt. */
  front: string;
  /** Text shown as the answer. */
  back: string;
  /** Normalized `front | back` text, used to fuzzy-match edited cards. */
  raw: string;
  /**
   * For cloze cards: the full clean line text, and every [start, end) span
   * (within `lineText`) this card hides. Grouped clozes hide multiple spans.
   */
  lineText?: string;
  clozeSpans?: Array<[number, number]>;
  /** 0-based inclusive line range in the source file. */
  startLine: number;
  endLine: number;
}

/** Persisted SM-2 scheduling state for one card id. */
export interface CardSchedule {
  /** Epoch ms when the card next becomes due. */
  due: number;
  /** Current interval in days. */
  interval: number;
  /** SM-2 ease factor. */
  ease: number;
  /** Successful reviews in a row. */
  reps: number;
  /** Times the card was failed (rated Again). */
  lapses: number;
  /** Epoch ms of the last review, or null if never reviewed. */
  lastReviewed: number | null;
  suspended: boolean;
  /** Source file path — used to scope schedule reconciliation. */
  file: string;
  /** The card's `raw` text when this schedule was last written. */
  text: string;
}

export type Rating = "again" | "hard" | "good" | "easy";

export interface Settings {
  spacedRepetitionEnabled: boolean;
  startingEase: number;
  /** Multiplier applied to the interval on an "easy" rating. */
  easyBonus: number;
  /** Multiplier applied to the interval on a "hard" rating. */
  hardFactor: number;
  /** Max brand-new cards introduced per review session. */
  newCardsPerSession: number;
  /** Tag prefix that marks a deck, e.g. "deck" matches `#deck/Spanish`. */
  deckTagPrefix: string;
  /** Style card delimiters and deck tags in live preview. */
  livePreviewStyling: boolean;
  enableBasic: boolean;
  enableForward: boolean;
  enableBackward: boolean;
  enableBidirectional: boolean;
  enableCloze: boolean;
  enableMultiline: boolean;
}

export interface PluginData {
  version: number;
  settings: Settings;
  cards: Record<string, CardSchedule>;
}

export const DEFAULT_SETTINGS: Settings = {
  spacedRepetitionEnabled: true,
  startingEase: 2.5,
  easyBonus: 1.3,
  hardFactor: 1.2,
  newCardsPerSession: 20,
  deckTagPrefix: "deck",
  livePreviewStyling: true,
  enableBasic: true,
  enableForward: true,
  enableBackward: true,
  enableBidirectional: true,
  enableCloze: true,
  enableMultiline: true,
};

export const DATA_VERSION = 1;

/** Deck assigned to cards with no matching `#deck/...` tag. */
export const DEFAULT_DECK = "Default";
