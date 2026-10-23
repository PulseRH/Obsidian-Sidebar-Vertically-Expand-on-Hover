import { Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { normalizeSettings, notebookNavigatorHeights, targetHeights, type SidebarExpandSettings } from './src/layout';

const PANE_SELECTOR = '.workspace-tabs, .nn-navigation-pane, .nn-list-pane';
const NN_PANE_SELECTOR = '.nn-navigation-pane, .nn-list-pane';
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
    private heights: number[] = [];
    private group: HTMLElement | null = null;
    private leaveTimer: number | null = null;
    private collapseTimer: number | null = null;
    private resizeTimer: number | null = null;
    private resizing = false;
    private disposed = false;
    private holdKeyDown = false;
    private handleGuard = false;
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
        this.registerDomEvent(root, 'mouseover', (event: MouseEvent) => this.hover(event));
        // Pointer moves inside one pane raise no mouseover, so poll only while a
        // resize handle holds the layout still, to notice the pointer leaving it.
        this.registerDomEvent(root, 'mousemove', (event: MouseEvent) => {
            if (this.handleGuard) this.hover(event);
        });
        this.registerDomEvent(root, 'mouseout', (event: MouseEvent) => {
            const pane = this.activePane;
            if (!pane) return;
            const next = event.relatedTarget as Node | null;
            if (next?.instanceOf(Node) && pane.contains(next)) return;
            this.clearLeaveTimer();
            this.leaveTimer = window.setTimeout(() => {
                this.leaveTimer = null;
                this.collapse();
            }, 50);
        });
        // Release the expansion before Obsidian starts dragging, or the managed
        // sizes override its own and the handle appears stuck until you let go.
        // Capture phase, and pointer events too: Obsidian's drag handler may stop
        // propagation, and cancelling pointerdown suppresses mousedown/mouseup.
        const startResize = (event: MouseEvent): void => {
            const target = event.target as Node | null;
            if (!(target?.instanceOf(Element)) || !target.closest(RESIZE_SELECTOR)) return;
            if (!target.closest('.mod-left-split, .mod-right-split')) return;
            this.reset();
            this.resizing = true;
            if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
            this.resizeTimer = null;
        };
        const endResize = (): void => {
            if (!this.resizing) return;
            if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
            this.resizeTimer = window.setTimeout(() => {
                this.resizeTimer = null;
                this.resizing = false;
            }, 200);
        };
        this.registerDomEvent(root, 'pointerdown', startResize, { capture: true });
        this.registerDomEvent(root, 'mousedown', startResize, { capture: true });
        this.registerDomEvent(root.doc, 'pointerup', endResize, { capture: true });
        this.registerDomEvent(root.doc, 'pointercancel', endResize, { capture: true });
        this.registerDomEvent(root.doc, 'mouseup', endResize, { capture: true });
        this.registerDomEvent(root.win, 'blur', () => {
            this.holdKeyDown = false;
            this.resizing = false;
            this.reset();
        });
        // Delegation covers new tabs; restore when an active pane moves or closes.
        const observer = new MutationObserver(() => {
            if (this.panes.some(({ el }) => !el.isConnected || el.parentElement !== this.group) ||
                this.fullHeightClasses.some(({ el, parent }) => !el.isConnected || el.parentElement !== parent)) {
                this.reset();
            }
        });
        observer.observe(root, { childList: true, subtree: true });
        this.register(() => observer.disconnect());
    }

    private isVerticallyStacked(parent: HTMLElement, panes: HTMLElement[]): boolean {
        if (panes.length < 2) return false;
        const first = panes[0].getBoundingClientRect();
        const second = panes[1].getBoundingClientRect();
        if (first.width > 0 && first.height > 0 && second.width > 0 && second.height > 0) {
            return Math.abs(first.left - second.left) < 2 && second.top > first.top;
        }
        return parent.win.getComputedStyle(parent).flexDirection === 'column';
    }

    private stackedSiblings(parent: HTMLElement): HTMLElement[] {
        return Array.from(parent.children).filter((el): el is HTMLElement =>
            el.instanceOf(HTMLElement) &&
            el.matches('.workspace-tabs, .workspace-split, .nn-navigation-pane, .nn-list-pane') &&
            el.offsetHeight > 0
        );
    }

    private expand(pane: HTMLElement): void {
        const isNotebookNavigator = pane.matches(NN_PANE_SELECTOR);
        const parent = pane.parentElement;
        // Moving to another pane of the group that is already expanded only
        // re-weights it. Resetting first would snap the old pane back to its
        // original size for a frame before the new one starts growing.
        if (parent && this.panes.length > 0 && this.fullHeightClasses.length === 0 &&
            !this.settings.fullHeightEnabled && !this.holdKeyDown &&
            !(isNotebookNavigator && !this.settings.notebookNavigatorSupport) &&
            parent === this.panes[0].el.parentElement) {
            const siblings = this.stackedSiblings(parent);
            const index = siblings.indexOf(pane);
            if (index >= 0 && siblings.length === this.panes.length && siblings.every((el, i) => el === this.panes[i].el)) {
                this.clearCollapseTimer();
                this.activePane = pane;
                this.applyWeights(siblings, index, isNotebookNavigator);
                return;
            }
        }
        this.reset();
        if (isNotebookNavigator && !this.settings.notebookNavigatorSupport) return;
        if (!parent || !parent.matches('.workspace-split, .nn-split-container')) return;
        const siblings = this.stackedSiblings(parent);
        if (isNotebookNavigator && !this.isVerticallyStacked(parent, siblings)) return;
        if (this.settings.fullHeightEnabled || this.holdKeyDown) {
            this.expandFullHeight(pane);
            return;
        }
        if (!isNotebookNavigator && parent.win.getComputedStyle(parent).flexDirection !== 'column') return;
        const index = siblings.indexOf(pane);
        if (index < 0 || siblings.length < 2) return;
        // Measured once per group, before any expansion, so later re-weights
        // start from the user's own sizes rather than the expanded ones.
        this.heights = siblings.map(el => el.offsetHeight);
        this.group = parent;
        this.activePane = pane;
        this.panes = siblings.map(el => ({
            el,
            values: VARIABLES.map(name => ({ value: el.style.getPropertyValue(name), priority: el.style.getPropertyPriority(name) }))
        }));
        this.applyWeights(siblings, index, isNotebookNavigator);
    }

    private applyWeights(siblings: HTMLElement[], index: number, isNotebookNavigator: boolean): void {
        const heights = this.heights;
        const weights = isNotebookNavigator ? notebookNavigatorHeights(heights, index) :
            targetHeights(heights, index, this.settings.expansionAmount);
        siblings.forEach((el, i) => {
            el.style.setProperty('--sidebar-expand-weight', String(weights[i]));
            const minimum = isNotebookNavigator ? Math.min(heights[i], Math.max(60, heights[i] * 0.2)) : Math.min(40, heights[i]);
            el.style.setProperty('--sidebar-expand-min-height', `${minimum}px`);
            el.style.setProperty('--sidebar-expand-duration', `${this.settings.transitionDuration}ms`);
            el.classList.add('sidebar-expand-managed');
        });
    }

    /** Hovering a resize handle, or the margin around it, freezes the current
     *  layout so the handle stays where it is while you reach for it. */
    private isOverResizeHandle(target: Element, sidebar: HTMLElement, event: MouseEvent): boolean {
        if (target.closest(RESIZE_SELECTOR)) return true;
        const margin = this.settings.resizeHandleMargin;
        if (margin <= 0) return false;
        for (const handle of Array.from(sidebar.querySelectorAll<HTMLElement>(RESIZE_SELECTOR))) {
            if (handle.offsetHeight <= 0 && handle.offsetWidth <= 0) continue;
            const rect = handle.getBoundingClientRect();
            if (event.clientX >= rect.left - margin && event.clientX <= rect.right + margin &&
                event.clientY >= rect.top - margin && event.clientY <= rect.bottom + margin) return true;
        }
        return false;
    }

    private hover(event: MouseEvent): void {
        if (this.disposed || this.resizing) return;
        const target = event.target as Node | null;
        if (!(target?.instanceOf(Element))) return;
        const sidebar = target.closest<HTMLElement>('.mod-left-split, .mod-right-split');
        if (!sidebar) {
            this.handleGuard = false;
            return;
        }
        if (this.isOverResizeHandle(target, sidebar, event)) {
            this.handleGuard = true;
            this.clearLeaveTimer();
            return;
        }
        this.handleGuard = false;
        const pane = target.closest<HTMLElement>(PANE_SELECTOR);
        if (!pane) return;
        const held = this.settings.fullHeightHoldKey !== 'None' && event.getModifierState(this.settings.fullHeightHoldKey);
        const changed = held !== this.holdKeyDown;
        this.holdKeyDown = held;
        this.clearLeaveTimer();
        if (pane !== this.activePane || changed) this.expand(pane);
    }

    /** Ease every pane back to its measured height, which is the layout Obsidian
     *  restores, then hand sizing back once the transition has finished. */
    private collapse(): void {
        if (this.panes.length === 0 || this.fullHeightClasses.length > 0 || this.settings.transitionDuration <= 0) {
            this.reset();
            return;
        }
        this.activePane = null;
        this.handleGuard = false;
        this.panes.forEach(({ el }, i) => el.style.setProperty('--sidebar-expand-weight', String(this.heights[i])));
        this.clearCollapseTimer();
        this.collapseTimer = window.setTimeout(() => {
            this.collapseTimer = null;
            this.reset();
        }, this.settings.transitionDuration);
    }

    private clearCollapseTimer(): void {
        if (this.collapseTimer !== null) window.clearTimeout(this.collapseTimer);
        this.collapseTimer = null;
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
        this.clearCollapseTimer();
        this.handleGuard = false;
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
        this.heights = [];
        this.group = null;
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

interface SettingDefinition {
    name: string;
    desc: string;
    hidden?: () => boolean;
    render: (setting: Setting) => void;
}

class SidebarExpandSettingTab extends PluginSettingTab {
    constructor(private readonly sidebarPlugin: SidebarExpandPlugin) {
        super(sidebarPlugin.app, sidebarPlugin);
    }

    display(): void {
        this.containerEl.empty();
        for (const definition of this.getSettingDefinitions()) {
            if (definition.hidden?.()) continue;
            const setting = new Setting(this.containerEl).setName(definition.name).setDesc(definition.desc);
            definition.render(setting);
        }
    }

    getSettingDefinitions(): SettingDefinition[] {
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
                            this.display();
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
                name: 'Notebook Navigator support',
                desc: 'Expand Notebook Navigator navigation and list panes when they are stacked vertically. Side-by-side panes are left unchanged.',
                render: (setting: Setting) => {
                    setting.addToggle(toggle => toggle
                        .setValue(this.sidebarPlugin.settings.notebookNavigatorSupport)
                        .onChange(async value => {
                            this.sidebarPlugin.settings.notebookNavigatorSupport = value;
                            await this.sidebarPlugin.saveSettings();
                        }));
                }
            },
            {
                name: 'Expansion amount',
                desc: 'Extra height as a percentage of the stacked panes. Default: 12%.',
                // Full-height hover ignores the percentage, so the slider would do nothing.
                hidden: () => this.sidebarPlugin.settings.fullHeightEnabled,
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
                name: 'Resize handle margin',
                desc: 'Keep the layout still within this many pixels of a resize handle so you can drag it without expanding a pane. Set to 0 to disable. Default: 6.',
                render: (setting: Setting) => {
                    setting.addSlider(slider => slider
                        .setLimits(0, 24, 2)
                        .setValue(this.sidebarPlugin.settings.resizeHandleMargin)
                        .setDynamicTooltip()
                        .onChange(async value => {
                            this.sidebarPlugin.settings.resizeHandleMargin = value;
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
