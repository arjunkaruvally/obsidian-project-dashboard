# Obsidian Vault Dashboard - Desktop App

This is an ongoing experiment in Vibe Coding...

A beautiful, lightweight desktop application for visualizing tasks and experiments from your Obsidian vault with automatic file watching and live updates. Built with **Tauri** for maximum performance and minimal resource usage.

## ✨ Features

### Dashboard Visualizations
- 📊 **Interactive Charts** - Task completion trends, project progress, and activity heatmaps
- 📅 **Calendar View** - Visualize deadlines and milestones with FullCalendar integration
- 📋 **Project Overview** - Track experiments, tasks, and completion rates across all projects
- ⏰ **Overdue Tasks** - Automatically highlights tasks past their deadline
- 🎯 **Priority Sorting** - Projects ordered by priority (Urgent → High → Medium → Low)

### Kanban Board
- 🎨 **Drag-and-Drop** - Intuitive task management with native HTML5 drag-and-drop
- 📂 **Project Filtering** - Filter tasks by specific projects
- 🔄 **Live Sync** - Changes to your vault automatically update the board

### Desktop Features
- 🔄 **Auto-Refresh** - Watches your vault for changes and updates in real-time (500ms debounce)
- 💾 **Persistent Vault** - Remembers your last opened vault across sessions
- 📁 **Native Dialogs** - OS-native folder picker (no browser limitations)
- ⚡ **Lightweight** - ~5-10MB bundle size (vs ~100-200MB for Electron)
- 🚀 **Fast Startup** - Launches in under 1 second
- 💻 **Low Memory** - Uses ~40-60MB RAM (vs ~150-200MB for Electron)

## 🚀 Quick Start

### Prerequisites
- **Rust** - Required for building Tauri apps
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```
- **Node.js** - For npm dependencies

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/arjunkaruvally/obsidian-project-dashboard.git
   cd obsidian-project-dashboard
   git checkout tauri  # Use the Tauri branch
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run in development mode**
   ```bash
   npm run dev
   ```

4. **Build for production**
   ```bash
   npm run build
   ```
   
   Installers will be created in `src-tauri/target/release/bundle/`:
   - **macOS**: `.dmg` and `.app`
   - **Windows**: `.exe` and `.msi`
   - **Linux**: `.AppImage` and `.deb`

## 📖 Usage

### First Launch

1. **Open the app** - Launch the Obsidian Vault Dashboard
2. **Select your vault** - Click the folder icon (📁) in the top-right corner
3. **Choose your Obsidian vault folder** - Navigate to your vault's root directory
4. **View your dashboard** - The app will automatically parse and visualize your data

### Vault Structure

Your Obsidian vault should follow this structure:

```
vault-root/
├── project-alpha/
│   ├── project-alpha.md          # Project file with frontmatter
│   └── experiments/
│       ├── experiment-001.md     # Experiment with tasks
│       └── experiment-002.md
├── project-beta/
│   ├── project-beta.md
│   └── experiments/
│       └── experiment-001.md
└── ...
```

### Project File Format

Each project should have a markdown file with YAML frontmatter:

```markdown
---
type: project
priority: high
deadline: 2024-12-31
status: active
---

# Project Alpha

Project description here...
```

**Supported frontmatter fields:**
- `type: project` - Identifies this as a project file
- `priority` - `urgent`, `high`, `medium`, or `low`
- `deadline` - ISO date format (YYYY-MM-DD)
- `status` - Any status you want to track

### Experiment File Format

Experiments contain tasks in markdown checkbox format:

```markdown
---
type: experiment
status: in-progress
---

# Experiment 001: Data Analysis

## Tasks

