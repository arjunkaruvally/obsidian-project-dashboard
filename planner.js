// Planner - Calendar Planning with Time Tracking

class Planner {
    constructor() {
        this.projects = [];
        this.tasks = [];
        this.calendar = null;
        this.selectedProject = null;
        this.plannerData = {
            events: [],
            timeEntries: [],
            gcalUrl: '',
            gcalVisible: false,
            workStartHour: 10,
            workEndHour: 18,
            gcalProjectLinks: {},    // Maps gcal event ID to project name
            loggedGcalEvents: []     // Tracks gcal event IDs that have been logged as time entries
        };
        this.activeTimer = null;
        this.activeTimerInterval = null;
        this.gcalEvents = [];
        this.editEntryIndex = null;
    }

    async init() {
        // Load planner data from persistent storage (time entries, calendar events, etc.)
        await this.loadPlannerData();

        // Archive old time entries to keep main file lean
        await this.archiveOldTimeEntries();

        // Load projects/tasks: prefer Tauri vault reading, fall back to localStorage
        if (window.__TAURI__) {
            try {
                const { invoke } = window.__TAURI__.tauri;
                const { listen } = window.__TAURI__.event;

                // Try to get vault path: first from Rust state, then from localStorage
                let vaultPath = await invoke('get_stored_vault_path');
                if (!vaultPath) {
                    vaultPath = localStorage.getItem('vaultPath');
                }

                if (vaultPath) {
                    this.currentVaultPath = vaultPath;
                    localStorage.setItem('vaultPath', vaultPath); // Persist for next launch
                    await invoke('start_watching_vault', { path: vaultPath });
                    await this.loadVaultFromTauri(vaultPath);
                } else {
                    // No vault path anywhere — use cached data as last resort
                    this.loadFromLocalStorage();
                }

                // Listen for vault changes — only refreshes projects/tasks,
                // NEVER touches plannerData (time entries, calendar events, active timers)
                listen('vault-changed', () => {
                    console.log('Vault changed, reloading projects/tasks...');
                    this.reloadVaultData();
                });
            } catch (e) {
                console.warn('Failed to setup Tauri vault watching:', e);
                this.loadFromLocalStorage();
            }
        } else {
            this.loadFromLocalStorage();
        }

        // Fix any UTC-date mismatches
        this.repairTimeEntryDates();

        // Initialize UI
        this.renderProjects();
        this.initCalendar();
        this.renderTimeLog();

        // Setup modal, custom entry form, Google Calendar, and working hours
        this.setupModal();
        this.setupCustomTimeEntry();
        this.setupGoogleCalendar();
        this.setupWorkingHours();
        this.setupLogPastEvents();
        this.setupEditTimeEntry();
        this.setupTimerSearchCard();

        // Initial summary update
        this.updateSummaryStats();

        // Restore active timer if exists
        this.restoreActiveTimer();
    }

    setupCustomTimeEntry() {
        const addBtn = document.getElementById('addTimeEntryBtn');
        const form = document.getElementById('addTimeEntryForm');
        const taskInput = document.getElementById('customTaskName');
        const hoursInput = document.getElementById('customHours');
        const minutesInput = document.getElementById('customMinutes');
        const saveBtn = document.getElementById('saveCustomEntry');
        const cancelBtn = document.getElementById('cancelCustomEntry');

        // Show form
        addBtn.addEventListener('click', () => {
            form.classList.remove('hidden');
            taskInput.focus();
        });

        // Cancel
        cancelBtn.addEventListener('click', () => {
            form.classList.add('hidden');
            taskInput.value = '';
            hoursInput.value = '';
            minutesInput.value = '';
        });

        // Save custom entry
        saveBtn.addEventListener('click', () => {
            const taskText = taskInput.value.trim();
            const hours = parseInt(hoursInput.value) || 0;
            const minutes = parseInt(minutesInput.value) || 0;

            if (!taskText) {
                taskInput.focus();
                return;
            }

            if (hours === 0 && minutes === 0) {
                hoursInput.focus();
                return;
            }

            const duration = (hours * 3600) + (minutes * 60);
            const now = Date.now();

            // Create custom time entry
            this.plannerData.timeEntries.push({
                taskId: `custom-${now}`,
                taskText: taskText,
                project: 'Custom',
                startTime: now - (duration * 1000),
                endTime: now,
                duration: duration,
                date: this.getLocalDateString(new Date())
            });

            this.savePlannerData();
            this.renderTimeLog();

            // Clear and hide form
            form.classList.add('hidden');
            taskInput.value = '';
            hoursInput.value = '';
            minutesInput.value = '';
        });
    }

    restoreActiveTimer() {
        if (this.plannerData.activeTimer) {
            this.activeTimer = this.plannerData.activeTimer;
            // Restart interval — only update timer text, not full DOM
            this.activeTimerInterval = setInterval(() => {
                this.updateTimerDisplays();
            }, 1000);
        }
        // Always render the display to show recent timers even if no active timer
        this.renderActiveTimerDisplay();
    }

