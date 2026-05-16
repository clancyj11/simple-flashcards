# Simple Flashcards

RemNote-style flashcards for Obsidian. Write cards inline in your notes with
simple delimiters, then review them with optional spaced repetition.

## Install

Copy `main.js`, `manifest.json`, and `styles.css` into
`<your-vault>/.obsidian/plugins/simple-flashcards/`, then enable
**Simple Flashcards** under Settings → Community plugins.

## The `:::` block — where cards live

Cards are **only** read inside a block. A bullet ending with `:::` opens a
block; each of its **direct child bullets** becomes a card *if* it contains a
delimiter. Plain bullets, deeper-nested bullets, and anything outside a `:::`
block are ignored — so template files, LaTeX math, and ordinary prose are
never mistaken for cards.

```markdown
- French vocab :::
    - Capital of France :: Paris
    - el perro >> the dog
    - just a note to myself        <- no delimiter, ignored
```

## Card delimiters

| Syntax | Example | Result |
|--------|---------|--------|
| `::` basic | `Capital of France :: Paris` | front → back |
| `>>` forward | `Question >> Answer` | front → back |
| `<<` backward | `Answer << Question` | prompts from the right side |
| `<>` bidirectional | `uno <> one` | two cards, one each direction |
| `{}` cloze | `The sky is {blue}` | fill-in-the-blank |
| `;;` multiline | `Planets ;;` | answer is the bullet's own sub-bullets |

**Grouped clozes** — number them so several blanks hide together as one card:

```markdown
- Geography :::
    - {1|Paris} is the capital of {1|France}; {2|Berlin} is in Germany.
```

**Multiline answer** — the `;;` bullet's children are its answer:

```markdown
- Astronomy :::
    - Inner planets ;;
        - Mercury
        - Venus, Earth, Mars
```

## Decks

Tag a card with `#deck/Name` to file it into a deck (nesting allowed:
`#deck/Spanish/Verbs`). Put the tag on the `:::` header to deck the whole
block, on a single card line to deck just that card, or anywhere in the note as
a default. Cards with no tag go to the **Default** deck. The deck prefix
(`deck`) is configurable in settings.

## Reviewing

Open the command palette and run any of:

- **Review due cards (whole vault)** — review everything that's due. Also on
  the ribbon (layers icon).
- **Review a deck…** — pick a deck from a list showing due/new counts.
- **Review current note** — review only this note's cards.
- **Toggle inline review for current note** — review in place: answers blur,
  click *Reveal*, then rate without leaving the note.

In the review modal: **Show answer** (or `Space`), then rate **Again / Hard /
Good / Easy** (or keys `1`–`4`). *Suspend card* removes it from rotation.
If spaced repetition is turned off in settings, review is a plain flip-through.

## Browsing & editing

- **Browse all flashcards** — a searchable list of every card with its deck,
  type, and status; click a row to jump to that line in the note.
- **Right-click a card line** for: *review this card*, *reset schedule*,
  *suspend / unsuspend*.

## Spaced repetition

Scheduling uses the SM-2 algorithm. Intervals, ease, and due dates are stored
in the plugin's own `data.json` — your notes are never modified. If you edit a
card's text, the plugin fuzzy-matches it back to its original schedule so your
progress isn't lost.

## Settings

- **Spaced repetition** — enable/disable; tune starting ease, easy bonus, hard
  factor, and new-cards-per-session.
- **Decks** — change the deck tag prefix.
- **Appearance** — toggle live-preview styling of card delimiters.
- **Card syntax** — enable or disable each delimiter type individually.
