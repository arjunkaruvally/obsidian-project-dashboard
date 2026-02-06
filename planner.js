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
            workEndHour: 18
        };
        this.activeTimer = null;
        this.activeTimerInterval = null;
        this.gcalEvents = [];
    }

    async init() {
        // Load projects/tasks from localStorage (shared with dashboard)
        this.loadFromLocalStorage();

        // Load planner data from persistent storage
        await this.loadPlannerData();

        // Initialize UI
        this.renderProjects();
        this.initCalendar();
        this.renderTimeLog();

        // Setup modal, custom entry form, Google Calendar, and working hours
        this.setupModal();
        this.setupCustomTimeEntry();
        this.setupGoogleCalendar();
        this.setupWorkingHours();

        // Initial summary update
        this.updateSummaryStats();
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
                date: new Date().toISOString().split('T')[0]
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

    async loadPlannerData() {
        if (window.__TAURI__) {
            try {
                const { invoke } = window.__TAURI__.tauri;
                const data = await invoke('load_planner_data');
                if (data) {
                    this.plannerData = JSON.parse(data);
                }
            } catch (e) {
                console.warn('Failed to load planner data:', e);
            }
        } else {
            // Fallback to localStorage for web
            const stored = localStorage.getItem('plannerData');
            if (stored) {
                this.plannerData = JSON.parse(stored);
            }
        }

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

        const projectTasks = this.tasks.filter(t => t.project === this.selectedProject.name);

        if (projectTasks.length === 0) {
            container.innerHTML = '<p class="empty-message">No tasks in this project</p>';
            return;
        }

        container.innerHTML = '';

        projectTasks.forEach((task, index) => {
            const taskId = `${task.project}-${task.experiment}-${index}`;
            const timeEntry = this.getTaskTime(taskId);
            const isActive = this.activeTimer?.taskId === taskId;

            const div = document.createElement('div');
            div.className = `task-item${task.completed ? ' completed' : ''}`;
            div.innerHTML = `
                <div class="task-checkbox${task.completed ? ' checked' : ''}"></div>
                <span class="task-text" title="${task.text}">${task.text}</span>
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

        // Update display every second
        this.activeTimerInterval = setInterval(() => {
            this.renderTasks();
        }, 1000);
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
            startTime: this.activeTimer.startTime,
            endTime: Date.now(),
            duration: duration,
            date: new Date().toISOString().split('T')[0]
        });

        this.savePlannerData();
        this.activeTimer = null;
        this.activeTimerInterval = null;
    }

    formatTime(seconds) {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    renderTimeLog() {
        const container = document.getElementById('timeLog');
        const today = new Date().toISOString().split('T')[0];

        const todayEntries = this.plannerData.timeEntries.filter(e => e.date === today);

        if (todayEntries.length === 0) {
            container.innerHTML = '<p class="empty-message">No time entries today</p>';
            document.querySelector('#totalTime span').textContent = '00:00:00';
            return;
        }

        container.innerHTML = '';

        todayEntries.forEach((entry, index) => {
            // Find the actual index in the full timeEntries array
            const entryIndex = this.plannerData.timeEntries.indexOf(entry);

            const div = document.createElement('div');
            div.className = 'time-entry';
            div.innerHTML = `
                <span class="time-entry-task" title="${entry.taskText}">${entry.taskText}</span>
                <span class="time-entry-duration">${this.formatTime(entry.duration)}</span>
                <button class="time-entry-delete" data-index="${entryIndex}" title="Delete entry">×</button>
            `;

            // Delete button handler
            div.querySelector('.time-entry-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteTimeEntry(entryIndex);
            });

            container.appendChild(div);
        });

        const totalSeconds = todayEntries.reduce((sum, e) => sum + e.duration, 0);
        document.querySelector('#totalTime span').textContent = this.formatTime(totalSeconds);
    }

    deleteTimeEntry(index) {
        if (confirm('Delete this time entry?')) {
            this.plannerData.timeEntries.splice(index, 1);
            this.savePlannerData();
            this.renderTimeLog();
            this.renderTasks(); // Update task times
        }
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
                const event = {
                    id: info.event.id || `event-${Date.now()}`,
                    title: info.event.title,
                    start: info.event.start?.toISOString(),
                    end: info.event.end?.toISOString(),
                    allDay: info.event.allDay,
                    priority: priority,
                    tasks: []
                };
                this.plannerData.events.push(event);
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

            return {
                id: `tracked-${index}`,
                title: `✓ ${entry.taskText.substring(0, 20)}...`,
                start: startTime.toISOString(),
                end: endTime.toISOString(),
                className: 'tracked-event',
                editable: false,
                extendedProps: {
                    eventType: 'tracked',
                    taskText: entry.taskText,
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

    deleteCalendarEvent(eventId) {
        // Remove from plannerData
        this.plannerData.events = this.plannerData.events.filter(e => e.id !== eventId);
        this.savePlannerData();

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
            className: `project-event priority-${priority}`
        });

        this.savePlannerData();
    }

    saveCalendarEvents() {
        const events = this.calendar.getEvents();
        // Only save planned events, not tracked or gcal events
        this.plannerData.events = events
            .filter(e => {
                const eventType = e.extendedProps?.eventType;
                const id = e.id || '';
                // Exclude tracked events
                if (eventType === 'tracked' || id.startsWith('tracked-')) return false;
                // Exclude Google Calendar events
                if (eventType === 'gcal' || id.startsWith('gcal-')) return false;
                return true;
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
        return {
            id: `gcal-${currentEvent.uid || Date.now()}-${instanceIndex}`,
            title: currentEvent.summary || 'Untitled',
            start: startDate.toISOString(),
            end: endDate ? endDate.toISOString() : null,
            allDay: isAllDay,
            className: 'gcal-event',
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

        // Calculate Google Calendar hours in this period
        let gcalHours = 0;
        if (this.gcalEvents && this.gcalEvents.length > 0) {
            gcalHours = this.calculateEventHours(this.gcalEvents, viewStart, viewEnd);
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
        if (this.gcalEvents && this.gcalEvents.length > 0) {
            gcalOvertime = this.calculateOutsideHours(this.gcalEvents, viewStart, viewEnd);
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