    setupTimerSearchCard() {
        const searchInput = document.getElementById('taskSearchInput');
        const resultsContainer = document.getElementById('taskSearchResults');

        let debounceTimer = null;

        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            const query = searchInput.value.trim().toLowerCase();

            if (query.length < 2) {
                resultsContainer.classList.add('hidden');
                return;
            }

            debounceTimer = setTimeout(() => {
                this.renderSearchResults(query);
            }, 150);
        });

        searchInput.addEventListener('focus', () => {
            const query = searchInput.value.trim().toLowerCase();
            if (query.length >= 2) {
                this.renderSearchResults(query);
            }
        });

        // Close results when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.task-search-wrapper')) {
                resultsContainer.classList.add('hidden');
            }
        });
    }

    renderSearchResults(query) {
        const resultsContainer = document.getElementById('taskSearchResults');

        // Search through all tasks (not completed)
        const matches = this.tasks
            .filter(t => !t.completed && (
                t.text.toLowerCase().includes(query) ||
                t.project.toLowerCase().includes(query) ||
                (t.experiment && t.experiment.toLowerCase().includes(query))
            ))
            .slice(0, 15); // Limit results

        if (matches.length === 0) {
            resultsContainer.innerHTML = '<div class="search-no-results">No matching tasks</div>';
            resultsContainer.classList.remove('hidden');
            return;
        }

        resultsContainer.innerHTML = '';
        matches.forEach(task => {
            const taskId = `${task.project}-${task.experiment}-${task.text.substring(0, 10).replace(/\s+/g, '')}`;
            const isActive = this.activeTimer?.taskId === taskId;

            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.innerHTML = `
                <div class="search-result-info">
                    <div class="search-result-task">${task.text}</div>
                    <div class="search-result-meta">${task.project} / ${task.experiment || ''}</div>
                </div>
                <button class="search-result-play" title="${isActive ? 'Currently running' : 'Start timer'}">
                    ${isActive ? '⏸' : '▶'}
                </button>
            `;

            div.querySelector('.search-result-play').addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleTimer(taskId, task);
                this.renderActiveTimerDisplay();
                // Clear search
                document.getElementById('taskSearchInput').value = '';
                resultsContainer.classList.add('hidden');
            });

            resultsContainer.appendChild(div);
        });

        resultsContainer.classList.remove('hidden');
    }

    renderActiveTimerDisplay() {
        const container = document.getElementById('activeTimerDisplay');

        // Get 5 most recently used unique tasks from time entries
        const recentTasks = this.getRecentTimerTasks(5);

        // If no recent tasks and no active timer, show empty state
        if (recentTasks.length === 0 && !this.activeTimer) {
            container.innerHTML = '<p class="empty-message">No recent timers</p>';
            this._activeTimerElapsedEl = null;
            return;
        }

        container.innerHTML = '';
        this._activeTimerElapsedEl = null;

        // Always move active timer to top of list
        let displayTasks = [...recentTasks];
        if (this.activeTimer) {
            // Remove active timer from wherever it is in the list
            displayTasks = displayTasks.filter(t => t.taskId !== this.activeTimer.taskId);
            // Prepend it at the top
            displayTasks.unshift({
                taskId: this.activeTimer.taskId,
                taskText: this.activeTimer.task?.text || 'Untitled Task',
                project: this.activeTimer.task?.project || '',
                task: this.activeTimer.task
            });
            displayTasks = displayTasks.slice(0, 5);
        }

        displayTasks.forEach(item => {
            const isActive = this.activeTimer?.taskId === item.taskId;
            const elapsed = isActive ? this.getActiveTimerElapsed() : 0;
            const totalTime = this.getTaskTime(item.taskId);

            const div = document.createElement('div');
            div.className = `recent-timer-item${isActive ? ' active' : ''}`;
            div.dataset.taskId = item.taskId;
            div.innerHTML = `
                <div class="active-timer-info">
                    <div class="active-timer-task" title="${item.taskText}">${item.taskText}</div>
                    <div class="active-timer-project">${item.project}</div>
                </div>
                <span class="active-timer-elapsed">${isActive ? this.formatTime(totalTime + elapsed) : this.formatTime(totalTime)}</span>
                <button class="recent-timer-btn ${isActive ? 'stop' : 'play'}" title="${isActive ? 'Stop' : 'Start'}">
                    ${isActive ? '⏹' : '▶'}
                </button>
            `;

            // Cache the elapsed element for the active timer
            if (isActive) {
                this._activeTimerElapsedEl = div.querySelector('.active-timer-elapsed');
                this._activeTimerBaseTime = totalTime;
            }

            div.querySelector('.recent-timer-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                if (isActive) {
                    // Stop active timer
                    this.stopTimer();
                    this.renderTasks();
                    this.renderTimeLog();
                } else {
                    // Start this timer (toggleTimer auto-stops any current one)
                    const task = item.task || { text: item.taskText, project: item.project };
                    this.toggleTimer(item.taskId, task);
                }
                this.renderActiveTimerDisplay();
            });

            container.appendChild(div);
        });
    }

    /**
     * Get the N most recently used unique tasks from time entries.
     */
    getRecentTimerTasks(n) {
        const seen = new Set();
        const result = [];

        // Sort time entries by most recent first
        const sorted = [...this.plannerData.timeEntries].sort((a, b) => {
            return (b.endTime || b.startTime || 0) - (a.endTime || a.startTime || 0);
        });

        for (const entry of sorted) {
            if (!entry.taskId || seen.has(entry.taskId)) continue;
            seen.add(entry.taskId);
            result.push({
                taskId: entry.taskId,
                taskText: entry.taskText || entry.task || 'Untitled Task',
                project: entry.project || '',
                task: { text: entry.taskText || entry.task || 'Untitled Task', project: entry.project || '', projectType: entry.projectType || 'project' }
            });
            if (result.length >= n) break;
        }

        return result;
    }

    /**
     * Lightweight timer text update — called every second instead of full DOM rebuilds.
     * Only updates the text content of the active timer's elements.
     */
    updateTimerDisplays() {
        if (!this.activeTimer) return;

        const elapsed = this.getActiveTimerElapsed();
        const taskId = this.activeTimer.taskId;

        // Update task list timer text (if visible in sidebar)
        const timerBtn = document.querySelector(`.timer-btn[data-task-id="${taskId}"]`);
        if (timerBtn) {
            const timeSpan = timerBtn.parentElement.querySelector('.task-time');
            if (timeSpan) {
                const baseTime = this.getTaskTime(taskId);
                timeSpan.textContent = this.formatTime(baseTime + elapsed);
            }
        }

        // Update active timer card elapsed time
        if (this._activeTimerElapsedEl) {
            this._activeTimerElapsedEl.textContent = this.formatTime((this._activeTimerBaseTime || 0) + elapsed);
        }
    }

    setupEditTimeEntry() {
        const modal = document.getElementById('editTimeModal');
        const closeBtn = document.getElementById('editTimeClose');
        const cancelBtn = document.getElementById('editTimeCancel');
        const saveBtn = document.getElementById('editTimeSave');
        const taskInput = document.getElementById('editTimeTask');
        const typeSelect = document.getElementById('editTimeType');
        const hoursInput = document.getElementById('editTimeHours');
        const minsInput = document.getElementById('editTimeMinutes');
        const secsInput = document.getElementById('editTimeSeconds');
        const startInput = document.getElementById('editTimeStart');
        const endInput = document.getElementById('editTimeEnd');
        const dateInput = document.getElementById('editTimeDate');

        const closeModal = () => {
            modal.classList.add('hidden');
            this.editEntryIndex = null;
        };

        const updateDurationFromTimes = () => {
            if (!startInput.value || !endInput.value) return;

            const [startH, startM] = startInput.value.split(':').map(Number);
            const [endH, endM] = endInput.value.split(':').map(Number);

            // Assume same day
            let start = new Date(0, 0, 0, startH, startM);
            let end = new Date(0, 0, 0, endH, endM);

            // Handle overnight (if end < start, assume next day)
            // But simple logic for now: if end < start, it might be negative, which is handled or just assume same day/error
            if (end < start) {
                // simple check, maybe don't update if invalid
                return;
            }

            const diffSeconds = (end - start) / 1000;
            const h = Math.floor(diffSeconds / 3600);
            const m = Math.floor((diffSeconds % 3600) / 60);
            const s = diffSeconds % 60;

            hoursInput.value = h;
            minsInput.value = m;
            secsInput.value = s;
        };

        const updateEndTimeFromDuration = () => {
            if (!startInput.value) return;

            const h = parseInt(hoursInput.value) || 0;
            const m = parseInt(minsInput.value) || 0;
            const s = parseInt(secsInput.value) || 0;

            const totalSeconds = (h * 3600) + (m * 60) + s;
            const [startH, startM] = startInput.value.split(':').map(Number);

            const date = new Date(0, 0, 0, startH, startM);
            date.setSeconds(date.getSeconds() + totalSeconds);

            const endH = date.getHours().toString().padStart(2, '0');
            const endM = date.getMinutes().toString().padStart(2, '0');

            endInput.value = `${endH}:${endM}`;
        };

        startInput.addEventListener('change', updateDurationFromTimes);
        endInput.addEventListener('change', updateDurationFromTimes);

        hoursInput.addEventListener('input', updateEndTimeFromDuration);
        minsInput.addEventListener('input', updateEndTimeFromDuration);
        secsInput.addEventListener('input', updateEndTimeFromDuration);

        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);

        saveBtn.addEventListener('click', () => {
            if (this.editEntryIndex === null) return;

            const taskText = taskInput.value.trim();
            if (!taskText) {
                alert('Task description is required');
                return;
            }
            const h = parseInt(hoursInput.value) || 0;
            const m = parseInt(minsInput.value) || 0;
            const s = parseInt(secsInput.value) || 0;

            const newDuration = (h * 3600) + (m * 60) + s;

            if (newDuration === 0) {
                alert('Duration cannot be zero');
                return;
            }

            // Update entry
            const entry = this.plannerData.timeEntries[this.editEntryIndex];
            if (entry) {
                entry.taskText = taskText;
                entry.projectType = typeSelect.value || 'project';

                // Handle time range changes
                let newStart, newEnd;
                let refDateStr = dateInput.value || entry.date;
                // If user cleared date, fallback to entry.date or today

                if (startInput.value && endInput.value && refDateStr) {
                    // Parse HH:MM
                    const [startH, startM] = startInput.value.split(':').map(Number);
                    const [endH, endM] = endInput.value.split(':').map(Number);

                    // Create dates based on input date
                    const parts = refDateStr.split('-');
                    const year = parseInt(parts[0]);
                    const month = parseInt(parts[1]) - 1;
                    const day = parseInt(parts[2]);

                    newStart = new Date(year, month, day, startH, startM);
                    newEnd = new Date(year, month, day, endH, endM);

                    // Simple overnight check: if end < start, maybe next day? 
                    // For now, assume user knows what they are doing with 24h time.
                    // If end < start, it results in negative duration usually caught.
                    if (newEnd < newStart) {
                        // Attempt next day? Or warn?
                        // Let's warn to be safe
                        alert('End time is before start time.');
                        return;
                    }

                    const diffMs = newEnd - newStart;
                    entry.startTime = newStart.getTime();
                    entry.endTime = newEnd.getTime();
                    entry.duration = Math.floor(diffMs / 1000);

                    // Update the text date field
                    entry.date = refDateStr;
                } else {
                    // Fallback to manual duration
                    entry.duration = newDuration;

                    // Sync endTime consistent with duration if possible
                    if (entry.startTime) {
                        entry.endTime = entry.startTime + (newDuration * 1000);
                    }
                }
            }

            this.savePlannerData();
            this.renderTimeLog();
            this.updateSummaryStats();
            // renderTasks updates the sum of time for tasks
            this.renderTasks();

            closeModal();
        });
    }

    openEditModal(index) {
        const entry = this.plannerData.timeEntries[index];
        if (!entry) return;

        this.editEntryIndex = index;
        const modal = document.getElementById('editTimeModal');
        const taskInput = document.getElementById('editTimeTask');
        const hoursInput = document.getElementById('editTimeHours');
        const minsInput = document.getElementById('editTimeMinutes');
        const secsInput = document.getElementById('editTimeSeconds');

        const startInput = document.getElementById('editTimeStart');
        const endInput = document.getElementById('editTimeEnd');
        const dateInput = document.getElementById('editTimeDate');
        const typeSelect = document.getElementById('editTimeType');

        // Populate fields
        taskInput.value = entry.taskText || entry.task || '';
        dateInput.value = entry.date || ''; // YYYY-MM-DD
        typeSelect.value = entry.projectType || 'project';

        // Populate times if available
        if (entry.startTime) {
            const startDate = new Date(entry.startTime);
            startInput.value = startDate.toTimeString().substring(0, 5); // HH:MM
        } else {
            startInput.value = '';
        }

        if (entry.endTime) {
            const endDate = new Date(entry.endTime);
            endInput.value = endDate.toTimeString().substring(0, 5); // HH:MM
        } else {
            endInput.value = '';
        }

        const duration = entry.duration || 0;
        const h = Math.floor(duration / 3600);
        const m = Math.floor((duration % 3600) / 60);
        const s = duration % 60;

        hoursInput.value = h;
        minsInput.value = m;
        secsInput.value = s;

        modal.classList.remove('hidden');
    }

    loadFromLocalStorage() {
        const stored = localStorage.getItem('obsidianVaultData');
        if (stored) {
            try {
                const data = JSON.parse(stored);
                this.projects = data.projects || [];
                this.tasks = data.tasks || [];
            } catch (e) {
                console.error('Failed to load vault data:', e);
            }
        }
    }

    // --- Vault reading from Tauri backend ---

    async loadVaultFromTauri(vaultPath) {
        const path = vaultPath || this.currentVaultPath;
        if (!path || !window.__TAURI__) return;

        const { invoke } = window.__TAURI__.tauri;
        this.projects = [];
        this.tasks = [];

        try {
            const entries = await invoke('read_vault_dir', { path });
            for (const entry of entries) {
                if (entry.type === 'directory' && !entry.name.startsWith('.')) {
                    await this.processProjectFolderTauri(entry.path, entry.name);
                }
            }
        } catch (e) {
            console.error('Failed to load vault from Tauri:', e);
        }
    }

    async processProjectFolderTauri(projectPath, projectName) {
        const project = {
            name: projectName,
            experiments: [],
            totalTasks: 0,
            completedTasks: 0,
            properties: {}
        };

        const { invoke } = window.__TAURI__.tauri;
        const entries = await invoke('read_vault_dir', { path: projectPath });

        let experimentsFolder = null;
        let projectFile = null;

        for (const entry of entries) {
            if (entry.type === 'directory' && entry.name === 'experiments') {
                experimentsFolder = entry;
            } else if (entry.type === 'file' && entry.name.endsWith('.md')) {
                projectFile = entry;
            }
        }

        // Parse project file if found
        if (projectFile) {
            const frontmatterMatch = projectFile.content.match(/^---\n([\s\S]*?)\n---/);
            if (frontmatterMatch) {
                try {
                    const properties = jsyaml.load(frontmatterMatch[1]) || {};
                    if (properties.type === 'project' || properties.type === 'control') {
                        project.properties = properties;
                    }
                } catch (e) {
                    console.warn('Failed to parse project frontmatter for', projectName, e);
                }
            }
        }

        if (!experimentsFolder) {
            this.projects.push(project);
            return;
        }

        // Process experiments folder
        const experimentEntries = await invoke('read_vault_dir', { path: experimentsFolder.path });

        for (const entry of experimentEntries) {
            if (entry.type === 'file' && entry.name.endsWith('.md')) {
                const experiment = this.parseMarkdownFile(entry.content, entry.name, projectName);
                if (experiment) {
                    project.experiments.push(experiment);
                    project.totalTasks += experiment.tasks.length;
                    project.completedTasks += experiment.tasks.filter(t => t.completed).length;
                }
            }
        }

        // Propagate projectType to all tasks in this project
        const projectType = project.properties?.type || 'project';
        project.experiments.forEach(exp => {
            exp.tasks.forEach(task => { task.projectType = projectType; });
        });

        this.projects.push(project);
    }

    parseMarkdownFile(content, filename, projectName) {
        const experiment = {
            name: filename.replace('.md', ''),
            project: projectName,
            properties: {},
            tasks: []
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

        // Parse tasks (markdown checkboxes)
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
                projectType: null, // Set after project parsing
                deadline: null,
                daysUntilDeadline: null,
                urgency: 'none',
                doneDate: null,
                startedDate: null
            };

            let cleanText = taskText;

            // Extract deadline from @due(YYYY-MM-DD) or @deadline(YYYY-MM-DD)
            const inlineDeadlineMatch = cleanText.match(/@(?:due|deadline)\((\d{4}-\d{2}-\d{2})\)/);
            if (inlineDeadlineMatch) {
                task.deadline = inlineDeadlineMatch[1];
                cleanText = cleanText.replace(/@(?:due|deadline)\([^)]+\)/, '').trim();
            }

            // Extract deadline from emoji syntax: 📅 YYYY-MM-DD
            const emojiDueMatch = cleanText.match(/📅\s+(\d{4}-\d{2}-\d{2})/);
            if (emojiDueMatch) {
                task.deadline = emojiDueMatch[1];
                cleanText = cleanText.replace(/📅\s+\d{4}-\d{2}-\d{2}/, '').trim();
            }

            // Extract done date from @done(YYYY-MM-DD)
            const doneDateMatch = cleanText.match(/@done\((\d{4}-\d{2}-\d{2})\)/);
            if (doneDateMatch) {
                task.doneDate = doneDateMatch[1];
                cleanText = cleanText.replace(/@done\([^)]+\)/, '').trim();
            }

            // Extract done date from emoji syntax: ✅ YYYY-MM-DD
            const emojiDoneMatch = cleanText.match(/✅\s+(\d{4}-\d{2}-\d{2})/);
            if (emojiDoneMatch) {
                task.doneDate = emojiDoneMatch[1];
                cleanText = cleanText.replace(/✅\s+\d{4}-\d{2}-\d{2}/, '').trim();
            }

            // Extract started date from emoji syntax: 🛫 YYYY-MM-DD
            const emojiStartedMatch = cleanText.match(/🛫\s+(\d{4}-\d{2}-\d{2})/);
            if (emojiStartedMatch) {
                task.startedDate = emojiStartedMatch[1];
                cleanText = cleanText.replace(/🛫\s+\d{4}-\d{2}-\d{2}/, '').trim();
            }

            task.text = cleanText;

            // Calculate days until deadline and urgency
            if (task.deadline) {
                const deadlineDate = new Date(task.deadline);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                deadlineDate.setHours(0, 0, 0, 0);

                const diffTime = deadlineDate - today;
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

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

    /**
     * Reload vault data (projects/tasks) without touching plannerData.
     * Preserves: calendar events, time entries, active timers, gcal config.
     * Refreshes: sidebar project list, task list, summary stats.
     */
    async reloadVaultData() {
        if (!this.currentVaultPath || !window.__TAURI__) return;

        try {
            await this.loadVaultFromTauri();
            this.renderProjects();
            this.renderTasks();
            this.renderActiveTimerDisplay();
            this.updateSummaryStats();
            console.log(`Vault reloaded: ${this.projects.length} projects, ${this.tasks.length} tasks`);
        } catch (e) {
            console.error('Failed to reload vault data:', e);
        }
    }

    async loadPlannerData() {
        if (window.__TAURI__) {
            try {
                const { invoke } = window.__TAURI__.tauri;
                const data = await invoke('load_planner_data');
                if (data) {
                    const parsed = JSON.parse(data);
                    this.plannerData = { ...this.plannerData, ...parsed };
                }
            } catch (e) {
                console.warn('Failed to load planner data:', e);
            }
        } else {
            // Fallback to localStorage for web
            const stored = localStorage.getItem('plannerData');
            if (stored) {
                const parsed = JSON.parse(stored);
                this.plannerData = { ...this.plannerData, ...parsed };
            }
        }

        // Ensure new fields exist
        if (!this.plannerData.gcalProjectLinks) this.plannerData.gcalProjectLinks = {};
        if (!this.plannerData.loggedGcalEvents) this.plannerData.loggedGcalEvents = [];

        // Cleanup: Remove any Google Calendar events that were incorrectly saved as planned events
        const originalCount = this.plannerData.events.length;
        this.plannerData.events = this.plannerData.events.filter(e => {
            const id = e.id || '';
            // Remove gcal events
            if (id.startsWith('gcal-')) return false;
            return true;
        });
        if (this.plannerData.events.length !== originalCount) {
            console.log(`Cleaned up ${originalCount - this.plannerData.events.length} duplicate gcal events`);
            this.savePlannerData();
        }
    }

    async savePlannerData() {
        if (window.__TAURI__) {
            try {
                const { invoke } = window.__TAURI__.tauri;
                await invoke('save_planner_data', { data: JSON.stringify(this.plannerData) });
            } catch (e) {
                console.error('Failed to save planner data:', e);
            }
        } else {
            // Fallback to localStorage for web
            localStorage.setItem('plannerData', JSON.stringify(this.plannerData));
        }
    }

    /**
     * Archive time entries older than 90 days to yearly files.
     * Keeps plannerData.timeEntries lean, preserves old data in
     * time_archive_YYYY.json files in the app data dir.
     */
    async archiveOldTimeEntries() {
        if (!window.__TAURI__) return;

        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        ninetyDaysAgo.setHours(0, 0, 0, 0);
        const cutoff = ninetyDaysAgo.getTime();

        // Split entries into recent and old
        const recent = [];
        const oldByYear = {};

        for (const entry of this.plannerData.timeEntries) {
            const entryTime = entry.endTime || entry.startTime || 0;
            if (entryTime < cutoff) {
                const year = new Date(entryTime).getFullYear();
                if (!oldByYear[year]) oldByYear[year] = [];
                oldByYear[year].push(entry);
            } else {
                recent.push(entry);
            }
        }

        const yearsToArchive = Object.keys(oldByYear);
        if (yearsToArchive.length === 0) return; // Nothing to archive

        const { invoke } = window.__TAURI__.tauri;

        try {
            // Append old entries to yearly archive files
            for (const year of yearsToArchive) {
                const filename = `time_archive_${year}.json`;
                let existing = [];

                // Load existing archive for this year
                const data = await invoke('load_app_file', { filename });
                if (data) {
                    try {
                        existing = JSON.parse(data);
                    } catch (e) {
                        console.warn(`Failed to parse ${filename}:`, e);
                    }
                }

                // Merge and save
                const merged = [...existing, ...oldByYear[year]];
                await invoke('save_app_file', {
                    filename,
                    data: JSON.stringify(merged)
                });
            }

            // Update main planner data with only recent entries
            const archivedCount = this.plannerData.timeEntries.length - recent.length;
            this.plannerData.timeEntries = recent;
            await this.savePlannerData();

            console.log(`Archived ${archivedCount} time entries to ${yearsToArchive.map(y => `time_archive_${y}.json`).join(', ')}`);
        } catch (e) {
            console.error('Failed to archive time entries:', e);
        }
    }

    renderProjects() {
        const container = document.getElementById('projectList');

        if (this.projects.length === 0) {
            container.innerHTML = '<p class="empty-message">Load vault from Dashboard first</p>';
            return;
        }

        container.innerHTML = '';

        // Sort by priority
        const priorityOrder = { 'urgent': 0, 'high': 1, 'medium': 2, 'low': 3 };
        const sorted = [...this.projects].sort((a, b) => {
            const pA = (a.properties?.priority || 'low').toLowerCase();
            const pB = (b.properties?.priority || 'low').toLowerCase();
            return (priorityOrder[pA] ?? 999) - (priorityOrder[pB] ?? 999);
        });

        sorted.forEach(project => {
            const priority = (project.properties?.priority || 'low').toLowerCase();
            const priorityColors = {
                'urgent': '#ef4444',
                'high': '#f97316',
                'medium': '#f59e0b',
                'low': '#10b981'
            };

            const div = document.createElement('div');
            div.className = 'project-item-sidebar';
            div.style.borderLeftColor = priorityColors[priority] || '#6366f1';
            div.textContent = project.name;
            div.draggable = true;

            div.addEventListener('click', () => this.selectProject(project));
            div.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('application/json', JSON.stringify({
                    type: 'project',
                    name: project.name,
                    priority: priority
                }));
                div.classList.add('dragging');
            });
            div.addEventListener('dragend', () => div.classList.remove('dragging'));

            container.appendChild(div);
        });
    }

    selectProject(project) {
        this.selectedProject = project;

        // Update UI
        document.querySelectorAll('.project-item-sidebar').forEach(el => {
            el.classList.toggle('selected', el.textContent === project.name);
        });

        const selectedDiv = document.getElementById('selectedProject');
        selectedDiv.textContent = `Selected: ${project.name}`;
        selectedDiv.classList.add('active');

        this.renderTasks();
    }

    renderTasks() {
        const container = document.getElementById('taskList');

        if (!this.selectedProject) {
            container.innerHTML = '<p class="empty-message">Select a project</p>';
            return;
        }

        // Filter by project only (include completed for bottom display)
        let projectTasks = this.tasks.filter(t => t.project === this.selectedProject.name);

        if (projectTasks.length === 0) {
            container.innerHTML = '<p class="empty-message">No tasks in this project</p>';
            return;
        }

        // Sort: Incomplete first, then by deadline
        projectTasks.sort((a, b) => {
            // 1. Completion status (false/incomplete comes first)
            if (a.completed !== b.completed) {
                return a.completed ? 1 : -1;
            }
            // 2. Deadline
            if (!a.deadline) return 1;
            if (!b.deadline) return -1;
            return new Date(a.deadline) - new Date(b.deadline);
        });

        container.innerHTML = '';
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        projectTasks.forEach((task, index) => {
            // Re-find original index to keep consistent IDs if needed, 
            // but for now we use the filtered index which might mismatch if we rely on global index.
            // However, the original code used `index` from `filter` result, so we stick to that or better:
            // Let's use a composite ID based on text/project to be safer or just keep current "index" of filtered list.
            // The original used: `${task.project}-${task.experiment}-${index}`. 
            // WARNING: Using index from a filtered/sorted list will change ID if list order changes.
            // Ideally we need a unique ID. Assuming task text + project is unique enough for now or 
            // if `task` object has an `id`? It doesn't seem to.
            // Let's rely on the fact that this is just for the timer ID in this session.

            const taskId = `${task.project}-${task.experiment}-${task.text.substring(0, 10).replace(/\s+/g, '')}`;
            const timeEntry = this.getTaskTime(taskId);
            const isActive = this.activeTimer?.taskId === taskId;

            // Calculate days left
            let dueDisplay = '';
            if (task.deadline) {
                const deadlineDate = new Date(task.deadline);
                // Fix timezone issue - dates are often YYYY-MM-DD which parse as UTC
                const parts = task.deadline.split('-');
                if (parts.length === 3) {
                    deadlineDate.setFullYear(parts[0], parts[1] - 1, parts[2]);
                    deadlineDate.setHours(0, 0, 0, 0);
                } else {
                    deadlineDate.setHours(0, 0, 0, 0);
                }

                const diffTime = deadlineDate - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                let dueClass = 'task-due-future';
                let dueText = `${diffDays} days left`;

                if (diffDays < 0) {
                    dueClass = 'task-due-overdue';
                    dueText = `${Math.abs(diffDays)}d overdue`;
                } else if (diffDays === 0) {
                    dueClass = 'task-due-today';
                    dueText = 'Due today';
                } else if (diffDays === 1) {
                    dueText = '1 day left';
                }

                dueDisplay = `<span class="task-due ${dueClass}">${dueText}</span>`;
            }

            const div = document.createElement('div');
            div.className = `task-item${task.completed ? ' completed' : ''}`;
            div.innerHTML = `
                <div class="task-checkbox${task.completed ? ' checked' : ''}"></div>
                <div class="task-content">
                    <span class="task-text" title="${task.text}">${task.text}</span>
                    ${dueDisplay}
                </div>
                <div class="task-timer">
                    <span class="task-time">${this.formatTime(timeEntry + (isActive ? this.getActiveTimerElapsed() : 0))}</span>
                    <button class="timer-btn ${isActive ? 'pause' : 'play'}" data-task-id="${taskId}">
                        ${isActive ? '⏸' : '▶'}
                    </button>
                </div>
            `;

            // Timer button click
            div.querySelector('.timer-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleTimer(taskId, task);
            });

            // Checkbox click (complete task)
            div.querySelector('.task-checkbox').addEventListener('click', (e) => {
                e.stopPropagation();
                // Toggle completion (optimistic update)
                task.completed = true;
                this.renderTasks();
                // Note: We aren't saving this back to Obsidian yet, but user just wanted display changes for now.
            });

            container.appendChild(div);
        });
    }

    getTaskTime(taskId) {
        return this.plannerData.timeEntries
            .filter(e => e.taskId === taskId)
            .reduce((sum, e) => sum + (e.duration || 0), 0);
    }

    getActiveTimerElapsed() {
        if (!this.activeTimer) return 0;
        return Math.floor((Date.now() - this.activeTimer.startTime) / 1000);
    }

    toggleTimer(taskId, task) {
        if (this.activeTimer?.taskId === taskId) {
            // Stop timer
            this.stopTimer();
        } else {
            // Stop any existing timer first
            if (this.activeTimer) {
                this.stopTimer();
            }
            // Start new timer
            this.startTimer(taskId, task);
        }
        this.renderTasks();
        this.renderTimeLog();
    }

    startTimer(taskId, task) {
        this.activeTimer = {
            taskId: taskId,
            task: task,
            startTime: Date.now()
        };

        // Persist active timer
        this.plannerData.activeTimer = this.activeTimer;
        this.savePlannerData();

        // Update display every second — lightweight text-only updates
        this.activeTimerInterval = setInterval(() => {
            this.updateTimerDisplays();
        }, 1000);
    }

    getLocalDateString(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    repairTimeEntryDates() {
        let repairedCount = 0;
        this.plannerData.timeEntries.forEach(entry => {
            if (entry.startTime) {
                const correctDate = this.getLocalDateString(new Date(entry.startTime));
                if (entry.date !== correctDate) {
                    entry.date = correctDate;
                    repairedCount++;
                }
            }
        });
        if (repairedCount > 0) {
            console.log(`Repaired ${repairedCount} time entries with incorrect date strings.`);
            this.savePlannerData();
        }
    }

    stopTimer() {
        if (!this.activeTimer) return;

        clearInterval(this.activeTimerInterval);

        const duration = Math.floor((Date.now() - this.activeTimer.startTime) / 1000);

        // Save time entry
        this.plannerData.timeEntries.push({
            taskId: this.activeTimer.taskId,
            taskText: this.activeTimer.task.text,
            project: this.activeTimer.task.project,
            projectType: this.activeTimer.task.projectType || 'project',
            startTime: this.activeTimer.startTime,
            endTime: Date.now(),
            duration: duration,
            date: this.getLocalDateString(new Date(this.activeTimer.startTime)) // Use start time's local date
        });

        this.plannerData.activeTimer = null; // Clear persisted timer
        this.savePlannerData();
        this.activeTimer = null;
        this.activeTimerInterval = null;
        this.renderTimeLog();
        this.updateSummaryStats();
        this.renderActiveTimerDisplay();
    }

    formatTime(seconds) {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    formatTimeOfDay(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    renderTimeLog() {
        const container = document.getElementById('timeLog');
        const today = new Date().toISOString().split('T')[0];

        // Only show entries from the last 15 days in the sidebar
        const fifteenDaysAgo = new Date();
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
        fifteenDaysAgo.setHours(0, 0, 0, 0);
        const cutoffTime = fifteenDaysAgo.getTime();

        // Sort entries by time descending, filter to recent 15 days
        const sortedEntries = [...this.plannerData.timeEntries]
            .filter(e => {
                const entryTime = e.endTime || e.startTime || 0;
                return entryTime >= cutoffTime;
            })
            .sort((a, b) => {
                const timeA = a.endTime || a.startTime;
                const timeB = b.endTime || b.startTime;
                return timeB - timeA;
            });

        if (sortedEntries.length === 0) {
            container.innerHTML = '<p class="empty-message">No time entries in last 15 days</p>';
            document.querySelector('#totalTime span').textContent = '00:00:00';
            return;
        }

        container.innerHTML = '';
        let currentDate = null;

        sortedEntries.forEach((entry) => {
            // Add date header if date changes
            if (entry.date !== currentDate) {
                currentDate = entry.date;
                const dateHeader = document.createElement('div');
                dateHeader.className = 'time-log-date-header';
                dateHeader.textContent = currentDate === today ? 'Today' : new Date(currentDate).toLocaleDateString();
                container.appendChild(dateHeader);
            }

            // Find the actual index in the full timeEntries array
            const entryIndex = this.plannerData.timeEntries.indexOf(entry);
            const taskText = entry.taskText || entry.task || 'Untitled Task';

            let timeRange = '';
            if (entry.startTime && entry.endTime) {
                const startStr = this.formatTimeOfDay(entry.startTime);
                const endStr = this.formatTimeOfDay(entry.endTime);
                timeRange = `<span class="time-entry-range">${startStr} - ${endStr}</span>`;
            }

            const div = document.createElement('div');
            div.className = 'time-entry';
            div.innerHTML = `
                <div class="time-entry-details">
                    <span class="time-entry-task" title="${taskText}">${taskText}</span>
                    ${timeRange}
                </div>
                <span class="time-entry-duration">${this.formatTime(entry.duration)}</span>
                <button class="time-entry-delete" data-index="${entryIndex}" title="Delete entry">×</button>
            `;

            // Add click listener for delete
            div.querySelector('.time-entry-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('Delete this time entry?')) {
                    const idx = parseInt(e.target.dataset.index);
                    if (!isNaN(idx)) {
                        // If it was a gcal event, unmark it as logged
                        const entry = this.plannerData.timeEntries[idx];
                        if (entry && entry.taskId && entry.taskId.startsWith('gcal-')) {
                            const gcalId = entry.taskId.replace('gcal-', '');
                            const logIndex = this.plannerData.loggedGcalEvents?.indexOf(gcalId);
                            if (logIndex > -1) {
                                this.plannerData.loggedGcalEvents.splice(logIndex, 1);
                            }
                        }

                        this.plannerData.timeEntries.splice(idx, 1);
                        this.savePlannerData();
                        this.renderTimeLog();
                        this.updateSummaryStats();
                        this.renderTasks();
                    }
                }
            });

            // Add click listener for edit
            const editBtn = document.createElement('button');
            editBtn.className = 'time-entry-edit';
            editBtn.innerHTML = '✏️';
            editBtn.title = 'Edit entry';
            editBtn.style.marginRight = '0.5rem';
            editBtn.style.background = 'none';
            editBtn.style.border = 'none';
            editBtn.style.cursor = 'pointer';
            editBtn.style.fontSize = '0.9rem';
            editBtn.style.opacity = '0.6';

            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openEditModal(entryIndex);
            });

            // Insert edit button before delete button
            const deleteBtn = div.querySelector('.time-entry-delete');
            div.insertBefore(editBtn, deleteBtn);

            container.appendChild(div);
        });

        // Calculate total time (for today)
        const todayTotal = this.plannerData.timeEntries
            .filter(e => e.date === today)
            .reduce((acc, curr) => acc + (curr.duration || 0), 0);

        document.querySelector('#totalTime span').textContent = this.formatTime(todayTotal);
    }

    initCalendar() {
        const calendarEl = document.getElementById('calendar');

        this.calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'timeGridWeek',
            headerToolbar: {
                left: 'prev,next today toggleTracked',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay'
            },
            customButtons: {
                toggleTracked: {
                    text: '📊 Time',
                    click: () => this.toggleTimeOverlay()
                }
            },
            slotMinTime: '06:00:00',
            slotMaxTime: '22:00:00',
            slotDuration: '00:30:00',
            allDaySlot: true,
            nowIndicator: true,
            datesSet: () => {
                // Update summary stats when view changes
                this.updateSummaryStats();
            },
            editable: true,
            droppable: true,
            eventResizableFromStart: true,
            eventSources: [
                // Planned events
                {
                    events: this.plannerData.events.map(e => ({
                        ...e,
                        className: `project-event priority-${e.priority || 'low'}`,
                        extendedProps: { ...e, eventType: 'planned' }
                    })),
                    id: 'planned'
                },
                // Time tracking overlay (initially hidden)
                {
                    events: this.getTimeTrackingEvents(),
                    id: 'tracked',
                    display: 'none'
                }
            ],

            // Handle external drops (projects from sidebar)
            drop: (info) => {
                const data = JSON.parse(info.draggedEl.dataset?.json || '{}');
                if (data.type === 'project') {
                    this.addProjectEvent(data.name, data.priority, info.date, info.allDay);
                }
            },

            // Enable dragging from sidebar - handled by eventReceive
            eventReceive: (info) => {
                // Event was dropped from external source, save it
                const priority = info.event.extendedProps?.priority || 'low';
                // Always generate a unique ID for the event
                const eventId = info.event.id || `event-${Date.now()}`;
                const event = {
                    id: eventId,
                    title: info.event.title,
                    start: info.event.start?.toISOString(),
                    end: info.event.end?.toISOString(),
                    allDay: info.event.allDay,
                    priority: priority,
                    tasks: []
                };
                this.plannerData.events.push(event);
                // Sync the ID and eventType back to the FullCalendar event object
                // so that eventClick → deleteCalendarEvent uses the correct ID
                info.event.setProp('id', eventId);
                info.event.setExtendedProp('eventType', 'planned');
                this.savePlannerData();
                this.updateSummaryStats();
            },

            // Handle event changes
            eventDrop: () => this.saveCalendarEvents(),
            eventResize: () => this.saveCalendarEvents(),

            // Handle event clicks - left click opens modal, with delete option
            eventClick: (info) => {
                this.openEventModal(info.event);
            },

            height: '100%'
        });

        // Setup external draggable for projects
        this.setupExternalDrag();

        // Track whether time overlay is visible
        this.timeOverlayVisible = false;

        this.calendar.render();
    }

    getTimeTrackingEvents() {
        // Convert time entries to calendar events
        return this.plannerData.timeEntries.map((entry, index) => {
            const startTime = new Date(entry.startTime);
            const endTime = new Date(entry.endTime);

            const taskTitle = entry.taskText || entry.task || 'Untitled Task';
            const isControl = entry.projectType === 'control';
            return {
                id: `tracked-${index}`,
                title: `✓ ${taskTitle.substring(0, 20)}...`,
                start: startTime.toISOString(),
                end: endTime.toISOString(),
                className: isControl ? 'tracked-event tracked-control' : 'tracked-event',
                editable: false,
                extendedProps: {
                    eventType: 'tracked',
                    taskText: taskTitle,
                    project: entry.project,
                    duration: entry.duration
                }
            };
        });
    }

    toggleTimeOverlay() {
        this.timeOverlayVisible = !this.timeOverlayVisible;
        const trackedSource = this.calendar.getEventSourceById('tracked');

        if (trackedSource) {
            trackedSource.remove();
        }

        // Re-add with updated display
        this.calendar.addEventSource({
            events: this.getTimeTrackingEvents(),
            id: 'tracked',
            display: this.timeOverlayVisible ? 'auto' : 'none'
        });
    }

    async deleteCalendarEvent(eventId) {
        // Remove from plannerData
        this.plannerData.events = this.plannerData.events.filter(e => e.id !== eventId);
        await this.savePlannerData();

        // Remove from calendar
        const event = this.calendar.getEventById(eventId);
        if (event) {
            event.remove();
        }
    }

    setupExternalDrag() {
        // Use FullCalendar's Draggable for external drag-drop
        const containerEl = document.getElementById('projectList');

        new FullCalendar.Draggable(containerEl, {
            itemSelector: '.project-item-sidebar',
            eventData: (eventEl) => {
                const projectName = eventEl.textContent;
                const priority = this.getProjectPriority(projectName);
                return {
                    title: projectName,
                    duration: '01:00', // Default 1 hour
                    className: `project-event priority-${priority}`,
                    extendedProps: {
                        priority: priority,
                        type: 'project'
                    }
                };
            }
        });
    }

    getProjectPriority(projectName) {
        const project = this.projects.find(p => p.name === projectName);
        return (project?.properties?.priority || 'low').toLowerCase();
    }

    addProjectEvent(projectName, priority, date, allDay) {
        const eventId = `event-${Date.now()}`;
        const event = {
            id: eventId,
            title: projectName,
            start: date.toISOString(),
            end: allDay ? null : new Date(date.getTime() + 60 * 60 * 1000).toISOString(),
            allDay: allDay,
            priority: priority,
            tasks: []
        };

        this.plannerData.events.push(event);

        this.calendar.addEvent({
            ...event,
            className: `project-event priority-${priority}`,
            extendedProps: { ...event, eventType: 'planned' }
        });

        this.savePlannerData();
    }

    saveCalendarEvents() {
        const events = this.calendar.getEvents();
        // Only save planned events using positive matching
        this.plannerData.events = events
            .filter(e => {
                const eventType = e.extendedProps?.eventType;
                const id = e.id || '';
                // Include events explicitly marked as planned
                if (eventType === 'planned') return true;
                // Include events with our generated IDs (from addProjectEvent)
                if (id.startsWith('event-')) return true;
                // Exclude everything else (tracked, gcal, etc.)
                return false;
            })
            .map(e => ({
                id: e.id,
                title: e.title,
                start: e.start?.toISOString(),
                end: e.end?.toISOString(),
                allDay: e.allDay,
                priority: e.extendedProps?.priority || this.getProjectPriority(e.title),
                tasks: e.extendedProps?.tasks || []
            }));
        this.savePlannerData();
        this.updateSummaryStats();
    }

    openEventModal(event) {
        const modal = document.getElementById('taskModal');
        const title = document.getElementById('modalTitle');
        const tasksContainer = document.getElementById('eventTasks');

        const isTrackedEvent = event.extendedProps?.eventType === 'tracked';
        const isGcalEvent = event.extendedProps?.eventType === 'gcal';

        // For tracked events, show different info
        if (isTrackedEvent) {
            title.textContent = `✓ ${event.extendedProps.taskText}`;
            tasksContainer.innerHTML = `
                <div class="tracked-event-info">
                    <p><strong>Project:</strong> ${event.extendedProps.project}</p>
                    <p><strong>Duration:</strong> ${this.formatTime(event.extendedProps.duration)}</p>
                    <p><strong>Time:</strong> ${event.start.toLocaleTimeString()} - ${event.end?.toLocaleTimeString() || 'N/A'}</p>
                </div>
            `;
            // Remove delete button for tracked events
            const existingDeleteBtn = modal.querySelector('.modal-delete-btn');
            if (existingDeleteBtn) existingDeleteBtn.remove();

            modal.classList.remove('hidden');
            return;
        }

        // For Google Calendar events, show link-to-project option
        if (isGcalEvent) {
            title.textContent = `📅 ${event.title}`;

            const duration = event.end ? (event.end - event.start) / (1000 * 60 * 60) : 1;
            const currentLink = this.plannerData.gcalProjectLinks[event.id] || '';
            const isLogged = this.plannerData.loggedGcalEvents.includes(event.id);

            // Build project options
            const projectOptions = this.projects.map(p =>
                `<option value="${p.name}" ${currentLink === p.name ? 'selected' : ''}>${p.name}</option>`
            ).join('');

            tasksContainer.innerHTML = `
                <div class="gcal-event-info">
                    <p><strong>Duration:</strong> ${duration.toFixed(1)}h</p>
                    <p><strong>Time:</strong> ${event.start.toLocaleTimeString()} - ${event.end?.toLocaleTimeString() || 'N/A'}</p>
                    <p><strong>Date:</strong> ${event.start.toLocaleDateString()}</p>
                    ${event.extendedProps?.location ? `<p><strong>Location:</strong> ${event.extendedProps.location}</p>` : ''}
                </div>
                <div class="gcal-link-section">
                    <label>Link to Project:</label>
                    <select id="gcalProjectSelect">
                        <option value="">— None —</option>
                        ${projectOptions}
                    </select>
                    <button id="gcalLinkBtn" class="gcal-link-btn">${currentLink ? 'Update' : 'Link'}</button>
                    ${currentLink ? `<span class="link-status">✓ Linked to ${currentLink}</span>` : ''}
                </div>
                ${isLogged ? '<p class="logged-note">✓ Already logged as time entry</p>' : ''}
            `;

            // Setup link button handler
            setTimeout(() => {
                const linkBtn = document.getElementById('gcalLinkBtn');
                const select = document.getElementById('gcalProjectSelect');
                if (linkBtn && select) {
                    linkBtn.onclick = () => {
                        const selectedProject = select.value;
                        if (selectedProject) {
                            this.plannerData.gcalProjectLinks[event.id] = selectedProject;
                        } else {
                            delete this.plannerData.gcalProjectLinks[event.id];
                        }
                        this.savePlannerData();
                        this.updateSummaryStats();

                        // Refresh calendar display
                        const calendarEvent = this.calendar.getEventById(event.id);
                        if (calendarEvent) {
                            const isLinked = !!selectedProject;
                            calendarEvent.setProp('classNames', `gcal-event${isLinked ? ' gcal-linked' : ''}`);
                        }

                        modal.classList.add('hidden');
                    };
                }
            }, 0);

            // Remove delete button for gcal events
            const existingDeleteBtn = modal.querySelector('.modal-delete-btn');
            if (existingDeleteBtn) existingDeleteBtn.remove();

            modal.classList.remove('hidden');
            return;
        }

        title.textContent = event.title;

        // Add or update delete button
        let deleteBtn = modal.querySelector('.modal-delete-btn');
        if (!deleteBtn) {
            deleteBtn = document.createElement('button');
            deleteBtn.className = 'modal-delete-btn';
            deleteBtn.textContent = '🗑️ Delete';
            modal.querySelector('.modal-header').insertBefore(deleteBtn, modal.querySelector('.modal-close'));
        }

        // Update delete handler for current event
        deleteBtn.onclick = () => {
            if (confirm(`Delete "${event.title}" from calendar?`)) {
                this.deleteCalendarEvent(event.id);
                modal.classList.add('hidden');
            }
        };

        // Get tasks for this project
        const projectTasks = this.tasks.filter(t => t.project === event.title);

        if (projectTasks.length === 0) {
            tasksContainer.innerHTML = '<p class="empty-message">No tasks in this project</p>';
        } else {
            tasksContainer.innerHTML = '';
            projectTasks.forEach((task, index) => {
                const taskId = `${task.project}-${task.experiment}-${index}`;
                const timeEntry = this.getTaskTime(taskId);
                const isActive = this.activeTimer?.taskId === taskId;

                const div = document.createElement('div');
                div.className = 'event-task-item';
                div.innerHTML = `
                    <div class="task-checkbox${task.completed ? ' checked' : ''}"></div>
                    <span class="task-text">${task.text}</span>
                    <div class="task-timer">
                        <span class="task-time">${this.formatTime(timeEntry)}</span>
                        <button class="timer-btn ${isActive ? 'pause' : 'play'}" data-task-id="${taskId}">
                            ${isActive ? '⏸' : '▶'}
                        </button>
                    </div>
                `;

                div.querySelector('.timer-btn').addEventListener('click', () => {
                    this.toggleTimer(taskId, task);
                    this.openEventModal(event); // Refresh
                });

                tasksContainer.appendChild(div);
            });
        }

        modal.classList.remove('hidden');
    }

    setupModal() {
        const modal = document.getElementById('taskModal');
        const closeBtn = document.getElementById('modalClose');

        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    }

    setupGoogleCalendar() {
        const urlInput = document.getElementById('gcalUrl');
        const saveBtn = document.getElementById('gcalSave');
        const toggleBtn = document.getElementById('gcalToggle');
        const statusEl = document.getElementById('gcalStatus');

        // Restore saved URL
        if (this.plannerData.gcalUrl) {
            urlInput.value = this.plannerData.gcalUrl;
            toggleBtn.disabled = false;
            statusEl.textContent = 'Calendar connected';
            statusEl.className = 'gcal-status success';

            // If it was visible before, fetch and show
            if (this.plannerData.gcalVisible) {
                this.fetchGoogleCalendarEvents();
                toggleBtn.textContent = 'Hide';
                toggleBtn.classList.add('active');
            }
        }

        // Save button
        saveBtn.addEventListener('click', async () => {
            const url = urlInput.value.trim();
            if (!url) {
                statusEl.textContent = 'Please enter a URL';
                statusEl.className = 'gcal-status error';
                return;
            }

            statusEl.textContent = 'Connecting...';
            statusEl.className = 'gcal-status';

            try {
                this.plannerData.gcalUrl = url;
                await this.fetchGoogleCalendarEvents();

                toggleBtn.disabled = false;
                statusEl.textContent = `Loaded ${this.gcalEvents.length} events`;
                statusEl.className = 'gcal-status success';

                this.plannerData.gcalVisible = true;
                toggleBtn.textContent = 'Hide';
                toggleBtn.classList.add('active');

                this.savePlannerData();
            } catch (error) {
                statusEl.textContent = 'Failed to load calendar';
                statusEl.className = 'gcal-status error';
                console.error('Google Calendar error:', error);
            }
        });

        // Toggle button
        toggleBtn.addEventListener('click', () => {
            this.plannerData.gcalVisible = !this.plannerData.gcalVisible;

            if (this.plannerData.gcalVisible) {
                this.fetchGoogleCalendarEvents();
                toggleBtn.textContent = 'Hide';
                toggleBtn.classList.add('active');
            } else {
                // Remove gcal events from calendar
                const gcalSource = this.calendar.getEventSourceById('gcal');
                if (gcalSource) {
                    gcalSource.remove();
                }
                toggleBtn.textContent = 'Show';
                toggleBtn.classList.remove('active');
            }

            this.savePlannerData();
        });
    }

    setupWorkingHours() {
        const startInput = document.getElementById('workStartTime');
        const endInput = document.getElementById('workEndTime');

        // Load saved values
        const startHour = this.plannerData.workStartHour || 10;
        const endHour = this.plannerData.workEndHour || 18;
        startInput.value = `${String(startHour).padStart(2, '0')}:00`;
        endInput.value = `${String(endHour).padStart(2, '0')}:00`;

        // Save on change
        const handleChange = () => {
            const [startH] = startInput.value.split(':').map(Number);
            const [endH] = endInput.value.split(':').map(Number);

            if (startH < endH) {
                this.plannerData.workStartHour = startH;
                this.plannerData.workEndHour = endH;
                this.savePlannerData();
                this.updateSummaryStats();
            }
        };

        startInput.addEventListener('change', handleChange);
        endInput.addEventListener('change', handleChange);
    }



    setupLogPastEvents() {
        const btn = document.getElementById('logPastEventsBtn');
        if (!btn) return;

        btn.addEventListener('click', () => {
            // Find past, linked, unlogged events
            const now = new Date();
            const loggableEvents = this.gcalEvents.filter(e => {
                const end = e.end ? new Date(e.end) : new Date(new Date(e.start).getTime() + 3600000);
                const isPast = end < now;
                const project = this.plannerData.gcalProjectLinks?.[e.id];
                const isLogged = this.plannerData.loggedGcalEvents?.includes(e.id);

                // Only include if past, linked to a project, and NOT already logged
                return isPast && project && !isLogged && !e.allDay;
            });

            if (loggableEvents.length === 0) {
                alert('No past linked events found to log!');
                return;
            }

            this.showLogEventsModal(loggableEvents);
        });
    }

    showLogEventsModal(events) {
        const modal = document.getElementById('taskModal');
        const title = document.getElementById('modalTitle');
        const content = document.getElementById('eventTasks');

        title.textContent = '📅 Log Past Events';

        let html = '<div class="log-events-list" style="max-height: 400px; overflow-y: auto; margin-bottom: 1rem;">';
        events.forEach(e => {
            const project = this.plannerData.gcalProjectLinks[e.id];
            const start = new Date(e.start);
            const end = e.end ? new Date(e.end) : new Date(start.getTime() + 3600000);
            const duration = (end - start) / (1000 * 60 * 60);

            html += `
                <div class="log-event-item" style="padding: 0.5rem; border-bottom: 1px solid var(--border-color); display: flex; align-items: start; gap: 0.5rem;">
                    <input type="checkbox" id="log-${e.id}" checked style="margin-top: 0.3rem;">
                    <label for="log-${e.id}" style="cursor: pointer; flex: 1;">
                        <div class="log-event-details">
                            <div style="font-weight: 600; color: var(--text-primary);">${e.title}</div>
                            <div style="font-size: 0.8rem; color: var(--text-secondary);">
                                ${start.toLocaleDateString()} ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • 
                                <span style="color: var(--accent-primary);">${project}</span> • 
                                ${duration.toFixed(1)}h
                            </div>
                        </div>
                    </label>
                </div>
            `;
        });
        html += '</div>';

        html += `
            <div class="log-events-actions" style="display: flex; justify-content: flex-end; gap: 0.5rem; border-top: 1px solid var(--border-color); padding-top: 1rem;">
                <button class="entry-btn cancel" onclick="document.getElementById('taskModal').classList.add('hidden')">Cancel</button>
                <button id="confirmLogBtn" class="entry-btn save">Log Selected Events</button>
            </div>
        `;

        content.innerHTML = html;

        // Add delete/close button cleanup
        const existingDeleteBtn = modal.querySelector('.modal-delete-btn');
        if (existingDeleteBtn) existingDeleteBtn.remove();

        // Setup confirm handler
        setTimeout(() => {
            const confirmBtn = document.getElementById('confirmLogBtn');
            if (confirmBtn) {
                confirmBtn.onclick = () => {
                    const checkboxes = content.querySelectorAll('input[type="checkbox"]:checked');
                    let loggedCount = 0;

                    checkboxes.forEach(cb => {
                        const eventId = cb.id.replace('log-', '');
                        const event = events.find(e => e.id === eventId);
                        if (event) {
                            const project = this.plannerData.gcalProjectLinks[eventId];
                            const start = new Date(event.start);
                            const end = event.end ? new Date(event.end) : new Date(start.getTime() + 3600000);
                            const durationSeconds = (end - start) / 1000;

                            // Create time entry
                            const newEntry = {
                                id: Date.now() + Math.random(),
                                taskId: `gcal-${eventId}`, // Unique ID derived from gcal event
                                project: project,
                                taskText: event.title,
                                startTime: start.getTime(),
                                endTime: end.getTime(),
                                duration: durationSeconds,
                                date: start.toISOString().split('T')[0]
                            };

                            this.plannerData.timeEntries.push(newEntry);

                            // Mark as logged
                            if (!this.plannerData.loggedGcalEvents) this.plannerData.loggedGcalEvents = [];
                            this.plannerData.loggedGcalEvents.push(eventId);

                            loggedCount++;
                        }
                    });

                    if (loggedCount > 0) {
                        this.savePlannerData();
                        this.renderTimeLog();
                        this.updateSummaryStats();
                        // Refetch events to update calendar display (tracked vs gcal) if needed, 
                        // or just rely on summary stats update
                        alert(`Successfully logged ${loggedCount} events!`);
                        modal.classList.add('hidden');
                    }
                };
            }
        }, 0);

        modal.classList.remove('hidden');
    }

    async fetchGoogleCalendarEvents() {
        const url = this.plannerData.gcalUrl;
        if (!url) return;

        try {
            let icalData;

            // Use Tauri for fetching (bypasses CORS)
            if (window.__TAURI__) {
                const { invoke } = window.__TAURI__.tauri;
                icalData = await invoke('fetch_ical_url', { url: url });
            } else {
                // Fallback for web development (may have CORS issues)
                const response = await fetch(url);
                icalData = await response.text();
            }

            // Parse iCal data with simple parser
            this.gcalEvents = this.parseICalData(icalData);

            // Add to calendar
            const existingSource = this.calendar.getEventSourceById('gcal');
            if (existingSource) {
                existingSource.remove();
            }

            this.calendar.addEventSource({
                events: this.gcalEvents,
                id: 'gcal'
            });

            // Update summary stats with new gcal data
            this.updateSummaryStats();

        } catch (error) {
            console.error('Error fetching Google Calendar:', error);
            throw error;
        }
    }

    parseICalData(icalData) {
        const events = [];
        const lines = icalData.replace(/\r\n /g, '').split(/\r?\n/);

        let currentEvent = null;

        for (const line of lines) {
            if (line === 'BEGIN:VEVENT') {
                currentEvent = {};
            } else if (line === 'END:VEVENT' && currentEvent) {
                // Process the event
                if (currentEvent.dtstart) {
                    // Skip "Research Block" events - these are just calendar blockers
                    if (currentEvent.summary && currentEvent.summary.toLowerCase().includes('research block')) {
                        currentEvent = null;
                        continue;
                    }

                    const startDate = this.parseICalDate(currentEvent.dtstart, currentEvent.dtstart_tzid);
                    const endDate = currentEvent.dtend ? this.parseICalDate(currentEvent.dtend, currentEvent.dtend_tzid) : null;
                    const isAllDay = currentEvent.dtstart.length === 8;

                    // Expand recurring events
                    const expandedEvents = this.expandRecurringEvent(currentEvent, startDate, endDate, isAllDay);
                    events.push(...expandedEvents);
                }
                currentEvent = null;
            } else if (currentEvent) {
                const colonIndex = line.indexOf(':');
                if (colonIndex > 0) {
                    let fullKey = line.substring(0, colonIndex).toLowerCase();
                    const value = line.substring(colonIndex + 1);

                    // Extract TZID if present (e.g., DTSTART;TZID=America/New_York:20240101T120000)
                    let key = fullKey;
                    let tzid = null;
                    if (fullKey.includes(';')) {
                        const parts = fullKey.split(';');
                        key = parts[0];
                        parts.slice(1).forEach(param => {
                            if (param.startsWith('tzid=')) {
                                tzid = param.substring(5);
                            }
                        });
                    }

                    // Store relevant properties
                    if (['dtstart', 'dtend'].includes(key)) {
                        currentEvent[key] = value;
                        if (tzid) {
                            currentEvent[key + '_tzid'] = tzid;
                        }
                    } else if (['summary', 'description', 'location', 'uid', 'rrule'].includes(key)) {
                        currentEvent[key] = value;
                    }

                    // Handle EXDATE (can have multiple values, may appear multiple times)
                    if (key === 'exdate') {
                        if (!currentEvent.exdates) {
                            currentEvent.exdates = [];
                        }
                        // EXDATE can have multiple dates separated by comma
                        value.split(',').forEach(d => currentEvent.exdates.push(d.trim()));
                    }
                }
            }
        }

        return events;
    }

    createEventFromParsed(currentEvent, startDate, endDate, isAllDay, instanceIndex = 0) {
        const id = `gcal-${currentEvent.uid || Date.now()}-${instanceIndex}`;
        const isLinked = this.plannerData.gcalProjectLinks && this.plannerData.gcalProjectLinks[id];

        return {
            id: id,
            title: currentEvent.summary || 'Untitled',
            start: startDate.toISOString(),
            end: endDate ? endDate.toISOString() : null,
            allDay: isAllDay,
            className: `gcal-event${isLinked ? ' gcal-linked' : ''}`,
            editable: false,
            extendedProps: {
                eventType: 'gcal',
                description: currentEvent.description,
                location: currentEvent.location
            }
        };
    }

    expandRecurringEvent(currentEvent, startDate, endDate, isAllDay) {
        const events = [];
        const rrule = currentEvent.rrule;

        if (!rrule) {
            // Not recurring, just return as single event
            events.push(this.createEventFromParsed(currentEvent, startDate, endDate, isAllDay));
            return events;
        }

        // Parse RRULE
        const rruleParts = {};
        rrule.split(';').forEach(part => {
            const [key, value] = part.split('=');
            rruleParts[key] = value;
        });

        const freq = rruleParts.FREQ;
        const interval = parseInt(rruleParts.INTERVAL) || 1;
        const count = rruleParts.COUNT ? parseInt(rruleParts.COUNT) : null;
        const until = rruleParts.UNTIL ? this.parseICalDate(rruleParts.UNTIL) : null;
        const byday = rruleParts.BYDAY ? rruleParts.BYDAY.split(',') : null;

        // Calculate event duration
        const duration = endDate ? endDate.getTime() - startDate.getTime() : 3600000; // default 1 hour

        // Parse EXDATE (excluded dates - deleted instances)
        const excludedDates = new Set();
        if (currentEvent.exdates) {
            currentEvent.exdates.forEach(exdate => {
                // Parse the date and store as date string for comparison
                const excludedDate = this.parseICalDate(exdate);
                // Store both full datetime and date-only versions for matching
                excludedDates.add(excludedDate.toISOString());
                excludedDates.add(excludedDate.toISOString().split('T')[0]);
            });
        }

        // Define expansion window (90 days from now in both directions)
        const windowStart = new Date();
        windowStart.setDate(windowStart.getDate() - 90);
        const windowEnd = new Date();
        windowEnd.setDate(windowEnd.getDate() + 90);

        let currentDate = new Date(startDate);
        let instanceCount = 0;
        const maxInstances = 500; // Safety limit

        while (instanceCount < maxInstances) {
            // Check if we've exceeded our limits
            if (count && instanceCount >= count) break;
            if (until && currentDate > until) break;
            if (currentDate > windowEnd) break;

            // Check if this date is excluded (EXDATE)
            const currentDateStr = currentDate.toISOString();
            const currentDateOnly = currentDateStr.split('T')[0];
            const isExcluded = excludedDates.has(currentDateStr) || excludedDates.has(currentDateOnly);

            // Only add if within window and not excluded
            if (currentDate >= windowStart && !isExcluded) {
                const instanceStart = new Date(currentDate);
                const instanceEnd = new Date(currentDate.getTime() + duration);
                events.push(this.createEventFromParsed(currentEvent, instanceStart, instanceEnd, isAllDay, instanceCount));
            }

            instanceCount++;

            // Move to next occurrence
            switch (freq) {
                case 'DAILY':
                    currentDate.setDate(currentDate.getDate() + interval);
                    break;
                case 'WEEKLY':
                    currentDate.setDate(currentDate.getDate() + (7 * interval));
                    break;
                case 'MONTHLY':
                    currentDate.setMonth(currentDate.getMonth() + interval);
                    break;
                case 'YEARLY':
                    currentDate.setFullYear(currentDate.getFullYear() + interval);
                    break;
                default:
                    // Unknown frequency, just return single event
                    return events.length > 0 ? events : [this.createEventFromParsed(currentEvent, startDate, endDate, isAllDay)];
            }
        }

        return events;
    }

    parseICalDate(dateStr, tzid = null) {
        // Handle format: 20240101T120000Z or 20240101 or 20240101T120000
        if (dateStr.length === 8) {
            // All-day event: YYYYMMDD - use local date
            const year = parseInt(dateStr.substring(0, 4));
            const month = parseInt(dateStr.substring(4, 6)) - 1;
            const day = parseInt(dateStr.substring(6, 8));
            return new Date(year, month, day);
        } else {
            // Full datetime: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
            const year = parseInt(dateStr.substring(0, 4));
            const month = parseInt(dateStr.substring(4, 6)) - 1;
            const day = parseInt(dateStr.substring(6, 8));
            const hour = parseInt(dateStr.substring(9, 11)) || 0;
            const minute = parseInt(dateStr.substring(11, 13)) || 0;
            const second = parseInt(dateStr.substring(13, 15)) || 0;

            if (dateStr.endsWith('Z')) {
                // UTC time - convert to local
                return new Date(Date.UTC(year, month, day, hour, minute, second));
            } else if (tzid) {
                // Has timezone - need to convert from source timezone to local
                try {
                    // Create a date string in ISO format
                    const isoString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;

                    // Get offset for source timezone at this date/time
                    const sourceDate = new Date(isoString);
                    const sourceTzOffset = this.getTimezoneOffset(sourceDate, tzid);
                    const localOffset = sourceDate.getTimezoneOffset();

                    // Calculate the difference and adjust
                    const offsetDiff = sourceTzOffset - localOffset;
                    return new Date(sourceDate.getTime() + offsetDiff * 60 * 1000);
                } catch (e) {
                    console.warn('Failed to parse timezone:', tzid, e);
                    return new Date(year, month, day, hour, minute, second);
                }
            } else {
                // No timezone info - assume local time
                return new Date(year, month, day, hour, minute, second);
            }
        }
    }

    getTimezoneOffset(date, tzid) {
        // Get the offset in minutes for a given timezone at a given date
        try {
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: tzid,
                timeZoneName: 'shortOffset'
            });
            const parts = formatter.formatToParts(date);
            const tzPart = parts.find(p => p.type === 'timeZoneName');
            if (tzPart) {
                // Parse offset like "GMT-8" or "GMT+5:30"
                const match = tzPart.value.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
                if (match) {
                    const sign = match[1] === '+' ? -1 : 1; // Invert because offset is applied in reverse
                    const hours = parseInt(match[2]);
                    const minutes = parseInt(match[3] || 0);
                    return sign * (hours * 60 + minutes);
                }
            }
        } catch (e) {
            console.warn('Invalid timezone:', tzid);
        }
        return 0;
    }

    updateSummaryStats() {
        if (!this.calendar) return;

        const view = this.calendar.view;
        const viewStart = view.activeStart;
        const viewEnd = view.activeEnd;

        // Get configurable working hours
        const workStart = this.plannerData.workStartHour || 10;
        const workEnd = this.plannerData.workEndHour || 18;
        const workingHoursPerDay = workEnd - workStart;

        let totalWorkingDays = 0;
        const currentDate = new Date(viewStart);

        while (currentDate < viewEnd) {
            // Count weekdays (Mon-Fri)
            const dayOfWeek = currentDate.getDay();
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                totalWorkingDays++;
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }

        const totalHours = totalWorkingDays * workingHoursPerDay;

        // Update available label with current hours
        document.getElementById('statAvailableLabel').textContent = `✅ Available (${workStart}-${workEnd})`;

        // Calculate Google Calendar hours in this period (excluding logged events)
        let gcalHours = 0;
        let activeGcalEvents = [];
        if (this.gcalEvents && this.gcalEvents.length > 0) {
            activeGcalEvents = this.gcalEvents.filter(e => !this.plannerData.loggedGcalEvents?.includes(e.id));
            gcalHours = this.calculateEventHours(activeGcalEvents, viewStart, viewEnd);
        }

        // Calculate planned hours from planner events
        let plannedHours = 0;
        const plannedEvents = this.plannerData.events.map(e => ({
            start: e.start,
            end: e.end,
            allDay: e.allDay || false
        }));
        if (plannedEvents.length > 0) {
            plannedHours = this.calculateEventHours(plannedEvents, viewStart, viewEnd);
        }

        // Calculate tracked time in this period (during working hours)
        let trackedHours = 0;
        let trackedOvertime = 0;
        const trackedInPeriod = this.plannerData.timeEntries.filter(entry => {
            const entryDate = new Date(entry.startTime);
            return entryDate >= viewStart && entryDate < viewEnd;
        });
        trackedInPeriod.forEach(entry => {
            const startTime = new Date(entry.startTime);
            const duration = (entry.duration || 0) / 3600;

            // Check if during working hours (configurable, Mon-Fri)
            const hour = startTime.getHours();
            const dayOfWeek = startTime.getDay();
            const isWorkingHours = (hour >= workStart && hour < workEnd) && (dayOfWeek !== 0 && dayOfWeek !== 6);

            if (isWorkingHours) {
                trackedHours += duration;
            } else {
                trackedOvertime += duration;
            }
        });

        // Calculate overtime/outside hours for gcal and planned
        let gcalOvertime = 0;
        if (activeGcalEvents.length > 0) {
            gcalOvertime = this.calculateOutsideHours(activeGcalEvents, viewStart, viewEnd);
        }

        let plannedOvertime = 0;
        if (plannedEvents.length > 0) {
            plannedOvertime = this.calculateOutsideHours(plannedEvents, viewStart, viewEnd);
        }

        // Calculate available hours (working hours - gcal events - planned)
        const availableHours = Math.max(0, totalHours - gcalHours - plannedHours);

        // Update display
        document.getElementById('statTotalHours').textContent = `${totalHours.toFixed(1)}h`;
        document.getElementById('statGcalHours').textContent = `${gcalHours.toFixed(1)}h`;
        document.getElementById('statGcalOvertime').textContent = gcalOvertime > 0 ? `+${gcalOvertime.toFixed(1)}h` : '';
        document.getElementById('statPlannedHours').textContent = `${plannedHours.toFixed(1)}h`;
        document.getElementById('statPlannedOvertime').textContent = plannedOvertime > 0 ? `+${plannedOvertime.toFixed(1)}h` : '';
        document.getElementById('statTrackedHours').textContent = `${trackedHours.toFixed(1)}h`;
        document.getElementById('statTrackedOvertime').textContent = trackedOvertime > 0 ? `+${trackedOvertime.toFixed(1)}h` : '';
        document.getElementById('statAvailableHours').textContent = `${availableHours.toFixed(1)}h`;
    }

    calculateEventHours(events, viewStart, viewEnd) {
        const workStart = this.plannerData.workStartHour || 10;
        const workEnd = this.plannerData.workEndHour || 18;

        // Track occupied time slots to prevent double counting overlapping events
        const occupiedSlots = [];

        events.forEach(event => {
            const eventStart = new Date(event.start);
            const eventEnd = event.end ? new Date(event.end) : new Date(eventStart.getTime() + 3600000);

            // Check if event overlaps with view period
            if (eventEnd <= viewStart || eventStart >= viewEnd) return;

            // Skip all-day events for hour calculation
            if (event.allDay) return;

            // Iterate through each day the event spans
            const currentDay = new Date(eventStart);
            currentDay.setHours(0, 0, 0, 0);

            while (currentDay < eventEnd && currentDay < viewEnd) {
                // Skip weekends
                const dayOfWeek = currentDay.getDay();
                if (dayOfWeek === 0 || dayOfWeek === 6) {
                    currentDay.setDate(currentDay.getDate() + 1);
                    continue;
                }

                // Calculate working hours window for this day
                const dayWorkStart = new Date(currentDay);
                dayWorkStart.setHours(workStart, 0, 0, 0);
                const dayWorkEnd = new Date(currentDay);
                dayWorkEnd.setHours(workEnd, 0, 0, 0);

                // Calculate overlap between event and working hours for this day
                const overlapStart = Math.max(eventStart.getTime(), dayWorkStart.getTime(), viewStart.getTime());
                const overlapEnd = Math.min(eventEnd.getTime(), dayWorkEnd.getTime(), viewEnd.getTime());

                if (overlapEnd > overlapStart) {
                    occupiedSlots.push({ start: overlapStart, end: overlapEnd });
                }

                currentDay.setDate(currentDay.getDate() + 1);
            }
        });

        // Merge overlapping slots to avoid double counting
        occupiedSlots.sort((a, b) => a.start - b.start);
        const mergedSlots = [];

        for (const slot of occupiedSlots) {
            if (mergedSlots.length === 0) {
                mergedSlots.push({ ...slot });
            } else {
                const last = mergedSlots[mergedSlots.length - 1];
                if (slot.start <= last.end) {
                    // Overlapping, extend the end
                    last.end = Math.max(last.end, slot.end);
                } else {
                    mergedSlots.push({ ...slot });
                }
            }
        }

        // Calculate total hours from merged slots
        let totalHours = 0;
        for (const slot of mergedSlots) {
            totalHours += (slot.end - slot.start) / (1000 * 60 * 60);
        }

        return totalHours;
    }

    calculateOutsideHours(events, viewStart, viewEnd) {
        const workStart = this.plannerData.workStartHour || 10;
        const workEnd = this.plannerData.workEndHour || 18;
        let outsideHours = 0;

        events.forEach(event => {
            const eventStart = new Date(event.start);
            const eventEnd = event.end ? new Date(event.end) : new Date(eventStart.getTime() + 3600000);

            // Check if event overlaps with view period
            if (eventEnd <= viewStart || eventStart >= viewEnd) return;

            // Skip all-day events
            if (event.allDay) return;

            // Get event time
            const startHour = eventStart.getHours() + eventStart.getMinutes() / 60;
            const endHour = eventEnd.getHours() + eventEnd.getMinutes() / 60;
            const dayOfWeek = eventStart.getDay();

            // Calculate hours outside working hours (before workStart or after workEnd, or on weekends)
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

            if (isWeekend) {
                // All hours on weekends are overtime
                outsideHours += (eventEnd - eventStart) / (1000 * 60 * 60);
            } else {
                // Hours before workStart
                if (startHour < workStart) {
                    const earlyEnd = Math.min(endHour, workStart);
                    outsideHours += earlyEnd - startHour;
                }
                // Hours after workEnd
                if (endHour > workEnd) {
                    const lateStart = Math.max(startHour, workEnd);
                    outsideHours += endHour - lateStart;
                }
            }
        });

        return outsideHours;
    }
}

// Initialize
const planner = new Planner();
window.addEventListener('DOMContentLoaded', () => {
    planner.init();
});
