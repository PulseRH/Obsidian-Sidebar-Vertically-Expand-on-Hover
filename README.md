# Obsidian Sidebar Vertically Expand on Hover (Plugin)

An Obsidian plugin that expands individual sidebar workspace tab containers (like File Explorer, Outline, etc.) vertically when you hover your mouse over each specific container. The resize handles automatically move to accommodate the expansion.

![vertical expand on hover](https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExNmwzaTh3eXVtOHk5YWQwNHFmYWFxeHg3M2d3MmM0YWhmY3Q1bjZkcyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/tXEd5QMz5zqtBc1Boh/giphy.gif)


## Installation

### Method 1: Using BRAT (Beta Reviewers Auto-update Tool)

1. Install the BRAT plugin from Community Plugins
2. Add this repository to BRAT
3. Enable the plugin in Community Plugins

### Method 2: Manual Installation
1.download release zip file
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


### Customizing Settings

transition duration: 300ms default
expansion percentage: 40% default

## Compatibility

- Obsidian v0.15.0 and later
- Works with all themes
- Supports both left and right sidebars
- Works with all sidebar pane types (File Explorer, Outline, etc.)

## Technical Details

- Uses Obsidian's Workspace API to detect and manipulate leaves
- Monitors DOM changes to catch new leaves as they're added
- Directly manipulates container heights via CSS
- Attempts to update resize handle positions using Obsidian's layout system

## Known Limitations

- Evenly spaces all panes when unhovered curently doesnt retain custom sizing


