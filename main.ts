import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface SidebarExpandSettings {
	expansionAmount: number; // total expansion in vh
	transitionDuration: number;
}

const DEFAULT_SETTINGS: SidebarExpandSettings = {
	expansionAmount: 18,
	transitionDuration: 300
}

export default class SidebarExpandPlugin extends Plugin {
	settings: SidebarExpandSettings;
	private activeHoveredLeaf: HTMLElement | null = null;
	private observers: MutationObserver[] = [];
	private layoutTimeout: number | null = null;
	private setupTimeout: number | null = null;
	private lastSetupTime: number = 0;
	private lastHoverTimestamp: number = 0;
	private isPluginActive: boolean = true;
	private isResizing: boolean = false;
	private resizeMouseUpHandler: (() => void) | null = null;

	async onload() {
		this.isPluginActive = true;
		try {
			await this.loadSettings();
			this.addSettingTab(new SidebarExpandSettingTab(this.app, this));

			const initializePlugin = () => {
				if (!this.isPluginActive) return;
				try {
					document.documentElement.style.setProperty('--sidebar-expand-transition-duration', `${this.settings.transitionDuration}ms`);

					const workspace = this.app.workspace as any;
					const splits = [workspace.leftSplit, workspace.rightSplit];
					splits.forEach(split => {
						if (split?.containerEl) {
							this.lockVaultProfileElements(split.containerEl);
						}
					});

					this.setupHoverListeners();
					this.startObserving();
				} catch (error) {
					console.error('SidebarExpand: Error during initialization', error);
				}
			};

			const workspace = this.app.workspace as any;
			const isLayoutReady = workspace.layoutReady === true ||
				(workspace.leftSplit && (workspace.leftSplit as any).containerEl) ||
				(workspace.rightSplit && (workspace.rightSplit as any).containerEl);

			if (isLayoutReady) {
				setTimeout(initializePlugin, 100);
			} else {
				this.app.workspace.onLayoutReady(() => {
					initializePlugin();
				});
			}

			this.registerEvent(
				this.app.workspace.on('layout-change', () => {
					if (!this.isPluginActive) return;
					this.debounceSetup();
				})
			);
		} catch (error) {
			console.error('SidebarExpand: Error loading plugin', error);
		}
	}

	private lockVaultProfileElements(root: HTMLElement | Document = document) {
		if (!this.isPluginActive) return;

		const vaultProfileClasses = [
			'workspace-sidedock-vault-profile',
			'workspace-drawer-vault-profile',
			'workspace-drawer-bottom',
			'workspace-sidebar-header',
			'workspace-drawer-header'
		];

		vaultProfileClasses.forEach(cls => {
			const elements = root.querySelectorAll(`.${cls}`);
			elements.forEach((el: HTMLElement) => {
				const height = el.offsetHeight;
				if (height > 0) {
					el.style.setProperty('height', `${height}px`, 'important');
					el.style.setProperty('min-height', `${height}px`, 'important');
					el.style.setProperty('max-height', `${height}px`, 'important');
				}
				el.style.setProperty('flex', '0 0 auto', 'important');
				el.style.setProperty('flex-grow', '0', 'important');
				el.style.setProperty('flex-shrink', '0', 'important');
				el.style.setProperty('transition', 'none', 'important');
			});
		});
	}

	onunload() {
		this.isPluginActive = false;
		const modifiedElements = document.querySelectorAll('.sidebar-expand-hovered, [data-hover-listener-added], .sidebar-expand-shrunk, .sidebar-expand-split-parent');
		modifiedElements.forEach((el) => {
			const htmlEl = el as HTMLElement;
			htmlEl.style.removeProperty('flex');
			htmlEl.style.removeProperty('flex-grow');
			htmlEl.style.removeProperty('flex-shrink');
			htmlEl.style.removeProperty('flex-basis');
			htmlEl.style.removeProperty('min-height');
			htmlEl.style.removeProperty('height');
			htmlEl.style.removeProperty('max-height');
			htmlEl.style.removeProperty('transition');
			htmlEl.classList.remove('sidebar-expand-hovered');
			htmlEl.classList.remove('sidebar-expand-shrunk');
			htmlEl.classList.remove('sidebar-expand-split-parent');
			if (htmlEl.dataset) {
				delete htmlEl.dataset.hoverListenerAdded;
				delete htmlEl.dataset.sidebarExpandLocked;
			}
		});

		this.observers.forEach(obs => obs.disconnect());
		this.observers = [];
	}

