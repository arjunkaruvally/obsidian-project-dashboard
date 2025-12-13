# Sample Vault Structure

This folder demonstrates the expected structure for the Obsidian Vault Dashboard.

## Structure

```
sample-vault/
├── project-alpha/
│   ├── experiments/          ← Only this folder is parsed
│   │   ├── experiment-001.md
│   │   └── experiment-002.md
│   └── notes/                ← Ignored
├── project-beta/
│   ├── experiments/          ← Only this folder is parsed
│   │   ├── nlp-sentiment.md
│   │   └── text-generation.md
│   └── docs/                 ← Ignored
└── project-gamma/
    └── experiments/          ← Only this folder is parsed
        ├── rl-game-ai.md
        └── data-viz.md
```

## Task Deadline Format

Tasks can include deadlines using the `@due(YYYY-MM-DD)` syntax:

```markdown
- [ ] Task description @due(2025-12-15)
- [x] Completed task @due(2025-12-01)
```

The dashboard will:
- Extract the deadline
- Calculate urgency (overdue, urgent, soon, normal)
- Display in deadline timeline chart
- Show overdue tasks in backlog view
- Render on calendar view

## Experiment Properties

Each experiment file should have frontmatter with properties:

```yaml
---
status: in-progress
priority: high
start_date: 2025-11-15
tags: [machine-learning, neural-networks]
---
```

The `status` property is used for the status distribution chart.