- [x] Collect data @done(2024-01-15)
- [x] Clean dataset @done(2024-01-16)
- [ ] Run analysis @due(2024-01-20)
- [ ] Write report @due(2024-01-25)
```

**Task annotations:**
- `@done(YYYY-MM-DD)` - Marks completion date (for activity tracking)
- `@due(YYYY-MM-DD)` - Sets deadline (for overdue detection)

### Live Updates

The app automatically watches your vault for changes:
- ✅ Adding new experiments
- ✅ Updating task status
- ✅ Modifying project metadata
- ✅ Changing deadlines

Changes are detected and the dashboard refreshes automatically (with 500ms debounce to prevent excessive updates).

## 🏗️ Architecture

### Technology Stack

**Frontend:**
- HTML5 + Vanilla JavaScript
- CSS3 with custom properties
- Chart.js for visualizations
- FullCalendar for calendar view
- js-yaml for frontmatter parsing

**Backend (Tauri):**
- Rust for native performance
- Tauri v1.5 framework
- Notify crate for file watching
- Native OS dialogs

### Why Tauri?

Tauri was chosen over Electron for several key advantages:

| Metric | Electron | Tauri | Improvement |
|--------|----------|-------|-------------|
| **Bundle Size** | ~100-200 MB | ~5-10 MB | **90-95% smaller** |
| **Memory Usage** | ~150-200 MB | ~40-60 MB | **70% less** |
| **Startup Time** | 2-3 seconds | <1 second | **2-3x faster** |
| **Dependencies** | 363 packages | 2 packages | **99% fewer** |

**Technical Benefits:**
- Uses system webview instead of bundling Chromium
- Rust backend for native performance and memory safety
- Smaller installers (10-20x smaller than Electron)
- Better security through Tauri's permission system

## 🛠️ Development

### Project Structure

```
obsidian-project-dashboard/
├── src-tauri/              # Tauri backend (Rust)
│   ├── src/
│   │   └── main.rs         # Main Rust application
│   ├── Cargo.toml          # Rust dependencies
│   ├── tauri.conf.json     # Tauri configuration
│   └── build.rs            # Build script
├── index.html              # Dashboard page
├── kanban.html             # Kanban board page
├── app.js                  # Dashboard logic
├── kanban.js               # Kanban logic
├── style.css               # Dashboard styles
├── kanban.css              # Kanban styles
├── tauri-init.js           # Tauri initialization
└── package.json            # Node dependencies
```

### Key Files

**`src-tauri/src/main.rs`** - Rust backend with:
- `select_vault()` - Native folder picker
- `read_vault_dir()` - Recursive directory reading
- `get_stored_vault_path()` - Vault path persistence
- File watcher with debouncing

**`app.js`** - Frontend logic:
- `VaultAnalyzer` class for data processing
- Tauri IPC integration
- Chart and calendar rendering
- Auto-refresh on file changes

**`tauri.conf.json`** - Configuration:
- Window settings (1400x900)
- Permission allowlist
- Build settings

### Development Workflow

1. **Make changes** to HTML/CSS/JS or Rust code
2. **Tauri watches** for file changes automatically
3. **Hot reload** - Frontend changes reload instantly
4. **Rust recompile** - Backend changes trigger rebuild (~2-5 seconds)

### Adding Features

**Frontend changes:**
- Edit `app.js`, `index.html`, or `style.css`
- Changes apply immediately (no restart needed)

**Backend changes:**
- Edit `src-tauri/src/main.rs`
- Add new Tauri commands with `#[tauri::command]`
- Update `invoke_handler` in `main()`
- Add permissions to `tauri.conf.json` allowlist

## 🔧 Configuration

### Tauri Permissions

The app requires these permissions (configured in `tauri.conf.json`):

```json
{
  "allowlist": {
    "dialog": {
      "all": true  // For folder picker and messages
    },
    "fs": {
      "readDir": true,  // For reading vault contents
      "scope": ["**"]   // Access to all files
    }
  }
}
```

### File Watching

File watching is configured with:
- **Recursive monitoring** of entire vault
- **500ms debounce** to prevent excessive reloads
- **Filters** for `.md` files only
- **Ignores** hidden files (starting with `.`)

## 📦 Building & Distribution

### Development Build
```bash
npm run dev
```
- Unoptimized build for faster compilation
- Includes debug symbols
- Hot reload enabled

### Production Build
```bash
npm run build
```
- Optimized Rust binary
- Minified assets
- Platform-specific installers

### Build Artifacts

**macOS:**
- `obsidian-vault-dashboard.app` - Application bundle
- `obsidian-vault-dashboard.dmg` - Disk image installer

**Windows:**
- `obsidian-vault-dashboard.exe` - Portable executable
- `obsidian-vault-dashboard.msi` - Windows installer

**Linux:**
- `obsidian-vault-dashboard.AppImage` - Portable app
- `obsidian-vault-dashboard.deb` - Debian package

## 🐛 Troubleshooting

### App won't start
- Ensure Rust is installed: `rustc --version`
- Check Node.js version: `node --version` (v14+ required)
- Try cleaning build: `rm -rf src-tauri/target && npm run dev`

### Folder picker crashes
- Check `tauri.conf.json` has `dialog.all: true`
- Verify Cargo.toml includes `dialog-all` feature

### Files not updating
- Check file watcher is running (console logs)
- Ensure vault path is correct
- Try manually reloading (click folder icon again)

### Build fails
- Update Rust: `rustup update`
- Clear cargo cache: `cargo clean`
- Check for missing system dependencies (Xcode CLI tools on macOS)

## 🤝 Contributing

This is an experimental project exploring "Vibe Coding" - rapid prototyping with AI assistance.

### Development Setup
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

### Code Style
- **Frontend**: Standard JavaScript, semantic HTML
- **Backend**: Rust with `rustfmt` formatting
- **Commits**: Descriptive messages

## 📝 License

MIT License - See LICENSE file for details

## 🙏 Acknowledgments

- **Tauri** - For the amazing desktop framework
- **Chart.js** - For beautiful visualizations
- **FullCalendar** - For calendar functionality
- **Obsidian** - For the inspiration and vault structure

## 📚 Resources

- [Tauri Documentation](https://tauri.app/)
- [Obsidian](https://obsidian.md/)
- [Chart.js](https://www.chartjs.org/)
- [FullCalendar](https://fullcalendar.io/)

---

**Built with ❤️ using Tauri for maximum performance and minimal resource usage**