	private isExcludedElement(element: HTMLElement): boolean {
		const vaultProfileClasses = [
			'workspace-sidedock-vault-profile',
			'workspace-drawer-vault-profile',
			'workspace-drawer-bottom',
			'workspace-sidebar-header',
			'workspace-drawer-header'
		];

		const isVaultProfile = vaultProfileClasses.some(cls =>
			element.classList.contains(cls) || element.querySelector(`.${cls}`) !== null
		);

		const hasSettingsIcon = element.querySelector('[aria-label*="settings" i], [aria-label*="Settings"]') !== null;
		const hasHelpIcon = element.querySelector('[aria-label*="help" i], [aria-label*="Help"]') !== null;

		return isVaultProfile || (hasSettingsIcon && hasHelpIcon);
	}

	private startObserving() {
		const workspace = this.app.workspace as any;
		[workspace.leftSplit, workspace.rightSplit].forEach(split => {
			const container = split?.containerEl;
			if (!container) return;
			const observer = new MutationObserver(() => {
				if (!this.isPluginActive) return;
				this.lockVaultProfileElements(container);
				this.debounceSetup();
			});
			observer.observe(container, { childList: true, subtree: true });
			this.observers.push(observer);
		});
	}

	private debounceSetup() {
		if (this.setupTimeout) window.clearTimeout(this.setupTimeout);
		this.setupTimeout = window.setTimeout(() => {
			if (!this.isPluginActive) return;
			this.setupHoverListeners();
			this.setupTimeout = null;
		}, 300);
	}

