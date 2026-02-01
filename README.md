# Obsidian Sidebar Expand on Hover (Plugin)

An Obsidian plugin that expands individual sidebar workspace tab containers (like File Explorer, Outline, etc.) vertically when you hover your mouse over each specific container. The resize handles automatically move to accommodate the expansion.

## Features

- Smooth vertical expansion animation on hover
- Expands only the individual tab container you're hovering over (not all containers)
- Automatically moves resize handles to accommodate expansion
- Works independently for each tab container in both left and right sidebars
- Configurable expansion height (minimum and maximum)
- Non-intrusive - maintains all sidebar functionality
- Respects screen boundaries (can't expand beyond viewport)

## Installation

### Method 1: Using BRAT (Beta Reviewers Auto-update Tool)

1. Install the BRAT plugin from Community Plugins
2. Add this repository to BRAT
3. Enable the plugin in Community Plugins

### Method 2: Manual Installation
1.dowwnlaod release zip file
2.drop it in your .Obsidian/plugins folder easly accessed by navigating obsidian settings comunity plugins and clicking the open compunity plugins folder icon button on the right
3. Enable the plugin in Community Plugins


### Method 3: Build your own(Development)

1. **Clone or download this repository**
   ```bash
   git clone <repository-url>
   cd obsidian-sidebar-expand-on-hover
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the plugin**
   ```bash
   npm run build
   ```

4. **Copy to your vault**
   - Copy the following files to your vault's `.obsidian/plugins/sidebar-expand-on-hover/` folder:
     - `main.js`
     - `manifest.json`
     - `styles.css` (if present)

5. **Enable the plugin**
   - Open Obsidian Settings
   - Go to **Community plugins**
   - Find **Sidebar Expand on Hover** and toggle it on



## Development

To develop this plugin:

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run dev` to start compilation in watch mode
4. Make changes to `main.ts`
5. Reload the plugin in Obsidian (or restart Obsidian)

## Configuration

The plugin uses default settings that can be customized. Currently, settings are defined in the code but can be extended with a settings tab in the future.

### Default Settings

- **Minimum Expanded Height**: `600px` - The minimum height a container will expand to
- **Maximum Expanded Height**: `80%` of viewport height - The maximum height, respecting screen boundaries
- **Transition Duration**: `300ms` - Animation speed for expansion/contraction

### Customizing Settings

To customize these values, edit `main.ts` and modify the `DEFAULT_SETTINGS` object:

```typescript
const DEFAULT_SETTINGS: SidebarExpandSettings = {
	minExpandedHeight: 600,        // Change this value
	maxExpandedHeight: 80,         // Percentage of viewport height
	transitionDuration: 300       // Milliseconds
}
```

Then rebuild the plugin with `npm run build`.

## Troubleshooting

- **Plugin not working?**
  - Make sure the plugin is enabled in Community Plugins
  - Check the console for errors (Ctrl+Shift+I or Cmd+Option+I)
  - Try reloading the plugin or restarting Obsidian
  - Ensure you have the latest version of Obsidian (v0.15.0+)

- **Expansion not happening?**
  - Make sure you're hovering over the actual container area, not just the header
  - Check that the container is in a sidebar (left or right)
  - Try hovering over different containers (File Explorer, Outline, etc.)

- **Resize handles not moving?**
  - The plugin attempts to update resize handle positions automatically
  - If handles don't move, try hovering again or reloading the plugin
  - This is a known limitation and may require Obsidian API updates

- **Expansion too large/small?**
  - Adjust the settings in `main.ts` (see Configuration section)
  - Rebuild the plugin after making changes

## Compatibility

- Obsidian v0.15.0 and later
- Works with all themes
- Supports both left and right sidebars
- Works with all sidebar pane types (File Explorer, Outline, etc.)

## How It Works

1. The plugin detects when you hover over a workspace leaf container in the sidebars
2. It expands the container vertically to a configurable height
3. Resize handles are automatically repositioned to accommodate the expansion
4. When you move your mouse away, the container returns to its original size
5. Only the container you're hovering over expands, not all containers

## Technical Details

- Uses Obsidian's Workspace API to detect and manipulate leaves
- Monitors DOM changes to catch new leaves as they're added
- Directly manipulates container heights via CSS
- Attempts to update resize handle positions using Obsidian's layout system

## Known Limitations

- Resize handle movement depends on Obsidian's internal layout system
- Some edge cases with dynamically added/removed leaves may require plugin reload
- Maximum expansion is constrained by viewport height to prevent overflow

## License

Free to use and modify as needed.

