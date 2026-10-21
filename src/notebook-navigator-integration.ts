import { EventRef, MenuItem, TFile } from 'obsidian';
import type ArchiveFilePlugin from '../main';

interface NotebookNavigatorFileMenuContext {
  addItem: (callback: (item: MenuItem) => void) => void;
  file: TFile;
  selection: { mode: 'single' | 'multiple'; files: readonly TFile[] };
}

interface NotebookNavigatorMenusApi {
  registerFileMenu?: (
    callback: (context: NotebookNavigatorFileMenuContext) => void
  ) => () => void;
}

interface NotebookNavigatorPluginLike {
  api?: { menus?: NotebookNavigatorMenusApi };
}

/** Obsidian's plugin registry (undocumented); `changed` fires whenever any plugin is enabled or disabled. */
interface AppWithPlugins {
  plugins: {
    getPlugin(id: string): unknown;
    on(name: 'changed', callback: () => unknown): EventRef;
  };
}

/** Notebook Navigator builds its own file menu and never fires Obsidian's `file-menu` or `files-menu` events, so the archive item reaches it only through Notebook Navigator's `menus` API. No-op while Notebook Navigator is absent or predates that API. */
export class NotebookNavigatorIntegration {
  private disposeFileMenu: (() => void) | null = null;

  // Identity of the `menus` object currently wired up: `undefined` before the first sync, `null` while Notebook Navigator is absent.
  private registeredAgainst: NotebookNavigatorMenusApi | null | undefined =
    undefined;

  constructor(private plugin: ArchiveFilePlugin) {}

  register(): void {
    this.syncRegistration();

    // Notebook Navigator can be enabled mid-session, and re-enabling it rebuilds its menu registry, so a one-shot check would miss it
    this.plugin.registerEvent(
      (this.plugin.app as unknown as AppWithPlugins).plugins.on('changed', () =>
        this.syncRegistration()
      )
    );

    this.plugin.register(() => this.dispose());
  }

  private syncRegistration(): void {
    const notebookNavigator = (
      this.plugin.app as unknown as AppWithPlugins
    ).plugins.getPlugin(
      'notebook-navigator'
    ) as NotebookNavigatorPluginLike | null;
    const menus = notebookNavigator?.api?.menus ?? null;

    // `changed` fires for every plugin toggle in the vault, so skip anything that leaves the wiring unchanged
    if (menus === this.registeredAgainst) return;

    this.dispose();
    this.registeredAgainst = menus;
    if (typeof menus?.registerFileMenu !== 'function') return;

    this.disposeFileMenu = menus.registerFileMenu(({ addItem, selection }) => {
      // Read on every open, as Obsidian's own menu handlers do, so the toggle applies without a reload
      if (!this.plugin.settings.showInFileMenu) return;
      const files = selection.files.filter(
        (file): file is TFile => file instanceof TFile
      );
      if (files.length === 0) return;
      addItem((item) => this.plugin.configureArchiveMenuItem(item, files));
    });
  }

  private dispose(): void {
    try {
      this.disposeFileMenu?.();
    } catch (error) {
      // A disposer owned by an unloaded Notebook Navigator instance must never break this plugin's own teardown
      console.error('Failed to dispose Notebook Navigator menu hook:', error);
    }
    this.disposeFileMenu = null;
  }
}
