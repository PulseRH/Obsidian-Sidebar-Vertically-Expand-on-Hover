# Sidebar Vertically Expand on Hover

Expand stacked sidebar panes vertically when you hover over them. Neighbouring panes temporarily shrink, and their original sizes return when you move away. Works in the left and right sidebars of the main Obsidian window.

## Use

1. Arrange at least two tab groups vertically in a sidebar by dragging a tab into the upper or lower part of that sidebar.
2. Hover over a pane or its tab headers to give it more room.
3. Move outside the group to restore its previous size. Hover expansion pauses while you drag a resize handle.

In the plugin's settings, adjust **Expansion amount** (4–50% of the stacked panes' combined height; default 18%) and **Transition duration** (0–2000 milliseconds; default 300). Expansion is limited by the space available in neighbouring panes. The plugin respects the operating system's reduced-motion preference.


### Full-height hover

- **Hold Alt / Option** while hovering to temporarily fill 100% of the sidebar's available content height, ignoring **Expansion amount**. Releasing the key returns to percentage expansion.
- Run **Toggle full-height hover** from the command palette to switch the mode on or off. Assign your own shortcut under **Settings → Hotkeys**; the plugin does not reserve a default shortcut.
- The **Full-height hover** settings toggle does the same thing and is saved across restarts.
- Change **Full-height hold key** to Alt/Option, Control, Shift, Command/Windows, or Disabled.

Full-height mode temporarily hides neighbouring panes and their resize handles, including competing nested groups. Sidebar controls and the vault footer remain available. Move outside the expanded pane to restore the layout before hovering another pane. If the toggle is enabled, releasing the hold key keeps full-height mode enabled.

## Compatibility

- Desktop Obsidian 1.12.3 or later. Mobile touch layouts are not supported.
- Settings support the legacy interface and searchable settings in Obsidian 1.13 and later.
- Vertical Notebook Navigator panes are supported when they use its `nn-split-container` layout. Horizontal layouts are left unchanged.
- This plugin relies on Obsidian's sidebar DOM structure because there is no public pane-sizing API. Themes or plugins that replace the sidebar layout may need compatibility updates. Floating windows are not supported.
- A single pane cannot expand without a neighbouring pane to borrow space from.

## Installation

Until the plugin is accepted into the Community directory, use BRAT or install a release manually.

### BRAT

Install and enable BRAT, then add `PulseRH/Obsidian-Sidebar-Vertically-Expand-on-Hover` as a beta plugin.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/PulseRH/Obsidian-Sidebar-Vertically-Expand-on-Hover/releases/latest).
2. Create `sidebar-expand-on-hover` inside your vault's configuration folder under `plugins` (normally `.obsidian/plugins/sidebar-expand-on-hover`).
3. Put all three files directly in that folder.
4. Reload Obsidian, then enable **Sidebar Vertically Expand on Hover** under **Settings → Community plugins**.

## Privacy

The plugin works entirely offline. It makes no network requests, collects no telemetry, displays no ads, and requires no account or payment. It does not read or modify notes or access files outside the vault. Only its settings are persisted through Obsidian's plugin data API. It does not install or update itself or other software.

## Development

Use Node.js 22 or later:

```sh
npm ci
npm run check
```

`npm run dev` watches source changes. `npm run check` runs the official Obsidian ESLint rules, strict TypeScript checking, the production build, and DOM/lifecycle regression tests. The tests use a simulated workspace; verify appearance in a real Obsidian vault before distributing further changes.

Production output is readable, unminified JavaScript. Dependencies are development tools; the plugin's only runtime import is Obsidian.

## Releases

Run `npm run check`, then use `npm version patch` to update package, manifest, and compatibility versions together. Push the commit and tag, and create a GitHub release containing `main.js`, `manifest.json`, and `styles.css` as individual attachments. The release tag must match `manifest.json` exactly, without a `v` prefix.

## License

[MIT](LICENSE), copyright PulseRH. This is an independent community plugin, not an official Obsidian product.