	private setupHoverListeners() {
		const now = Date.now();
		if (now - this.lastSetupTime < 500) return;
		this.lastSetupTime = now;

		const workspace = this.app.workspace as any;
		[workspace.leftSplit, workspace.rightSplit].forEach(split => {
			const container = split?.containerEl || document.querySelector(`.workspace-split.mod-${split?.side}-split`);
			if (container) {
				// Detect resize handles — disable hover while dragging
				const resizeHandles = container.querySelectorAll('.workspace-leaf-resize-handle');
				resizeHandles.forEach((handle: HTMLElement) => {
					const instanceId = this.manifest.id;
					if (handle.dataset.hoverListenerAdded === instanceId) return;
					handle.dataset.hoverListenerAdded = instanceId;

					handle.addEventListener('mousedown', () => {
						this.isResizing = true;
						// Clear any active hover state so resize starts from clean layout
						if (this.activeHoveredLeaf) {
							this.onLeafUnhover(this.activeHoveredLeaf);
						}
						const onMouseUp = () => {
							// Delay re-enabling hover so the mouseup doesn't immediately trigger hover
							setTimeout(() => { this.isResizing = false; }, 200);
							document.removeEventListener('mouseup', onMouseUp);
						};
						document.addEventListener('mouseup', onMouseUp);
					});
				});

				const leaves = container.querySelectorAll('.workspace-leaf, .nn-navigation-pane, .nn-list-pane');
				leaves.forEach((leaf: HTMLElement) => {
					if (this.isExcludedElement(leaf)) return;

					const instanceId = this.manifest.id;
					if (leaf.dataset.hoverListenerAdded === instanceId) return;
					leaf.dataset.hoverListenerAdded = instanceId;

					leaf.addEventListener('mouseenter', () => {
						if (!this.isPluginActive || this.isResizing) return;
						this.onLeafHover(leaf);
					});
				});

				// Attach unhover to .workspace-tabs parents so moving from leaf
				// to tab-header-container (still inside .workspace-tabs) does NOT unhover.
				const tabGroups = container.querySelectorAll('.workspace-tabs');
				tabGroups.forEach((tabGroup: HTMLElement) => {
					const instanceId = this.manifest.id;
					if (tabGroup.dataset.hoverListenerAdded === instanceId) return;
					tabGroup.dataset.hoverListenerAdded = instanceId;

					let unhoverTimeout: number | null = null;

					tabGroup.addEventListener('mouseenter', () => {
						if (!this.isPluginActive) return;
						if (unhoverTimeout) {
							window.clearTimeout(unhoverTimeout);
							unhoverTimeout = null;
						}
					});

					tabGroup.addEventListener('mouseleave', () => {
						if (!this.isPluginActive) return;
						if (!this.activeHoveredLeaf) return;
						if (!tabGroup.contains(this.activeHoveredLeaf)) return;
						const leafToUnhover = this.activeHoveredLeaf;
						unhoverTimeout = window.setTimeout(() => {
							if (!this.isPluginActive) return;
							this.onLeafUnhover(leafToUnhover);
							unhoverTimeout = null;
						}, 50);
					});
				});

				// Handle NN panes not inside .workspace-tabs
				const nnPaneEls = container.querySelectorAll('.nn-navigation-pane, .nn-list-pane');
				nnPaneEls.forEach((pane: HTMLElement) => {
					if (pane.closest('.workspace-tabs')) return;
					const instanceId = this.manifest.id;
					const key = instanceId + '-unhover';
					if ((pane as any).dataset.hoverUnhoverAdded === key) return;
					(pane as any).dataset.hoverUnhoverAdded = key;

					pane.addEventListener('mouseleave', () => {
						if (!this.isPluginActive) return;
						if (this.activeHoveredLeaf !== pane) return;
						window.setTimeout(() => {
							if (!this.isPluginActive) return;
							this.onLeafUnhover(pane);
						}, 50);
					});
				});
			}
		});
	}

	private getFilteredPanes(parentSplit: HTMLElement): HTMLElement[] {
		return Array.from(parentSplit.children).filter(el => {
			const htmlEl = el as HTMLElement;
			if (this.isExcludedElement(htmlEl)) return false;
			if (el.classList.contains('workspace-leaf-resize-handle') ||
				el.classList.contains('nn-resizer-handle') ||
				el.classList.contains('nn-resize-handle')) return false;
			if (!el.className || el.className.trim() === '') return false;
			if (htmlEl.offsetHeight === 0 && htmlEl.offsetWidth === 0) return false;
			return true;
		}) as HTMLElement[];
	}

	private findActivePane(activePane: HTMLElement, panes: HTMLElement[]): HTMLElement | null {
		if (panes.indexOf(activePane) >= 0) return activePane;

		const isNavPane = activePane.classList.contains('nn-navigation-pane');
		const isListPane = activePane.classList.contains('nn-list-pane');

		if (isNavPane || isListPane) {
			return panes.find(p => {
				if (isNavPane) return p.classList.contains('nn-navigation-pane');
				if (isListPane) return p.classList.contains('nn-list-pane');
				return false;
			}) || null;
		}

		let current: HTMLElement | null = activePane;
		while (current) {
			if (panes.indexOf(current) >= 0) return current;
			current = current.parentElement;
		}
		return null;
	}

