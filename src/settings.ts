import { App, PluginSettingTab, Setting } from "obsidian";
import type SimpleFlashcardsPlugin from "./main";

export class SimpleFlashcardsSettingTab extends PluginSettingTab {
  private plugin: SimpleFlashcardsPlugin;

  constructor(app: App, plugin: SimpleFlashcardsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const store = this.plugin.store;

    new Setting(containerEl).setName("Spaced repetition").setHeading();

    new Setting(containerEl)
      .setName("Enable spaced repetition")
      .setDesc("When off, reviews are a plain flip-through with no scheduling.")
      .addToggle((t) =>
        t.setValue(store.settings.spacedRepetitionEnabled).onChange(async (v) => {
          await store.updateSettings({ spacedRepetitionEnabled: v });
        }),
      );

    new Setting(containerEl)
      .setName("Starting ease")
      .setDesc("Initial SM-2 ease factor for new cards (default 2.5).")
      .addText((t) =>
        t.setValue(String(store.settings.startingEase)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 1.3) await store.updateSettings({ startingEase: n });
        }),
      );

    new Setting(containerEl)
      .setName("Easy bonus")
      .setDesc("Extra interval multiplier applied on an 'Easy' rating.")
      .addText((t) =>
        t.setValue(String(store.settings.easyBonus)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 1) await store.updateSettings({ easyBonus: n });
        }),
      );

    new Setting(containerEl)
      .setName("Hard factor")
      .setDesc("Interval multiplier applied on a 'Hard' rating.")
      .addText((t) =>
        t.setValue(String(store.settings.hardFactor)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 1) await store.updateSettings({ hardFactor: n });
        }),
      );

    new Setting(containerEl)
      .setName("New cards per session")
      .setDesc("Maximum brand-new cards introduced in one review session.")
      .addText((t) =>
        t.setValue(String(store.settings.newCardsPerSession)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n >= 0) await store.updateSettings({ newCardsPerSession: n });
        }),
      );

    new Setting(containerEl).setName("Decks").setHeading();

    new Setting(containerEl)
      .setName("Deck tag prefix")
      .setDesc(
        "Tag prefix that assigns a deck. With 'deck', a `#deck/Spanish` tag " +
          "(on a card's line, or anywhere in its note) puts cards in deck 'Spanish'.",
      )
      .addText((t) =>
        t.setValue(store.settings.deckTagPrefix).onChange(async (v) => {
          const clean = v.trim().replace(/^#/, "");
          if (clean) await store.updateSettings({ deckTagPrefix: clean });
        }),
      );

    new Setting(containerEl).setName("Appearance").setHeading();

    new Setting(containerEl)
      .setName("Style card syntax in live preview")
      .setDesc("Highlight card delimiters and render deck tags as pills while editing.")
      .addToggle((t) =>
        t.setValue(store.settings.livePreviewStyling).onChange(async (v) => {
          await store.updateSettings({ livePreviewStyling: v });
          this.app.workspace.updateOptions();
        }),
      );

    new Setting(containerEl)
      .setName("Card syntax")
      .setDesc(
        "Cards are only read inside a block: a bullet ending with ':::' opens " +
          "the block, and each of its direct child bullets becomes a card if it " +
          "contains one of the delimiters below. Text outside a ':::' block is " +
          "never scanned.",
      )
      .setHeading();

    const toggles: Array<[keyof typeof store.settings, string, string]> = [
      ["enableBasic", "Basic  ::", "Concept :: Descriptor"],
      ["enableForward", "Forward  >>", "Question >> Answer"],
      ["enableBackward", "Backward  <<", "Question << Answer (prompts from the answer side)"],
      ["enableBidirectional", "Bidirectional  <>", "Term A <> Term B (two cards)"],
      ["enableCloze", "Cloze  {}", "Text with a {hidden} span; {1|grouped} clozes hide together"],
      ["enableMultiline", "Multiline  ;;", "Prompt ;; with an indented answer below"],
    ];
    for (const [key, name, desc] of toggles) {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addToggle((t) =>
          t.setValue(store.settings[key] as boolean).onChange(async (v) => {
            await store.updateSettings({ [key]: v });
          }),
        );
    }
  }
}
