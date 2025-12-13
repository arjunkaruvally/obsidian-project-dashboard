// Kanban Board - Task Management View

class VaultAnalyzer {
    constructor() {
        this.projects = [];
        this.experiments = [];
        this.tasks = [];
        this.currentFilter = 'all'; // Track current project filter
    }

    async loadVault() {
        try {
            // Reset data
            this.projects = [];
            this.experiments = [];
            this.tasks = [];

            // Use File System Access API to read directory
            const dirHandle = await window.showDirectoryPicker();
            await this.processVaultRoot(dirHandle);
            this.renderKanban();

            // Save to localStorage
            this.saveToLocalStorage();

            // Populate project filter
            this.populateProjectFilter();
        } catch (error) {
            if (error.name !== 'AbortError') {
                this.showError('Error loading vault: ' + error.message);
            }
        }
    }

    saveToLocalStorage() {
        const data = {
            projects: this.projects,
            experiments: this.experiments,
            tasks: this.tasks,
            timestamp: new Date().toISOString()
        };
        localStorage.setItem('obsidianVaultData', JSON.stringify(data));
    }

    loadFromLocalStorage() {
        const stored = localStorage.getItem('obsidianVaultData');
        if (stored) {
            const data = JSON.parse(stored);
            this.projects = data.projects || [];
            this.experiments = data.experiments || [];
            this.tasks = data.tasks || [];
            return true;
        }
        return false;
    }

    async processVaultRoot(vaultHandle) {
        // Iterate through project folders in vault root
        for await (const entry of vaultHandle.values()) {
            if (entry.kind === 'directory' && !entry.name.startsWith('.')) {
                await this.processProjectFolder(entry, entry.name);
            }
        }
    }

    async processProjectFolder(projectHandle, projectName) {
        const project = {
            name: projectName,
            experiments: [],
            totalTasks: 0,
            completedTasks: 0
        };

        // Look for 'experiments' subfolder
        let experimentsFolder = null;
        for await (const entry of projectHandle.values()) {
            if (entry.kind === 'directory' && entry.name === 'experiments') {
                experimentsFolder = entry;
                break;
            }
        }

        if (!experimentsFolder) {
            return; // No experiments folder, skip this project
        }

        // Process all markdown files in experiments folder
        for await (const entry of experimentsFolder.values()) {
            if (entry.kind === 'file' && entry.name.endsWith('.md')) {
                const file = await entry.getFile();
                const content = await file.text();
                const experiment = this.parseMarkdownFile(content, entry.name, projectName);

                if (experiment) {
                    project.experiments.push(experiment);
                    this.experiments.push(experiment);
                    project.totalTasks += experiment.tasks.length;
                    project.completedTasks += experiment.tasks.filter(t => t.completed).length;
                }
            }
        }

        if (project.experiments.length > 0) {
            this.projects.push(project);
        }
    }

    parseMarkdownFile(content, filename, projectName) {
        const experiment = {
            name: filename.replace('.md', ''),
            project: projectName,
            properties: {},
            tasks: [],
            content: content
        };

        // Parse frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
            try {
                experiment.properties = jsyaml.load(frontmatterMatch[1]) || {};
            } catch (e) {
                console.warn('Failed to parse frontmatter for', filename, e);
            }
        }

        // Parse tasks (markdown checkboxes) with deadline support
        const taskRegex = /^[\s]*[-*]\s+\[([ xX])\]\s+(.+)$/gm;
        let match;

        while ((match = taskRegex.exec(content)) !== null) {
            const taskText = match[2].trim();
            const task = {
                completed: match[1].toLowerCase() === 'x',
                text: taskText,
                experiment: experiment.name,
                experimentStatus: experiment.properties.status || 'unknown',
                project: projectName,
                deadline: null,
                daysUntilDeadline: null,
                urgency: 'none'
            };

            // Extract deadline from inline syntax
            const inlineDeadlineMatch = taskText.match(/@(?:due|deadline)\((\d{4}-\d{2}-\d{2})\)/);
            if (inlineDeadlineMatch) {
                task.deadline = inlineDeadlineMatch[1];
                task.text = taskText.replace(/@(?:due|deadline)\([^)]+\)/, '').trim();
            }

            // Calculate days until deadline and urgency
            if (task.deadline) {
                const deadlineDate = new Date(task.deadline);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                deadlineDate.setHours(0, 0, 0, 0);

                const diffTime = deadlineDate - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                task.daysUntilDeadline = diffDays;

                if (diffDays < 0) {
                    task.urgency = 'overdue';
                } else if (diffDays <= 3) {
                    task.urgency = 'urgent';
                } else if (diffDays <= 7) {
                    task.urgency = 'soon';
                } else {
                    task.urgency = 'normal';
                }
            }