	private onLeafHover(leafEl: HTMLElement) {
		if (!this.isPluginActive) return;

		const activePane = this.getPaneFromLeaf(leafEl);
		const parentSplit = activePane?.parentElement;
		const isNNPane = activePane && (activePane.classList.contains('nn-navigation-pane') || activePane.classList.contains('nn-list-pane'));

		if (!activePane || !parentSplit) return;

		if (this.activeHoveredLeaf === leafEl) return;

		// Throttle / anti-flicker
		const now = Date.now();
		if (this.activeHoveredLeaf) {
			const oldActivePane = this.getPaneFromLeaf(this.activeHoveredLeaf);
			if (oldActivePane?.parentElement === parentSplit) {
				if (oldActivePane !== activePane) {
					const switchCooldown = isNNPane ? 150 : 300;
					if (now - this.lastHoverTimestamp < switchCooldown) return;
				} else {
					return;
				}
			}
		}
		const throttleDelay = isNNPane ? 50 : 150;
		const isDifferentParent = this.activeHoveredLeaf && this.getPaneFromLeaf(this.activeHoveredLeaf)?.parentElement !== parentSplit;
		if (now - this.lastHoverTimestamp < throttleDelay && !isDifferentParent) return;
		this.lastHoverTimestamp = now;

		this.activeHoveredLeaf = leafEl;

		parentSplit.classList.add('sidebar-expand-split-parent');

		const panes = this.getFilteredPanes(parentSplit);
		if (panes.length <= 1) {
			parentSplit.classList.remove('sidebar-expand-split-parent');
			return;
		}

		const actualActivePane = this.findActivePane(activePane, panes);
		if (!actualActivePane) return;

		const activeIndex = panes.indexOf(actualActivePane);

		// Check if the parent is an NN split container
		const isNNSplit = parentSplit.classList.contains('nn-split-container');

		if (isNNSplit) {
			// NN panes: use old percentage-based approach (66% for 2 panes, 42% for 3+)
			parentSplit.style.setProperty('display', 'flex', 'important');
			parentSplit.style.setProperty('flex-direction', 'column', 'important');

			const otherCount = panes.length - 1;
			const targetPercent = panes.length <= 2 ? 66 : 42;
			const targetRatio = targetPercent / 100;
			const activeFlex = otherCount > 0 ? (targetRatio * otherCount) / (1 - targetRatio) : 1;

			panes.forEach(pane => {
				const isPaneNN = pane.classList.contains('nn-navigation-pane') || pane.classList.contains('nn-list-pane');
				pane.style.setProperty('transition', `flex ${this.settings.transitionDuration}ms ease, min-height ${this.settings.transitionDuration}ms ease`, 'important');

				if (pane === actualActivePane) {
					pane.classList.add('sidebar-expand-hovered');
					pane.classList.remove('sidebar-expand-shrunk');
					pane.style.setProperty('flex-grow', `${activeFlex}`, 'important');
					pane.style.setProperty('flex-shrink', '1', 'important');
					pane.style.setProperty('flex-basis', isPaneNN ? '0' : 'auto', 'important');
					pane.style.setProperty('min-height', '0', 'important');
				} else {
					pane.classList.add('sidebar-expand-shrunk');
					pane.classList.remove('sidebar-expand-hovered');
					const height = (pane as any)._originalHeight || pane.offsetHeight;
					if (!(pane as any)._originalHeight && height > 0) (pane as any)._originalHeight = height;
					const minH = height > 0 ? Math.max(height * 0.2, 60) : 60;
					pane.style.setProperty('flex-grow', '1', 'important');
					pane.style.setProperty('flex-shrink', '1', 'important');
					pane.style.setProperty('flex-basis', isPaneNN ? '0' : 'auto', 'important');
					pane.style.setProperty('min-height', `${minH}px`, 'important');
				}
			});
		} else {
			// Regular sidebar panes: expand by fixed amount, preserving custom sizes
			panes.forEach(pane => {
				if (!(pane as any)._originalHeight) {
					const h = pane.offsetHeight;
					if (h > 0) (pane as any)._originalHeight = h;
					const s = pane.style;
					(pane as any)._origFlex = s.flex || '';
					(pane as any)._origFlexGrow = s.flexGrow || '';
					(pane as any)._origFlexShrink = s.flexShrink || '';
					(pane as any)._origFlexBasis = s.flexBasis || '';
					(pane as any)._origHeight = s.height || '';
					(pane as any)._origMinHeight = s.minHeight || '';
					(pane as any)._origMaxHeight = s.maxHeight || '';
				}
			});

			const totalOriginalH = panes.reduce((sum, p) => sum + ((p as any)._originalHeight || p.offsetHeight), 0);
			const expansionFraction = this.settings.expansionAmount / 100;
			const expansionPx = expansionFraction * totalOriginalH;
			const halfExpansion = expansionPx / 2;

			const panesAbove = panes.slice(0, activeIndex);
			const panesBelow = panes.slice(activeIndex + 1);

			let shrinkAbove = halfExpansion;
			let shrinkBelow = halfExpansion;
			if (panesAbove.length === 0) { shrinkBelow = expansionPx; shrinkAbove = 0; }
			else if (panesBelow.length === 0) { shrinkAbove = expansionPx; shrinkBelow = 0; }

			const perPaneAbove = panesAbove.length > 0 ? shrinkAbove / panesAbove.length : 0;
			const perPaneBelow = panesBelow.length > 0 ? shrinkBelow / panesBelow.length : 0;

			const targetHeights: number[] = panes.map((pane, index) => {
				const originalH = (pane as any)._originalHeight || pane.offsetHeight;
				if (pane === actualActivePane) {
					return originalH + expansionPx;
				} else {
					const shrink = index < activeIndex ? perPaneAbove : perPaneBelow;
					return Math.max(originalH - shrink, 40);
				}
			});

			const transitionValue = `flex-grow ${this.settings.transitionDuration}ms ease, flex-basis ${this.settings.transitionDuration}ms ease`;

			panes.forEach((pane, index) => {
				pane.style.setProperty('transition', transitionValue, 'important');
				pane.style.setProperty('flex-grow', `${targetHeights[index]}`, 'important');
				pane.style.setProperty('flex-shrink', '1', 'important');
				pane.style.setProperty('flex-basis', '0px', 'important');

				if (pane === actualActivePane) {
					pane.classList.add('sidebar-expand-hovered');
					pane.classList.remove('sidebar-expand-shrunk');
				} else {
					pane.classList.add('sidebar-expand-shrunk');
					pane.classList.remove('sidebar-expand-hovered');
				}
			});
		}

		this.lockVaultProfileElements(parentSplit);
		this.updateLayout();
	}

