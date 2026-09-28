import { Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { normalizeSettings, targetHeights, type SidebarExpandSettings } from './src/layout';

const PANE_SELECTOR = '.workspace-tabs, .nn-navigation-pane, .nn-list-pane';
const RESIZE_SELECTOR = '.workspace-leaf-resize-handle, .nn-resizer-handle, .nn-resize-handle';
const VARIABLES = ['--sidebar-expand-weight', '--sidebar-expand-min-height', '--sidebar-expand-duration'];
interface PaneState {
    el: HTMLElement;
    values: { value: string; priority: string }[];
}

export default class SidebarExpandPlugin extends Plugin {
    settings: SidebarExpandSettings = normalizeSettings(null);
    private activePane: HTMLElement | null = null;
    private panes: PaneState[] = [];
    private leaveTimer: number | null = null;
    private resizeTimer: number | null = null;
    private resizing = false;
    private disposed = false;
    private holdKeyDown = false;
    private fullHeightClasses: { el: HTMLElement; name: string; parent: HTMLElement | null }[] = [];

    async onload(): Promise<void> {
        const saved: unknown = await this.loadData();
        this.settings = normalizeSettings(saved);
        this.addSettingTab(new SidebarExpandSettingTab(this));
        this.addCommand({
            id: 'toggle-full-height-hover',
            name: 'Toggle full-height hover',
            callback: async () => {
                this.settings.fullHeightEnabled = !this.settings.fullHeightEnabled;
                await this.saveSettings();
                new Notice(this.settings.fullHeightEnabled ? 'Full-height hover enabled.' : 'Full-height hover disabled.');
            }
        });
        this.app.workspace.onLayoutReady(() => {
            if (this.disposed) return;
            // Sidebar markup has no public pane-sizing API. Keep DOM access scoped
            // to the main workspace; never alter editor or floating-window panes.
            const root = this.app.workspace.containerEl;
            this.watchSidebar(root);
        });
        this.registerEvent(this.app.workspace.on('layout-change', () => this.reset()));
    }

    private watchSidebar(root: HTMLElement): void {
        const updateHoldKey = (event: KeyboardEvent): void => {
            const held = this.settings.fullHeightHoldKey !== 'None' && event.getModifierState(this.settings.fullHeightHoldKey);
            if (held === this.holdKeyDown) return;
            this.holdKeyDown = held;
            this.refreshExpansion();
        };
        this.registerDomEvent(root.doc, 'keydown', updateHoldKey);
        this.registerDomEvent(root.doc, 'keyup', updateHoldKey);
        this.registerDomEvent(root, 'mouseover', (event: MouseEvent) => {
            if (this.disposed || this.resizing) return;
            const target = event.target as Node | null;
            if (!(target?.instanceOf(Element))) return;
            const pane = target.closest<HTMLElement>(PANE_SELECTOR);
            if (!pane || !pane.closest('.mod-left-split, .mod-right-split')) return;
            const held = this.settings.fullHeightHoldKey !== 'None' && event.getModifierState(this.settings.fullHeightHoldKey);
            const changed = held !== this.holdKeyDown;
            this.holdKeyDown = held;
            this.clearLeaveTimer();
            if (pane !== this.activePane || changed) this.expand(pane);
        });
        this.registerDomEvent(root, 'mouseout', (event: MouseEvent) => {
            const pane = this.activePane;
            if (!pane) return;
            const next = event.relatedTarget as Node | null;
            if (next?.instanceOf(Node) && pane.contains(next)) return;
            this.clearLeaveTimer();
            this.leaveTimer = window.setTimeout(() => {
                this.leaveTimer = null;
                this.reset();
            }, 50);
        });
        this.registerDomEvent(root, 'mousedown', (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!(target?.instanceOf(Element)) || !target.closest(RESIZE_SELECTOR)) return;
            if (!target.closest('.mod-left-split, .mod-right-split')) return;
            this.reset();
            this.resizing = true;
            if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
        });
        this.registerDomEvent(root.doc, 'mouseup', () => {
            if (!this.resizing) return;
            if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
            this.resizeTimer = window.setTimeout(() => {
                this.resizeTimer = null;
                this.resizing = false;
            }, 200);
        });
        this.registerDomEvent(root.win, 'blur', () => {
            this.holdKeyDown = false;
            this.resizing = false;
            this.reset();
        });
        // Delegation covers new tabs; restore when an active pane moves or closes.
        const observer = new MutationObserver(() => {
            if (this.panes.some(({ el }) => !el.isConnected || el.parentElement !== this.activePane?.parentElement) ||
                this.fullHeightClasses.some(({ el, parent }) => !el.isConnected || el.parentElement !== parent)) {
                this.reset();
            }
        });
        observer.observe(root, { childList: true, subtree: true });
        this.register(() => observer.disconnect());
    }

    private expand(pane: HTMLElement): void {
        this.reset();
        if (this.settings.fullHeightEnabled || this.holdKeyDown) {
            this.expandFullHeight(pane);
            return;
        }
        const parent = pane.parentElement;
        if (!parent || !parent.matches('.workspace-split, .nn-split-container')) return;
        // Respect horizontal third-party layouts instead of forcing them vertical.
        if (pane.win.getComputedStyle(parent).flexDirection !== 'column') return;
        const siblings = Array.from(parent.children).filter((el): el is HTMLElement =>
            el.instanceOf(HTMLElement) &&
            el.matches('.workspace-tabs, .workspace-split, .nn-navigation-pane, .nn-list-pane') &&
            el.offsetHeight > 0
        );
        const index = siblings.indexOf(pane);
        if (index < 0 || siblings.length < 2) return;
        const heights = siblings.map(el => el.offsetHeight);
        const weights = targetHeights(heights, index, this.settings.expansionAmount);
        this.activePane = pane;
        this.panes = siblings.map(el => ({
            el,
            values: VARIABLES.map(name => ({ value: el.style.getPropertyValue(name), priority: el.style.getPropertyPriority(name) }))
        }));
        siblings.forEach((el, i) => {
            el.style.setProperty('--sidebar-expand-weight', String(weights[i]));
            el.style.setProperty('--sidebar-expand-min-height', `${Math.min(40, heights[i])}px`);
            el.style.setProperty('--sidebar-expand-duration', `${this.settings.transitionDuration}ms`);
            el.classList.add('sidebar-expand-managed');
        });
    }

    private clearLeaveTimer(): void {
        if (this.leaveTimer !== null) window.clearTimeout(this.leaveTimer);
        this.leaveTimer = null;
    }

    private refreshExpansion(): void {
        const pane = this.activePane;
        if (pane && pane.isConnected && !this.resizing && !this.disposed) this.expand(pane);
    }

    private addFullHeightClass(el: HTMLElement, name: string): void {
        if (el.classList.contains(name)) return;
        this.fullHeightClasses.push({ el, name, parent: el.parentElement });
        el.classList.add(name);
    }

    private expandFullHeight(pane: HTMLElement): void {
        const sidebar = pane.closest<HTMLElement>('.mod-left-split, .mod-right-split');
        if (!sidebar) return;
        this.activePane = pane;
        // Walk outward so nested groups can fill the whole sidebar's content area.
        // Keep the sidebar's own controls and vault footer available.
        let branch: HTMLElement = pane;
        while (branch !== sidebar && branch.parentElement) {
            const parent = branch.parentElement;
            if (parent.matches('.workspace-split, .nn-split-container') &&
                pane.win.getComputedStyle(parent).flexDirection === 'column') {
                this.addFullHeightClass(branch, 'sidebar-expand-full-active');
                for (const sibling of Array.from(parent.children)) {
                    if (sibling === branch || !sibling.instanceOf(HTMLElement)) continue;
                    if (sibling.matches(`${PANE_SELECTOR}, .workspace-split, ${RESIZE_SELECTOR}`)) {
                        this.addFullHeightClass(sibling, 'sidebar-expand-full-hidden');
                    }
                }
            }
            branch = parent;
        }
    }

    private reset(): void {
        this.clearLeaveTimer();
        for (const { el, name } of this.fullHeightClasses) el.classList.remove(name);
        this.fullHeightClasses = [];
        for (const { el, values } of this.panes) {
            el.classList.remove('sidebar-expand-managed');
            VARIABLES.forEach((name, index) => {
                const saved = values[index];
                if (saved.value) el.style.setProperty(name, saved.value, saved.priority);
                else el.style.removeProperty(name);
            });
        }
        this.panes = [];
        this.activePane = null;
    }

    onunload(): void {
        this.disposed = true;
        if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
        this.resizeTimer = null;
        this.reset();
    }

    async saveSettings(): Promise<void> {
        this.settings = normalizeSettings(this.settings);
        this.refreshExpansion();
        await this.saveData(this.settings);
    }

    async setHoldKey(value: string): Promise<void> {
        this.settings = normalizeSettings({ ...this.settings, fullHeightHoldKey: value });
        this.holdKeyDown = false;
        await this.saveSettings();
    }
}