            experiment.tasks.push(task);
            this.tasks.push(task);
        }

        return experiment;
    }

    populateProjectFilter() {
        const filterSelect = document.getElementById('projectFilter');
        if (!filterSelect) return;

        // Clear existing options except "All Projects"
        filterSelect.innerHTML = '<option value="all">All Projects</option>';

        // Add project options
        this.projects.forEach(project => {
            const option = document.createElement('option');
            option.value = project.name;
            option.textContent = project.name;
            filterSelect.appendChild(option);
        });

        // Set current filter
        filterSelect.value = this.currentFilter;
    }

    filterByProject(projectName) {
        this.currentFilter = projectName;
        this.renderKanban();
    }

    getFilteredTasks() {
        if (this.currentFilter === 'all') {
            return this.tasks;
        }
        return this.tasks.filter(t => t.project === this.currentFilter);
    }

    renderKanban() {
        // Show kanban board
        document.getElementById('kanbanBoard').classList.remove('hidden');

        // Get filtered tasks
        const filteredTasks = this.getFilteredTasks();

        // Categorize tasks
        const todoTasks = filteredTasks.filter(t => !t.completed && t.experimentStatus !== 'in-progress');
        const inProgressTasks = filteredTasks.filter(t => !t.completed && t.experimentStatus === 'in-progress');
        const doneTasks = filteredTasks.filter(t => t.completed);

        // Render columns
        this.renderColumn('todoColumn', todoTasks, 'todoCount');
        this.renderColumn('inProgressColumn', inProgressTasks, 'inProgressCount');
        this.renderColumn('doneColumn', doneTasks, 'doneCount');

        // Setup drag and drop
        this.setupDragAndDrop();
    }

    renderColumn(columnId, tasks, countId) {
        const column = document.getElementById(columnId);
        const count = document.getElementById(countId);

        column.innerHTML = '';
        count.textContent = tasks.length;

        if (tasks.length === 0) {
            column.innerHTML = `
                <div class="column-empty">
                    <div class="column-empty-icon">📭</div>
                    <div class="column-empty-text">No tasks here</div>
                </div>
            `;
            return;
        }

        tasks.forEach((task, index) => {
            const card = this.createTaskCard(task, index);
            column.appendChild(card);
        });
    }

    createTaskCard(task, index) {
        const card = document.createElement('div');
        card.className = 'task-card';
        card.draggable = true;
        card.dataset.taskIndex = index;
        card.dataset.taskId = `${task.project}-${task.experiment}-${task.text}`;

        let deadlineHTML = '';
        if (task.deadline) {
            const daysText = task.daysUntilDeadline < 0
                ? `${Math.abs(task.daysUntilDeadline)}d overdue`
                : task.daysUntilDeadline === 0
                    ? 'Due today'
                    : task.daysUntilDeadline === 1
                        ? 'Due tomorrow'
                        : `${task.daysUntilDeadline}d left`;

            deadlineHTML = `
                <div class="task-deadline ${task.urgency}">
                    <span class="task-meta-icon">📅</span>
                    ${daysText}
                </div>
            `;
        }

        card.innerHTML = `
            <div class="task-card-header">
                <div class="task-text">${task.text}</div>
            </div>
            <div class="task-card-meta">
                <div class="task-meta-item">
                    <span class="task-meta-icon">📂</span>
                    <span class="task-project">${task.project}</span>
                </div>
                <div class="task-meta-item">
                    <span class="task-meta-icon">🧪</span>
                    <span class="task-experiment">${task.experiment}</span>
                </div>
            </div>
            ${deadlineHTML}
        `;

        return card;
    }

    setupDragAndDrop() {
        const cards = document.querySelectorAll('.task-card');
        const columns = document.querySelectorAll('.column-content');

        cards.forEach(card => {
            card.addEventListener('dragstart', (e) => {
                card.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', card.innerHTML);
            });

            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
            });
        });

        columns.forEach(column => {
            column.addEventListener('dragover', (e) => {
                e.preventDefault();
                column.classList.add('drag-over');
                e.dataTransfer.dropEffect = 'move';
            });

            column.addEventListener('dragleave', () => {
                column.classList.remove('drag-over');
            });

            column.addEventListener('drop', (e) => {
                e.preventDefault();
                column.classList.remove('drag-over');

                const draggingCard = document.querySelector('.dragging');
                if (draggingCard && column.id !== draggingCard.parentElement.id) {
                    column.appendChild(draggingCard);
                    this.updateColumnCounts();
                }
            });
        });
    }

    updateColumnCounts() {
        const todoCount = document.getElementById('todoColumn').querySelectorAll('.task-card').length;
        const inProgressCount = document.getElementById('inProgressColumn').querySelectorAll('.task-card').length;
        const doneCount = document.getElementById('doneColumn').querySelectorAll('.task-card').length;

        document.getElementById('todoCount').textContent = todoCount;
        document.getElementById('inProgressCount').textContent = inProgressCount;
        document.getElementById('doneCount').textContent = doneCount;
    }

    showError(message) {
        const errorDiv = document.getElementById('errorMessage');
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
        setTimeout(() => {
            errorDiv.classList.add('hidden');
        }, 5000);
    }
}

// Initialize application
const analyzer = new VaultAnalyzer();

// Auto-load from localStorage on page load
window.addEventListener('DOMContentLoaded', () => {
    if (analyzer.loadFromLocalStorage()) {
        analyzer.populateProjectFilter();
        analyzer.renderKanban();
        const fileInfo = document.getElementById('fileInfo');
        fileInfo.textContent = `✓ Loaded ${analyzer.tasks.length} tasks from cache`;
        fileInfo.style.color = 'var(--success)';
    }
});

document.getElementById('loadVaultBtn').addEventListener('click', async () => {
    const fileInfo = document.getElementById('fileInfo');
    fileInfo.textContent = 'Loading vault...';
    fileInfo.style.color = '';

    await analyzer.loadVault();

    if (analyzer.projects.length > 0) {
        fileInfo.textContent = `✓ Loaded ${analyzer.tasks.length} tasks from ${analyzer.projects.length} projects`;
        fileInfo.style.color = 'var(--success)';
    } else {
        fileInfo.textContent = '⚠️ No projects with experiments folder found';
    }
});

// Project filter change handler
document.getElementById('projectFilter').addEventListener('change', (e) => {
    analyzer.filterByProject(e.target.value);
});

// Check for File System Access API support
if (!('showDirectoryPicker' in window)) {
    document.getElementById('loadVaultBtn').disabled = true;
    document.getElementById('fileInfo').textContent = '⚠️ Your browser does not support folder selection. Please use Chrome, Edge, or another Chromium-based browser.';
    document.getElementById('fileInfo').style.color = 'var(--warning)';
}