	private onLeafUnhover(leafEl: HTMLElement) {
		if (!this.isPluginActive) return;
		if (this.activeHoveredLeaf !== leafEl) return;

		const activePane = this.getPaneFromLeaf(leafEl);
		const parentSplit = activePane?.parentElement;

		if (parentSplit) {
			setTimeout(() => {
				if (!this.isPluginActive) return;

				const isStillInSplit = this.activeHoveredLeaf !== null && parentSplit.contains(this.activeHoveredLeaf);
				if (isStillInSplit && this.activeHoveredLeaf !== leafEl) return;

				this.activeHoveredLeaf = null;
				parentSplit.classList.remove('sidebar-expand-split-parent');
				const isNNSplit = parentSplit.classList.contains('nn-split-container');
				if (!isNNSplit) {
					parentSplit.style.removeProperty('display');
					parentSplit.style.removeProperty('flex-direction');
				}
				const children = Array.from(parentSplit.children) as HTMLElement[];
				children.forEach(el => {
					if (this.isExcludedElement(el)) return;
					const htmlEl = el as HTMLElement;
					htmlEl.classList.remove('sidebar-expand-hovered');
					htmlEl.classList.remove('sidebar-expand-shrunk');

					if (isNNSplit) {
						// NN panes: reset to equal 50/50 split
						const isPaneNN = htmlEl.classList.contains('nn-navigation-pane') || htmlEl.classList.contains('nn-list-pane');
						if (isPaneNN) {
							htmlEl.style.setProperty('flex-grow', '1', 'important');
							htmlEl.style.setProperty('flex-shrink', '1', 'important');
							htmlEl.style.setProperty('flex-basis', '0', 'important');
							htmlEl.style.removeProperty('min-height');
						}
						htmlEl.style.removeProperty('transition');
						delete (htmlEl as any)._originalHeight;
					} else {
						// Regular panes: restore Obsidian's original flex values
						const restoreOrRemove = (prop: string, saved: string) => {
							if (saved) {
								htmlEl.style.setProperty(prop, saved);
							} else {
								htmlEl.style.removeProperty(prop);
							}
						};
						restoreOrRemove('flex', (htmlEl as any)._origFlex);
						restoreOrRemove('flex-grow', (htmlEl as any)._origFlexGrow);
						restoreOrRemove('flex-shrink', (htmlEl as any)._origFlexShrink);
						restoreOrRemove('flex-basis', (htmlEl as any)._origFlexBasis);
						restoreOrRemove('height', (htmlEl as any)._origHeight);
						restoreOrRemove('min-height', (htmlEl as any)._origMinHeight);
						restoreOrRemove('max-height', (htmlEl as any)._origMaxHeight);
						htmlEl.style.removeProperty('transition');

						delete (htmlEl as any)._originalHeight;
						delete (htmlEl as any)._origFlex;
						delete (htmlEl as any)._origFlexGrow;
						delete (htmlEl as any)._origFlexShrink;
						delete (htmlEl as any)._origFlexBasis;
						delete (htmlEl as any)._origHeight;
						delete (htmlEl as any)._origMinHeight;
						delete (htmlEl as any)._origMaxHeight;
					}
				});
				this.updateLayout();
			}, 30);
		}
	}

