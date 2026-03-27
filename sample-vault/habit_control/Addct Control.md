---
type: control
status: active
priority: medium
milestone: Check in
milestone date: 2026-04-15
started: 2026-03-25
tags: research
clients:
---

# Addct Control

**Goal:**  
One- or two-sentence statement of the purpose of the project.

## Next Milestone
`= this.milestone`

## Completed Milestones

- 


**Summary:**  
A short overview of progress, key challenges, etc.

---

# Active Experiments

```dataview
TABLE hypothesis, config
FROM "Research/Projects/SC1 - Addct"
WHERE file.name != this.file.name AND type = "experiment" AND status = "active"
SORT status ASC
```

# All Experiments

```dataview
TABLE hypothesis
FROM "Research/Projects/SC1 - Addct"
WHERE file.name != this.file.name AND type = "experiment"
SORT status ASC
```

## Completed Tasks

```dataview
TABLE result
FROM "Research/Projects/SC1 - Addct"
WHERE file.name != this.file.name AND type = "task" AND status = "done"
SORT status ASC
```

