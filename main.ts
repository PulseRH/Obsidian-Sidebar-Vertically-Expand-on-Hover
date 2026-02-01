import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface SidebarExpandSettings {
	expandPercentage: number;
	transitionDuration: number;
}

const DEFAULT_SETTINGS: SidebarExpandSettings = {
	expandPercentage: 40,
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

	async onload() {
		this.isPluginActive = true;
		try {
			await this.loadSettings();
			this.addSettingTab(new SidebarExpandSettingTab(this.app, this));

			const initializePlugin = () => {
				if (!this.isPluginActive) return;
				try {
					document.documentElement.style.setProperty('--sidebar-expand-transition-duration', `${this.settings.transitionDuration}ms`);
					
					// Only lock elements in sidebars
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
		const modifiedElements = document.querySelectorAll('.sidebar-expand-hovered, [data-hover-listener-added="true"], .sidebar-expand-shrunk, .sidebar-expand-split-parent');
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
				// First, store original flex values for Notebook Navigator panes BEFORE adding listeners
				// Also force them to 50/50 if they're not already
				const nnPanes = container.querySelectorAll('.nn-navigation-pane, .nn-list-pane');
				nnPanes.forEach((pane: HTMLElement) => {
					if (!(pane as any)._originalFlexGrow) {
						const computedStyle = window.getComputedStyle(pane);
						(pane as any)._originalFlexGrow = computedStyle.flexGrow || '1';
						(pane as any)._originalFlexShrink = computedStyle.flexShrink || '1';
						(pane as any)._originalFlexBasis = computedStyle.flexBasis || 'auto';
					}
					// Force 50/50 split for Notebook Navigator panes on initialization
					// Only if not currently being hovered (no sidebar-expand classes)
					if (!pane.classList.contains('sidebar-expand-hovered') && !pane.classList.contains('sidebar-expand-shrunk')) {
						pane.style.setProperty('flex-grow', '1', 'important');
						pane.style.setProperty('flex-shrink', '1', 'important');
						pane.style.setProperty('flex-basis', '0', 'important');
					}
				});
				
				const leaves = container.querySelectorAll('.workspace-leaf, .nn-navigation-pane, .nn-list-pane');
				leaves.forEach((leaf: HTMLElement) => {
					if (this.isExcludedElement(leaf)) return;
					
					// Use a unique ID for this plugin instance to prevent conflicts
					const instanceId = this.manifest.id;
					if (leaf.dataset.hoverListenerAdded === instanceId) return;
					leaf.dataset.hoverListenerAdded = instanceId;
					
					let unhoverTimeout: number | null = null;
					
					leaf.addEventListener('mouseenter', () => {
						if (!this.isPluginActive) return;
						if (unhoverTimeout) {
							window.clearTimeout(unhoverTimeout);
							unhoverTimeout = null;
						}
						this.onLeafHover(leaf);
					});
					
					leaf.addEventListener('mouseleave', () => {
						if (!this.isPluginActive) return;
						unhoverTimeout = window.setTimeout(() => {
							if (!this.isPluginActive) return;
							this.onLeafUnhover(leaf);
							unhoverTimeout = null;
						}, 50); 
					});
				});
			}
		});
	}

	private onLeafHover(leafEl: HTMLElement) {
		if (!this.isPluginActive) return;
		
		const activePane = this.getPaneFromLeaf(leafEl);
		const parentSplit = activePane?.parentElement;
		
		// Check if this is an NN pane early, before throttle check
		const isNNPane = activePane && (activePane.classList.contains('nn-navigation-pane') || activePane.classList.contains('nn-list-pane'));
		
		if (!activePane || !parentSplit) return;

		// Prevent rapid toggling and flickering
		if (this.activeHoveredLeaf === leafEl) {
			return;
		}
		
		// Check if we're switching between DIFFERENT panes in the same container
		const now = Date.now();
		let isSwitchingToDifferentPane = false;
		if (this.activeHoveredLeaf) {
			const oldActivePane = this.getPaneFromLeaf(this.activeHoveredLeaf);
			if (oldActivePane?.parentElement === parentSplit) {
				// Same container - check if different panes
				if (oldActivePane !== activePane) {
					// Switching to a different pane in the same container
					// Check if we just switched recently to prevent rapid toggling
					const timeSinceLastSwitch = now - this.lastHoverTimestamp;
					// For NN panes, use shorter cooldown (150ms) for better responsiveness
					const switchCooldown = isNNPane ? 150 : 300;
					if (timeSinceLastSwitch < switchCooldown) {
						// Too soon after last switch - ignore to prevent rapid toggling
						return;
					}
					// Allow the switch
					isSwitchingToDifferentPane = true;
				} else {
					// Same pane - ignore to prevent re-processing
					return;
				}
			}
		}
		// For NN panes, use shorter throttle (50ms) for better responsiveness; others use 150ms
		// But don't throttle if we're switching to a different parent container (different sidebar)
		const throttleDelay = isNNPane ? 50 : 150;
		const isDifferentParent = this.activeHoveredLeaf && this.getPaneFromLeaf(this.activeHoveredLeaf)?.parentElement !== parentSplit;
		if (now - this.lastHoverTimestamp < throttleDelay && !isSwitchingToDifferentPane && !isDifferentParent) {
			return;
		}
		this.lastHoverTimestamp = now;

		this.activeHoveredLeaf = leafEl;

		parentSplit.classList.add('sidebar-expand-split-parent');
		parentSplit.style.setProperty('display', 'flex', 'important');
		parentSplit.style.setProperty('flex-direction', 'column', 'important');

		const panes = Array.from(parentSplit.children).filter(el => {
			const htmlEl = el as HTMLElement;
			// Exclude vault profile and other excluded elements
			if (this.isExcludedElement(htmlEl)) return false;
			// Exclude resize handles
			if (el.classList.contains('workspace-leaf-resize-handle') || 
			    el.classList.contains('nn-resizer-handle') ||
			    el.classList.contains('nn-resize-handle')) return false;
			// Exclude empty elements (no meaningful classes or content)
			if (!el.className || el.className.trim() === '') return false;
			// Exclude elements with no visible content
			if (htmlEl.offsetHeight === 0 && htmlEl.offsetWidth === 0) {
				return false;
			}
			return true;
		}) as HTMLElement[];
		
		// Skip if only one pane (nothing to expand/shrink)
		if (panes.length <= 1) {
			// Clean up any existing classes/styles if we're skipping
			parentSplit.classList.remove('sidebar-expand-split-parent');
			parentSplit.style.removeProperty('display');
			parentSplit.style.removeProperty('flex-direction');
			return;
		}
		
		const otherCount = panes.length - 1;
		const targetRatio = this.settings.expandPercentage / 100;
		// Calculate flex to achieve targetRatio of total height for active pane
		// Formula: activeFlex / (activeFlex + otherCount) = targetRatio
		// Solving: activeFlex = (targetRatio * otherCount) / (1 - targetRatio)
		const activeFlex = otherCount > 0 ? (targetRatio * otherCount) / (1 - targetRatio) : 1;

		// Find the actual pane in the panes array that matches activePane
		// For Notebook Navigator, activePane IS the pane itself, so we should find it directly
		let actualActivePane: HTMLElement | null = null;
		
		// First, try direct match
		if (panes.indexOf(activePane) >= 0) {
			actualActivePane = activePane;
		} else {
			// For Notebook Navigator panes, they should be direct children, so try class matching
			const isNavPane = activePane.classList.contains('nn-navigation-pane');
			const isListPane = activePane.classList.contains('nn-list-pane');
			
			if (isNavPane || isListPane) {
				// Find the pane with the matching class
				actualActivePane = panes.find(p => {
					if (isNavPane) return p.classList.contains('nn-navigation-pane');
					if (isListPane) return p.classList.contains('nn-list-pane');
					return false;
				}) || null;
			} else {
				// For workspace leaves, try to find by traversing up
				let current: HTMLElement | null = activePane;
				while (current && !actualActivePane) {
					if (panes.indexOf(current) >= 0) {
						actualActivePane = current;
						break;
					}
					current = current.parentElement;
				}
			}
		}
		
		if (!actualActivePane) {
			return;
		}
		
		panes.forEach((pane, index) => {
			pane.style.setProperty('transition', `flex ${this.settings.transitionDuration}ms ease, min-height ${this.settings.transitionDuration}ms ease`, 'important');
			
			const isActivePane = pane === actualActivePane;
			const isNNPane = pane.classList.contains('nn-navigation-pane') || pane.classList.contains('nn-list-pane');
			
			if (isActivePane) {
				// For Notebook Navigator panes, use 65% expansion; for others, use settings
				const targetExpansion = isNNPane ? 0.65 : targetRatio;
				const calculatedFlex = isNNPane && otherCount === 1 
					? (targetExpansion * otherCount) / (1 - targetExpansion)  // For 2 panes: (0.65 * 1) / (1 - 0.65) = 0.65 / 0.35 = 1.857
					: activeFlex;
				
				pane.classList.add('sidebar-expand-hovered');
				pane.classList.remove('sidebar-expand-shrunk');
				pane.style.setProperty('flex-grow', `${calculatedFlex}`, 'important');
				pane.style.setProperty('flex-shrink', '1', 'important');
				pane.style.setProperty('flex-basis', isNNPane ? '0' : 'auto', 'important'); // Use 0 for NN panes to override fixed pixel values
				pane.style.setProperty('min-height', '0', 'important');
			} else {
				pane.classList.add('sidebar-expand-shrunk');
				pane.classList.remove('sidebar-expand-hovered');
				
				const height = (pane as any)._originalHeight || pane.offsetHeight;
				if (!(pane as any)._originalHeight && height > 0) (pane as any)._originalHeight = height;
				
				const minH = height > 0 ? Math.max(height * 0.2, 60) : 60;
				
				pane.style.setProperty('flex-grow', '1', 'important');
				pane.style.setProperty('flex-shrink', '1', 'important');
				pane.style.setProperty('flex-basis', isNNPane ? '0' : 'auto', 'important'); // Use 0 for NN panes to override fixed pixel values
				pane.style.setProperty('min-height', `${minH}px`, 'important');
			}
		});

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
				
				if (isStillInSplit && this.activeHoveredLeaf !== leafEl) {
					// Mouse moved to another pane in the same sidebar - don't reset
					return;
				}

				// If we are here, either the mouse left the sidebar OR it stayed on the same leaf (which shouldn't happen on mouseleave)
				this.activeHoveredLeaf = null;
				parentSplit.classList.remove('sidebar-expand-split-parent');
				const children = Array.from(parentSplit.children) as HTMLElement[];
				children.forEach(el => {
					if (this.isExcludedElement(el as HTMLElement)) return;
					const htmlEl = el as HTMLElement;
					const isNNPane = htmlEl.classList.contains('nn-navigation-pane') || htmlEl.classList.contains('nn-list-pane');
					
					htmlEl.classList.remove('sidebar-expand-hovered');
					htmlEl.classList.remove('sidebar-expand-shrunk');
					
					// For Notebook Navigator panes, restore to true 50/50 (flex-grow: 1 for both, flex-basis: 0 to override fixed pixel values)
					if (isNNPane) {
						htmlEl.style.setProperty('flex-grow', '1', 'important');
						htmlEl.style.setProperty('flex-shrink', '1', 'important');
						htmlEl.style.setProperty('flex-basis', '0', 'important'); // Use 0 instead of auto to override fixed pixel values from Notebook Navigator
						htmlEl.style.removeProperty('min-height');
					} else {
						// For other panes, remove all flex properties
						htmlEl.style.removeProperty('flex');
						htmlEl.style.removeProperty('flex-grow');
						htmlEl.style.removeProperty('flex-shrink');
						htmlEl.style.removeProperty('flex-basis');
						htmlEl.style.removeProperty('min-height');
					}
					delete (htmlEl as any)._originalHeight;
				});
				this.updateLayout();
			}, 30);
		}
	}

	private getPaneFromLeaf(leafEl: HTMLElement): HTMLElement | null {
		// For Notebook Navigator panes, if the leafEl itself is a pane, return it directly
		if (leafEl.classList.contains('nn-navigation-pane') || leafEl.classList.contains('nn-list-pane')) {
			return leafEl;
		}
		
		let current: HTMLElement | null = leafEl;
		let depth = 0;
		while (current && current.parentElement && depth < 20) {
			const parent = current.parentElement;
			// Check if current is a pane
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
		// If saved settings have old expandPercentage (< 30), update to new default (40)
		if (saved && saved.expandPercentage && saved.expandPercentage < 30) {
			saved.expandPercentage = 40;
			await this.saveData(saved);
		}
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
			.setName('Expand Percentage')
			.setDesc('Target size for hovered pane (default: 40%).')
			.addSlider(slider => slider
				.setLimits(10, 90, 5)
				.setValue(this.plugin.settings.expandPercentage)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.expandPercentage = value;
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
