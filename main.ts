import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  MarkdownView,
  TAbstractFile,
  Editor,
  Notice,
  TFile,
} from "obsidian";

interface PluginSettings {
  delayAfterFileOpening: number;
}

const DEFAULT_SETTINGS: PluginSettings = {
  delayAfterFileOpening: 100,
};

interface EphemeralState {
  cursor?: {
    from: {
      ch: number;
      line: number;
    };
    to: {
      ch: number;
      line: number;
    };
  };
  scroll?: number;
}

export default class RememberCursorPosition extends Plugin {
  settings: PluginSettings;
  lastLoadedFileName: string;
  loadedLeafIdList: string[] = [];
  loadingFile = false;

  async onload() {
    await this.loadSettings();

    this.addSettingTab(new SettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => this.restoreEphemeralState())
    );

    // Command to save current position & selection
    this.addCommand({
      id: "save-current-position",
      name: "Save position & selection",
      callback: () => this.saveCurrentPosition(),
    });

    // Command to restore cursor position & selection
    this.addCommand({
      id: "restore-saved-position",
      name: "Restore position & selection",
      callback: () => this.restoreSavedPosition(),
    });

    this.restoreEphemeralState();
  }

  async restoreEphemeralState() {
    let fileName = this.app.workspace.getActiveFile()?.path;

    if (fileName && this.loadingFile && this.lastLoadedFileName == fileName)
		//if already started loading
		return;

    let activeLeaf = this.app.workspace.getMostRecentLeaf();
    if (
      activeLeaf &&
      this.loadedLeafIdList.includes(
        activeLeaf.id + ":" + activeLeaf.getViewState().state.file
      )
    )
      return;

    this.loadedLeafIdList = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.getViewState().type === "markdown") {
        this.loadedLeafIdList.push(
          leaf.id + ":" + leaf.getViewState().state.file
        );
      }
    });

    this.loadingFile = true;

    if (this.lastLoadedFileName != fileName) {
      this.lastLoadedFileName = fileName;

      if (fileName) {
        let st = await this.getStateFromFrontmatter(fileName);
        if (st) {
			//waiting for load note
			await this.delay(this.settings.delayAfterFileOpening);

          // Don't scroll when a link scrolls and highlights text
          // i.e. if file is open by links like [link](note.md#header) and wikilinks
          // See #10, #32, #46, #51
			let containsFlashingSpan =
            this.app.workspace.containerEl.querySelector("span.is-flashing");

          if (!containsFlashingSpan) {
            await this.delay(10);
            this.setEphemeralState(st);
          }
        }
      }
    }

    this.loadingFile = false;
  }

  isEphemeralStatesEquals(
    state1: EphemeralState,
    state2: EphemeralState
  ): boolean {
    if (state1.cursor && !state2.cursor) return false;

    if (!state1.cursor && state2.cursor) return false;

    if (state1.cursor) {
      if (state1.cursor.from.ch != state2.cursor.from.ch) return false;
      if (state1.cursor.from.line != state2.cursor.from.line) return false;
      if (state1.cursor.to.ch != state2.cursor.to.ch) return false;
      if (state1.cursor.to.line != state2.cursor.to.line) return false;
    }

    if (state1.scroll && !state2.scroll) return false;

    if (!state1.scroll && state2.scroll) return false;

    if (state1.scroll && state1.scroll != state2.scroll) return false;

    return true;
  }

  getEphemeralState(): EphemeralState {
    let state: EphemeralState = {};
    state.scroll = Number(
      this.app.workspace
        .getActiveViewOfType(MarkdownView)
        ?.currentMode?.getScroll()
        ?.toFixed(4)
    );

    let editor = this.getEditor();
    if (editor) {
      let from = editor.getCursor("anchor");
      let to = editor.getCursor("head");
      if (from && to) {
        state.cursor = {
          from: {
            ch: from.ch,
            line: from.line,
          },
          to: {
            ch: to.ch,
            line: to.line,
          },
        };
      }
    }

    return state;
  }

  setEphemeralState(state: EphemeralState) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (state.cursor) {
      let editor = this.getEditor();
      if (editor) {
        editor.setSelection(state.cursor.from, state.cursor.to);
      }
    }

    if (view && state.scroll) {
      view.setEphemeralState(state);
    }
  }

  private getEditor(): Editor {
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Method to manually trigger saving current position
  saveCurrentPosition() {
    const fileName = this.app.workspace.getActiveFile()?.path;
    if (fileName) {
      const st = this.getEphemeralState();
      // Update frontmatter
      this.updateFrontmatter(fileName, st);
      new Notice("Position & selection saved to frontmatter");
    }
  }

  // Method to manually trigger restoring saved position
  async restoreSavedPosition() {
    const fileName = this.app.workspace.getActiveFile()?.path;
    if (fileName) {
      const savedState = await this.getStateFromFrontmatter(fileName);
      if (savedState) {
        this.setEphemeralState(savedState);
        new Notice("Position & selection restored from frontmatter");
      } else {
        new Notice("No saved position & selection in frontmatter");
      }
    }
  }

  // Method to get state from frontmatter
  async getStateFromFrontmatter(
    fileName: string
  ): Promise<EphemeralState | undefined> {
    const file = this.app.vault.getAbstractFileByPath(fileName);
    if (file instanceof TFile) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (frontmatter && (frontmatter.cursor || frontmatter.scroll)) {
        const frontmatterLineCount = this.getFrontmatterLineCount(file);
        return {
          cursor: frontmatter.cursor ? {
            from: {
              ch: frontmatter.cursor.from.ch,
              line: frontmatter.cursor.from.line + frontmatterLineCount
            },
            to: {
              ch: frontmatter.cursor.to.ch,
              line: frontmatter.cursor.to.line + frontmatterLineCount
            }
          } : undefined,
          scroll: frontmatter.scroll
        } as EphemeralState;
      }
    }
    return undefined;
  }

  // Method to update frontmatter
  async updateFrontmatter(fileName: string, st: EphemeralState) {
    const file = this.app.vault.getAbstractFileByPath(fileName);
    if (file instanceof TFile) {
      // Get existing frontmatter
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      const frontmatterLineCount = this.getFrontmatterLineCount(file);

      if (st.cursor) {
        frontmatter.cursor = {
          from: {
            ch: Math.max(st.cursor.from.line - frontmatterLineCount, 0) === 0 ? 0 : st.cursor.from.ch,
            line: Math.max(st.cursor.from.line - frontmatterLineCount, 0)
          },
          to: {
            ch: Math.max(st.cursor.to.line - frontmatterLineCount, 0) === 0 ? 0 : st.cursor.to.ch,
            line: Math.max(st.cursor.to.line - frontmatterLineCount, 0)
          }
        };
      }
      frontmatter.scroll = st.scroll;

      // Use Obsidian API to update frontmatter, and handle error
      try {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          Object.assign(fm, frontmatter);
        });
      } catch (error) {
        console.error("Save cursor position error when updating frontmatter:", error);
        new Notice("Failed to update cursor position information in frontmatter");
      }
    }
  }

  private getFrontmatterLineCount(file: TFile): number {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache || !cache.frontmatter) {
      console.log("Frontmatter not found");
      return 0;
    }

    const position = cache.frontmatterPosition;
    if (!position) {
      console.log("Frontmatter position not found");
      return 0;
    }

    // console.log("Frontmatter line cnt: ", position.end.line);
    return position.end.line;
  }
}

class SettingTab extends PluginSettingTab {
  plugin: RememberCursorPosition;

  constructor(app: App, plugin: RememberCursorPosition) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    let { containerEl } = this;

    containerEl.empty();

    containerEl.createEl("h2", { text: "Save cursor position - Settings" });

    new Setting(containerEl)
      .setName("Delay after opening a new note")
      .setDesc(
        "This plugin shouldn't scroll if you used a link to the note header like [link](note.md#header). If it did, then increase the delay until everything works. If you are not using links to page sections, set the delay to zero (slider to the left). Slider values: 0-300 ms (default value: 100 ms)."
      )
      .addSlider((text) =>
        text
          .setLimits(0, 300, 10)
          .setValue(this.plugin.settings.delayAfterFileOpening)
          .onChange(async (value) => {
            this.plugin.settings.delayAfterFileOpening = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