class SidebarExpandSettingTab extends PluginSettingTab {
    constructor(private readonly sidebarPlugin: SidebarExpandPlugin) {
        super(sidebarPlugin.app, sidebarPlugin);
    }

    display(): void {
        this.containerEl.empty();
        for (const definition of this.getSettingDefinitions()) {
            const setting = new Setting(this.containerEl).setName(definition.name).setDesc(definition.desc);
            definition.render(setting);
        }
    }

    getSettingDefinitions() {
        return [
            {
                name: 'Full-height hover',
                desc: 'Fill the sidebar content area while hovering, ignoring the expansion percentage. You can also toggle this with a command in Hotkeys.',
                render: (setting: Setting) => {
                    setting.addToggle(toggle => toggle
                        .setValue(this.sidebarPlugin.settings.fullHeightEnabled)
                        .onChange(async value => {
                            this.sidebarPlugin.settings.fullHeightEnabled = value;
                            await this.sidebarPlugin.saveSettings();
                        }));
                }
            },
            {
                name: 'Full-height hold key',
                desc: 'Hold this modifier while hovering to temporarily fill the sidebar. Release it to return to percentage expansion when the toggle is off.',
                render: (setting: Setting) => {
                    setting.addDropdown(dropdown => dropdown
                        .addOptions({ Alt: 'Alt / Option', Control: 'Control', Shift: 'Shift', Meta: 'Command / Windows', None: 'Disabled' })
                        .setValue(this.sidebarPlugin.settings.fullHeightHoldKey)
                        .onChange(async value => {
                            await this.sidebarPlugin.setHoldKey(value);
                        }));
                }
            },
            {
                name: 'Expansion amount',
                desc: 'Extra height as a percentage of the stacked panes. Default: 18%.',
                render: (setting: Setting) => {
                    setting.addSlider(slider => slider
                        .setLimits(4, 50, 2)
                        .setValue(this.sidebarPlugin.settings.expansionAmount)
                        .setDynamicTooltip()
                        .onChange(async value => {
                            this.sidebarPlugin.settings.expansionAmount = value;
                            await this.sidebarPlugin.saveSettings();
                        }));
                }
            },
            {
                name: 'Transition duration',
                desc: 'Animation duration in milliseconds, from 0 to 2000. Default: 300.',
                render: (setting: Setting) => {
                    setting.addText(text => text
                        .setPlaceholder('300')
                        .setValue(String(this.sidebarPlugin.settings.transitionDuration))
                        .onChange(async value => {
                            if (value.trim() === '') return;
                            const duration = Number(value);
                            if (!Number.isFinite(duration) || duration < 0 || duration > 2000) return;
                            this.sidebarPlugin.settings.transitionDuration = duration;
                            await this.sidebarPlugin.saveSettings();
                        }));
                }
            }
        ];
    }
}
