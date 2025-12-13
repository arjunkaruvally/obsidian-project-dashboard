# Obsidian Vault Dashboard - Desktop App

A beautiful desktop application for visualizing tasks and experiments from your Obsidian vault with automatic file watching and live updates.

## Features

- 📊 **Interactive Visualizations**: Charts for task completion, experiment status, deadlines, and project metrics
- 📅 **Calendar View**: Visual timeline of task deadlines and project milestones
- 📋 **Kanban Board**: Drag-and-drop task management with project filtering
- 🔄 **Auto-Refresh**: Automatically updates when vault files change
- 💾 **Persistent State**: Remembers your last opened vault
- 🎨 **Premium Design**: Dark mode with glassmorphism effects

## Installation

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn

### Setup

1. Install dependencies:
```bash
npm install
```

2. Run the app in development mode:
```bash
npm start
```

3. Build for production:
```bash
# Build for your current platform
npm run build

# Or build for specific platforms
npm run build:mac    # macOS
npm run build:win    # Windows
npm run build:linux  # Linux
```

The built application will be in the `dist/` directory.

## Usage

1. **Launch the app** - Run `npm start` or open the built application
2. **Select your vault** - Click "Choose Folder" or use File > Open Vault (Cmd/Ctrl+O)
3. **View your data** - Dashboard automatically loads and displays your projects
4. **Auto-updates** - Any changes to vault files will automatically refresh the dashboard
5. **Switch views** - Navigate between Dashboard and Kanban Board using the navigation bar

## Vault Structure

Your Obsidian vault should follow this structure:

```
vault/
├── project-alpha/
│   ├── project-alpha.md          # Project metadata
│   └── experiments/
│       ├── experiment-001.md
│       └── experiment-002.md
├── project-beta/
│   ├── project-beta.md
│   └── experiments/
│       └── nlp-sentiment.md
└── ...
```

### Project Files

Project markdown files should include frontmatter:

```markdown
---
type: project
status: active
priority: high
milestone: Q1 2026 Release
milestone_date: 2026-03-31
clients: [Research Lab, University]
---

# Project Name
Project description...
```

### Experiment Files

Experiment files should include tasks with optional deadlines and done dates:

```markdown
---
status: in-progress
priority: high
---

# Experiment Name

## Tasks
- [x] Setup baseline @due(2025-11-20) @done(2025-11-19)
- [ ] Run experiments @due(2025-12-15)
- [ ] Analyze results @due(2025-12-20)
```

## Task Syntax

- **Deadlines**: `@due(YYYY-MM-DD)` or `@deadline(YYYY-MM-DD)`
- **Completion**: `@done(YYYY-MM-DD)`
- **Status**: `[x]` for completed, `[ ]` for pending

## Development

### Project Structure

- `main.js` - Electron main process (window management, file watching)
- `preload.js` - Secure IPC bridge
- `app.js` - Dashboard logic and visualizations
- `kanban.js` - Kanban board functionality
- `index.html` - Dashboard page
- `kanban.html` - Kanban board page
- `style.css` / `kanban.css` - Styling

### Technologies

- **Electron** - Desktop app framework
- **Chokidar** - File system watcher
- **Chart.js** - Data visualizations
- **FullCalendar** - Calendar view
- **js-yaml** - YAML frontmatter parsing

## License

MIT

## Author

Arjun Karuvally
