import {
  App,
  EventRef,
  Menu,
  MenuItem,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem,
  TFile,
} from 'obsidian';
import {
  buildArchiveFolderMatcher,
  currentMoment,
  resolveArchiveFolder,
  toArchiveFolderPath,
} from './src/archive-folder-pattern';
import { NotebookNavigatorIntegration } from './src/notebook-navigator-integration';

interface ArchiveFileSettings {
  showInFileMenu: boolean;
  showInSearch: boolean;
  showNotification: boolean;
  archiveFolder: string;
  useTimestamps: boolean;
  tagsToStrip: string;
  removeEmptyTags: boolean;
}

const FEEDBACK_URL = 'https://github.com/churnish/archive-file/issues';
const DISCUSSIONS_URL = 'https://github.com/churnish/archive-file/discussions';

const DEFAULT_SETTINGS: ArchiveFileSettings = {
  showInFileMenu: true,
  showInSearch: true,
  showNotification: true,
  archiveFolder: '',
  useTimestamps: true,
  tagsToStrip: '',
  removeEmptyTags: true,
};

interface WorkspaceWithSearch {
  on(
    name: 'search:results-menu',
    callback: (menu: Menu, leaf: SearchLeaf) => void
  ): EventRef;
}

interface SearchLeaf {
  dom?: {
    vChildren?: {
      children?: Array<{ file?: TFile }>;
    };
  };
}

interface FrontMatter {
  tags?: string | string[] | null;
  [key: string]: unknown;
}

export default class ArchiveFilePlugin extends Plugin {
  settings: ArchiveFileSettings;