	private getPaneFromLeaf(leafEl: HTMLElement): HTMLElement | null {
		if (leafEl.classList.contains('nn-navigation-pane') || leafEl.classList.contains('nn-list-pane')) {
			return leafEl;
		}

		let current: HTMLElement | null = leafEl;
		let depth = 0;
		while (current && current.parentElement && depth < 20) {
			const parent = current.parentElement;
			if (current.classList.contains('nn-navigation-pane') || current.classList.contains('nn-list-pane')) {
				return current;
			}
			if (parent.classList.contains('workspace-split') ||
				parent.classList.contains('nn-split-container')) {
				return current;
			}
			current = current.parentElement;
			depth++;
		}
		return null;
	}

	private updateLayout() {
		if (!this.isPluginActive) return;
		if (this.layoutTimeout) window.clearTimeout(this.layoutTimeout);
		this.layoutTimeout = window.setTimeout(() => {
			if (!this.isPluginActive) return;
			(this.app.workspace as any).requestLayoutUpdate?.();
			this.layoutTimeout = null;
		}, 50);
	}

	async loadSettings() {
		const saved = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SidebarExpandSettingTab extends PluginSettingTab {
	plugin: SidebarExpandPlugin;

	constructor(app: App, plugin: SidebarExpandPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Sidebar Vertically Expand on Hover Settings' });

		new Setting(containerEl)
			.setName('Expansion Amount')
			.setDesc('Total expansion as % of sidebar height. Half taken from above, half from below. (default: 18)')
			.addSlider(slider => slider
				.setLimits(4, 50, 2)
				.setValue(this.plugin.settings.expansionAmount)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.expansionAmount = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Transition Duration')
			.setDesc('Animation speed in ms (default: 300).')
			.addText(text => text
				.setPlaceholder('300')
				.setValue(this.plugin.settings.transitionDuration.toString())
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num)) {
						this.plugin.settings.transitionDuration = num;
						document.documentElement.style.setProperty('--sidebar-expand-transition-duration', `${num}ms`);
						await this.plugin.saveSettings();
					}
				}));
	}
}