  async onload() {
    await this.loadSettings();

    // Command palette
    this.addCommand({
      id: 'archive-active-file',
      name: 'Archive current file',
      icon: 'archive-restore',
      callback: () => this.archiveActiveFile(),
    });

    // File context menus. Every menu handler reads its setting when the menu opens rather than registering conditionally, so toggling it applies without a reload.
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!this.settings.showInFileMenu) return;
        if (!(file instanceof TFile)) return;
        menu.addItem((item) =>
          this.configureArchiveMenuItem(item, [file]).setSection('action')
        );
      })
    );
    this.registerEvent(
      this.app.workspace.on('files-menu', (menu, files) => {
        if (!this.settings.showInFileMenu) return;
        const tfiles = files.filter((f): f is TFile => f instanceof TFile);
        if (tfiles.length === 0) return;
        menu.addItem((item) =>
          this.configureArchiveMenuItem(item, tfiles).setSection('action')
        );
      })
    );

    // Ribbon icon
    this.addRibbonIcon('archive-restore', 'Archive file', () =>
      this.archiveActiveFile()
    );

    // Vault search results menu
    this.registerEvent(
      (this.app.workspace as unknown as WorkspaceWithSearch).on(
        'search:results-menu',
        (menu, leaf) => {
          if (!this.settings.showInSearch) return;
          const files: TFile[] = [];
          if (leaf.dom?.vChildren?.children) {
            for (const child of leaf.dom.vChildren.children) {
              if (child.file instanceof TFile) {
                files.push(child.file);
              }
            }
          }
          if (files.length === 0) return;
          menu.addItem((item) =>
            this.configureArchiveMenuItem(item, files).setSection('action')
          );
        }
      )
    );

    this.app.workspace.onLayoutReady(() => {
      new NotebookNavigatorIntegration(this).register();
    });

    this.addSettingTab(new ArchiveFileSettingTab(this.app, this));
  }

  /** Shared by every file menu that offers archiving. Leaves the section to the caller, since Notebook Navigator's menu does not group items by section. */
  configureArchiveMenuItem(item: MenuItem, files: TFile[]): MenuItem {
    return item
      .setTitle(this.getMenuTitle(files.length))
      .setIcon('archive-restore')
      .onClick(() => this.archiveFiles(files));
  }

  private archiveActiveFile(): void {
    const file = this.app.workspace.getActiveFile();
    if (file) {
      void this.archiveFiles([file]);
    } else {
      new Notice('No active file');
    }
  }

  private getMenuTitle(count: number): string {
    return count === 1 ? 'Archive file' : `Archive ${count} items`;
  }

  private async archiveFiles(files: TFile[]): Promise<void> {
    if (files.length === 0) return;

    if (!this.settings.archiveFolder) {
      new Notice('No archive folder set');
      return;
    }

    // Pre-compute shared values once
    const folderTemplate = toArchiveFolderPath(this.settings.archiveFolder);
    const archiveFolder = this.settings.useTimestamps
      ? toArchiveFolderPath(
          resolveArchiveFolder(folderTemplate, currentMoment())
        )
      : folderTemplate;
    // With timestamps, a folder the template resolved to on an earlier date is already the file's archive, so it stays there
    const isArchiveFolder = this.settings.useTimestamps
      ? buildArchiveFolderMatcher(folderTemplate)
      : (folderPath: string) => folderPath === archiveFolder;

    const tagsToStrip = this.settings.tagsToStrip
      ? this.settings.tagsToStrip
          .split(',')
          .map((t) => t.trim().replace(/^#/, '').toLowerCase())
          .filter(Boolean)
      : [];

    let movedCount = 0;
    let failedCount = 0;
    for (const file of files) {
      const result = await this.archiveFile(
        file,
        archiveFolder,
        isArchiveFolder,
        tagsToStrip
      );
      if (result === 'moved') movedCount++;
      else if (result === 'failed') failedCount++;
    }

    if (this.settings.showNotification) {
      if (files.length === 1) {
        if (movedCount === 1) new Notice('File archived');
        else if (failedCount === 0) new Notice('File already archived');
      } else if (movedCount > 0) {
        new Notice(
          movedCount === 1 ? '1 file archived' : `${movedCount} files archived`
        );
      }
    }
  }

  private async archiveFile(
    file: TFile,
    archiveFolder: string,
    isArchiveFolder: (folderPath: string) => boolean,
    tagsToStrip: string[]
  ): Promise<'moved' | 'skipped' | 'failed'> {
    // The vault root's path is `/`, but `toArchiveFolderPath` writes the root as `''`
    const currentFolder =
      !file.parent || file.parent.isRoot() ? '' : file.parent.path;
    const needsMove = !isArchiveFolder(currentFolder);

    try {
      if (needsMove) {
        // Create folder if needed (skip for root)
        if (
          archiveFolder &&
          !this.app.vault.getAbstractFileByPath(archiveFolder)
        ) {
          await this.app.vault.createFolder(archiveFolder);
        }

        // Find unique filename
        let newName = file.name;
        let counter = 1;
        const getPath = (name: string) =>
          archiveFolder ? `${archiveFolder}/${name}` : name;
        while (this.app.vault.getAbstractFileByPath(getPath(newName))) {
          newName = file.extension
            ? `${file.basename} ${counter}.${file.extension}`
            : `${file.basename} ${counter}`;
          counter++;
        }

        await this.app.fileManager.renameFile(file, getPath(newName));
      }

      // Strip tags regardless of move
      if (tagsToStrip.length > 0 && file.extension === 'md') {
        try {
          await this.app.fileManager.processFrontMatter(
            file,
            (frontmatter: FrontMatter) => {
              if (frontmatter.tags) {
                const currentTags = Array.isArray(frontmatter.tags)
                  ? frontmatter.tags
                  : [frontmatter.tags];
                const filtered = currentTags.filter(
                  (tag) =>
                    typeof tag !== 'string' ||
                    !tagsToStrip.includes(tag.replace(/^#/, '').toLowerCase())
                );
                if (filtered.length === 0) {
                  if (this.settings.removeEmptyTags) {
                    delete frontmatter.tags;
                  } else {
                    frontmatter.tags = null;
                  }
                } else {
                  frontmatter.tags = filtered;
                }
              }
            }
          );
        } catch (tagError) {
          console.error('Failed to strip tags:', tagError);
        }
      }

      return needsMove ? 'moved' : 'skipped';
    } catch (error) {
      console.error('Failed to archive:', error);
      return 'failed';
    }
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<ArchiveFileSettings>
    );
  }
}

/** Rebuilt on every call so the example dates follow the current month. */
function buildTimestampDescription(): DocumentFragment {
  const now = currentMoment();
  return createFragment((desc) => {
    desc.appendText('Convert date tokens in {braces} using ');
    desc.createEl('a', {
      text: 'Moment',
      href: 'https://momentjs.com/docs/#/displaying/format/',
    });
    desc.appendText(
      ` format. E.g., {YYYY} → ${now.format('YYYY')}, {MM} → ${now.format('MM')}.`
    );
  });
}

/** `render` rather than `action`, so the button keeps its label instead of turning the whole row into a click target. */
function buildLinkButtonRow(url: string): (setting: Setting) => void {
  return (setting) => {
    setting.addButton((button) =>
      button.setButtonText('Open').onClick(() => {
        setting.settingEl.win.open(url, '_blank');
      })
    );
  };
}

// The inherited getControlValue/setControlValue read and save `plugin.settings` by key, which fits these flat settings without overrides
class ArchiveFileSettingTab extends PluginSettingTab {
  plugin: ArchiveFilePlugin;

  constructor(app: App, plugin: ArchiveFilePlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.icon = 'archive-restore';
  }

  getSettingDefinitions(): SettingDefinitionItem<keyof ArchiveFileSettings>[] {
    return [
      {
        name: 'Archive folder',
        desc: 'Destination folder for archived files.',
        // Free text with folder suggestions, so date tokens in braces are kept as typed
        control: {
          type: 'folder',
          key: 'archiveFolder',
          placeholder: 'Archive',
        },
      },
      {
        name: 'Resolve timestamps in folder path',
        desc: buildTimestampDescription(),
        control: { type: 'toggle', key: 'useTimestamps' },
      },
      {
        name: 'Tags to strip',
        desc: 'Comma-separated list of tags to remove from properties when archiving.',
        control: {
          type: 'text',
          key: 'tagsToStrip',
          placeholder: 'inbox, todo',
        },
      },
      {
        name: 'Remove empty tags property',
        desc: 'Delete the tags property from properties if all tags are stripped.',
        visible: () => !!this.plugin.settings.tagsToStrip,
        control: { type: 'toggle', key: 'removeEmptyTags' },
      },
      {
        name: 'Show file command',
        desc: 'Show the archive command in the file context menu.',
        control: { type: 'toggle', key: 'showInFileMenu' },
      },
      {
        name: 'Show search command',
        desc: 'Show the archive command in the vault search context menu.',
        control: { type: 'toggle', key: 'showInSearch' },
      },
      {
        name: 'Show notification',
        desc: 'Show a notice after archiving files.',
        control: { type: 'toggle', key: 'showNotification' },
      },
      // Support addresses the plugin itself rather than any setting, so it gets its own box at the very bottom. Discuss leads because it is the self-serve option — a user who finds an existing answer never needs the row below it.
      {
        type: 'group',
        heading: 'Support',
        items: [
          {
            name: 'Discuss',
            desc: 'Browse discussions or ask a question.',
            render: buildLinkButtonRow(DISCUSSIONS_URL),
          },
          {
            name: 'Send feedback',
            desc: 'Request improvements or report bugs.',
            render: buildLinkButtonRow(FEEDBACK_URL),
          },
        ],
      },
    ];
  }
}
