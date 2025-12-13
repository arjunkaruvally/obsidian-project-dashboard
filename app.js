// Obsidian Vault Dashboard - Main Application Logic

class VaultAnalyzer {
    constructor() {
        this.projects = [];
        this.experiments = [];
        this.tasks = [];
        this.charts = {};
        this.calendar = null;
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
            this.analyzeData();
            this.renderDashboard();

            // Save to localStorage
            this.saveToLocalStorage();
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
            completedTasks: 0,
            properties: {} // Add properties field
        };

        // Look for project-level markdown file and experiments subfolder
        let experimentsFolder = null;
        let projectFile = null;

        for await (const entry of projectHandle.values()) {
            if (entry.kind === 'directory' && entry.name === 'experiments') {
                experimentsFolder = entry;
            } else if (entry.kind === 'file' && entry.name.endsWith('.md')) {
                // Read the first markdown file found in project root
                projectFile = entry;
            }
        }

        // Parse project file if found
        if (projectFile) {
            const file = await projectFile.getFile();
            const content = await file.text();
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (frontmatterMatch) {
                try {
                    const properties = jsyaml.load(frontmatterMatch[1]) || {};
                    // Only use if type is 'project'
                    if (properties.type === 'project') {
                        project.properties = properties;
                    }
                } catch (e) {
                    console.warn('Failed to parse project frontmatter for', projectName, e);
                }
            }
        }

        if (!experimentsFolder) {
            // Still add project even without experiments folder if it has project metadata
            this.projects.push(project);
            return;
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

        this.projects.push(project);
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
                urgency: 'none',
                doneDate: null
            };

            let cleanText = taskText;

            // Extract deadline from inline syntax: @due(YYYY-MM-DD) or @deadline(YYYY-MM-DD)
            const inlineDeadlineMatch = cleanText.match(/@(?:due|deadline)\((\d{4}-\d{2}-\d{2})\)/);
            if (inlineDeadlineMatch) {
                task.deadline = inlineDeadlineMatch[1];
                cleanText = cleanText.replace(/@(?:due|deadline)\([^)]+\)/, '').trim();
            }

            // Extract done date from inline syntax: @done(YYYY-MM-DD)
            const doneDateMatch = cleanText.match(/@done\((\d{4}-\d{2}-\d{2})\)/);
            if (doneDateMatch) {
                task.doneDate = doneDateMatch[1];
                cleanText = cleanText.replace(/@done\([^)]+\)/, '').trim();
            }

            task.text = cleanText;

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

    analyzeData() {
        // Calculate overall statistics
        const totalTasks = this.tasks.length;
        const completedTasks = this.tasks.filter(t => t.completed).length;
        const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

        const statusCounts = {
            'done': 0,
            'active': 0
        };
        this.experiments.forEach(experiment => {
            const status = experiment.properties.status || 'unknown';
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        });

        // console.log(this.experiments);
        // console.log(statusCounts);

        // Update statistics display
        document.getElementById('totalProjects').textContent = this.projects.length;
        document.getElementById('totalExperiments').textContent = statusCounts['done'] + '/' + this.experiments.length;
        document.getElementById('totalTasks').textContent = completedTasks + '/' + totalTasks;
        document.getElementById('completionRate').textContent = completionRate + '%';
    }

    renderDashboard() {
        // Show dashboard
        document.getElementById('dashboard').classList.remove('hidden');

        // Render all visualizations
        this.renderCompletionChart();
        this.renderStatusChart();
        this.renderProjectStatusChart();
        this.renderTasksChart();
        this.renderDeadlineChart();
        this.renderBacklogList();
        this.renderCalendar();
        this.renderProjectList();
    }

    renderCompletionChart() {
        const ctx = document.getElementById('completionChart');

        if (this.charts.completion) {
            this.charts.completion.destroy();
        }

        const projectNames = this.projects.map(p => p.name);
        const completionRates = this.projects.map(p =>
            p.totalTasks > 0 ? Math.round((p.completedTasks / p.totalTasks) * 100) : 0
        );

        this.charts.completion = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: projectNames,
                datasets: [{
                    label: 'Completion %',
                    data: completionRates,
                    backgroundColor: 'rgba(99, 102, 241, 0.8)',
                    borderColor: 'rgba(99, 102, 241, 1)',
                    borderWidth: 2,
                    borderRadius: 8,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(10, 14, 26, 0.9)',
                        padding: 12,
                        borderColor: 'rgba(99, 102, 241, 0.5)',
                        borderWidth: 1,
                        titleColor: '#f8fafc',
                        bodyColor: '#94a3b8',
                        callbacks: {
                            label: (context) => 'Completion: ' + context.parsed.y + '%'
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        grid: { color: 'rgba(148, 163, 184, 0.1)' },
                        ticks: {
                            color: '#94a3b8',
                            callback: (value) => value + '%'
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8' }
                    }
                }
            }
        });
    }

    renderStatusChart() {
        const ctx = document.getElementById('statusChart');

        if (this.charts.status) {
            this.charts.status.destroy();
        }

        const statusCounts = {};
        this.experiments.forEach(exp => {
            const status = exp.properties.status || 'No Status';
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        });

        console.log(statusCounts);
        console.log(this.experiments);

        const labels = Object.keys(statusCounts);
        const data = Object.values(statusCounts);
        const colors = [
            'rgba(99, 102, 241, 0.8)',
            'rgba(139, 92, 246, 0.8)',
            'rgba(236, 72, 153, 0.8)',
            'rgba(16, 185, 129, 0.8)',
            'rgba(245, 158, 11, 0.8)',
            'rgba(239, 68, 68, 0.8)'
        ];

        this.charts.status = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors.slice(0, labels.length),
                    borderColor: '#0a0e1a',
                    borderWidth: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#94a3b8',
                            padding: 15,
                            font: { size: 12 }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(10, 14, 26, 0.9)',
                        padding: 12,
                        borderColor: 'rgba(99, 102, 241, 0.5)',
                        borderWidth: 1,
                        titleColor: '#f8fafc',
                        bodyColor: '#94a3b8'
                    }
                }
            }
        });
    }

    renderProjectStatusChart() {
        const ctx = document.getElementById('projectStatusChart');

        if (this.charts.projectStatus) {
            this.charts.projectStatus.destroy();
        }

        // Collect status from project properties
        const statusCounts = {};
        this.projects.forEach(project => {
            const status = project.properties.status || 'No Status';
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        });

        const labels = Object.keys(statusCounts);
        const data = Object.values(statusCounts);

        // Color mapping for project statuses
        const colorMap = {
            'active': 'rgba(99, 102, 241, 0.8)',
            'done': 'rgba(16, 185, 129, 0.8)',
            'backlogged': 'rgba(245, 158, 11, 0.8)',
            'No Status': 'rgba(148, 163, 184, 0.5)'
        };

        const colors = labels.map(label => colorMap[label] || 'rgba(139, 92, 246, 0.8)');

        this.charts.projectStatus = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors,
                    borderColor: '#0a0e1a',
                    borderWidth: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#94a3b8',
                            padding: 15,
                            font: { size: 12 }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(10, 14, 26, 0.9)',
                        padding: 12,
                        borderColor: 'rgba(99, 102, 241, 0.5)',
                        borderWidth: 1,
                        titleColor: '#f8fafc',
                        bodyColor: '#94a3b8'
                    }
                }
            }
        });
    }

    renderTasksChart() {
        const ctx = document.getElementById('tasksChart');

        if (this.charts.tasks) {
            this.charts.tasks.destroy();
        }

        const completedTasks = this.tasks.filter(t => t.completed).length;
        const pendingTasks = this.tasks.length - completedTasks;

        this.charts.tasks = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Completed', 'Pending'],
                datasets: [{
                    data: [completedTasks, pendingTasks],
                    backgroundColor: [
                        'rgba(16, 185, 129, 0.8)',
                        'rgba(148, 163, 184, 0.3)'
                    ],
                    borderColor: '#0a0e1a',
                    borderWidth: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#94a3b8',
                            padding: 15,
                            font: { size: 12 }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(10, 14, 26, 0.9)',
                        padding: 12,
                        borderColor: 'rgba(99, 102, 241, 0.5)',
                        borderWidth: 1,
                        titleColor: '#f8fafc',
                        bodyColor: '#94a3b8',
                        callbacks: {
                            label: (context) => {
                                const label = context.label || '';
                                const value = context.parsed || 0;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = Math.round((value / total) * 100);
                                return label + ': ' + value + ' (' + percentage + '%)';
                            }
                        }
                    }
                }
            }
        });
    }

    renderDeadlineChart() {
        const ctx = document.getElementById('deadlineChart');

        if (this.charts.deadline) {
            this.charts.deadline.destroy();
        }

        // Get tasks with deadlines, not completed
        const tasksWithDeadlines = this.tasks.filter(t => t.deadline && !t.completed);

        if (tasksWithDeadlines.length === 0) {
            ctx.parentElement.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📅</div><p>No upcoming deadlines</p></div>';
            return;
        }

        // Sort by days until deadline
        tasksWithDeadlines.sort((a, b) => a.daysUntilDeadline - b.daysUntilDeadline);

        // Take top 10 most urgent
        const topTasks = tasksWithDeadlines.slice(0, 10);

        const labels = topTasks.map(t => t.text.substring(0, 30) + (t.text.length > 30 ? '...' : ''));
        const data = topTasks.map(t => t.daysUntilDeadline);
        const colors = topTasks.map(t => {
            if (t.urgency === 'overdue') return 'rgba(148, 163, 184, 0.8)';
            if (t.urgency === 'urgent') return 'rgba(239, 68, 68, 0.8)';
            if (t.urgency === 'soon') return 'rgba(245, 158, 11, 0.8)';
            return 'rgba(16, 185, 129, 0.8)';
        });

        this.charts.deadline = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Days Until Deadline',
                    data: data,
                    backgroundColor: colors,
                    borderColor: colors.map(c => c.replace('0.8', '1')),
                    borderWidth: 2,
                    borderRadius: 6,
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(10, 14, 26, 0.9)',
                        padding: 12,
                        borderColor: 'rgba(99, 102, 241, 0.5)',
                        borderWidth: 1,
                        titleColor: '#f8fafc',
                        bodyColor: '#94a3b8',
                        callbacks: {
                            title: (context) => {
                                const index = context[0].dataIndex;
                                const task = topTasks[index];
                                return task.text;
                            },
                            label: (context) => {
                                const index = context.dataIndex;
                                const task = topTasks[index];
                                const days = context.parsed.x;

                                let timeText = '';
                                if (days < 0) timeText = `Overdue by ${Math.abs(days)} days`;
                                else if (days === 0) timeText = 'Due today!';
                                else if (days === 1) timeText = 'Due tomorrow';
                                else timeText = `Due in ${days} days`;

                                return [
                                    timeText,
                                    `Project: ${task.project}`,
                                    `Experiment: ${task.experiment}`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(148, 163, 184, 0.1)' },
                        ticks: {
                            color: '#94a3b8',
                            callback: (value) => value + 'd'
                        }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8' }
                    }
                }
            }
        });
    }

    renderBacklogList() {
        const container = document.getElementById('backlogList');
        container.innerHTML = '';

        const overdueTasks = this.tasks.filter(t => t.urgency === 'overdue' && !t.completed);

        if (overdueTasks.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✅</div><p>No overdue tasks!</p></div>';
            return;
        }

        // Sort by most overdue first
        overdueTasks.sort((a, b) => a.daysUntilDeadline - b.daysUntilDeadline);

        overdueTasks.forEach(task => {
            const daysOverdue = Math.abs(task.daysUntilDeadline);
            const backlogItem = document.createElement('div');
            backlogItem.className = 'backlog-item';
            backlogItem.innerHTML = `
                <h4>${task.text}</h4>
                <p>${task.project} / ${task.experiment}</p>
                <p>Deadline: ${task.deadline}</p>
                <span class="overdue-badge">${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue</span>
            `;
            container.appendChild(backlogItem);
        });
    }

    renderCalendar() {
        const calendarEl = document.getElementById('calendar');

        // Destroy existing calendar if it exists
        if (this.calendar) {
            this.calendar.destroy();
        }

        // Prepare events from tasks with deadlines
        const taskEvents = this.tasks
            .filter(t => t.deadline)
            .map(t => {
                let className = 'event-normal';
                if (t.urgency === 'overdue') className = 'event-overdue';
                else if (t.urgency === 'urgent') className = 'event-urgent';
                else if (t.urgency === 'soon') className = 'event-soon';

                return {
                    title: (t.completed ? '✓ ' : '') + t.text,
                    start: t.deadline,
                    allDay: true,
                    className: className,
                    extendedProps: {
                        type: 'task',
                        project: t.project,
                        experiment: t.experiment,
                        completed: t.completed
                    }
                };
            });

        // Prepare milestone events from projects
        const milestoneEvents = this.projects
            .filter(p => p.properties.milestone_date)
            .map(p => {
                return {
                    title: '🎯 ' + (p.properties.milestone || p.name),
                    start: p.properties.milestone_date,
                    allDay: true,
                    className: 'event-milestone',
                    extendedProps: {
                        type: 'milestone',
                        project: p.name,
                        priority: p.properties.priority,
                        status: p.properties.status,
                        clients: p.properties.clients
                    }
                };
            });

        // Combine all events
        const events = [...taskEvents, ...milestoneEvents];

        this.calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,dayGridWeek'
            },
            events: events,
            eventClick: (info) => {
                const props = info.event.extendedProps;
                if (props.type === 'milestone') {
                    const clientsText = props.clients ? `\nClients: ${Array.isArray(props.clients) ? props.clients.join(', ') : props.clients}` : '';
                    alert(
                        `🎯 MILESTONE\n\n` +
                        `Project: ${props.project}\n` +
                        `Date: ${info.event.startStr}\n` +
                        `Priority: ${props.priority || 'N/A'}\n` +
                        `Status: ${props.status || 'N/A'}` +
                        clientsText
                    );
                } else {
                    alert(
                        `Task: ${info.event.title}\n` +
                        `Project: ${props.project}\n` +
                        `Experiment: ${props.experiment}\n` +
                        `Deadline: ${info.event.startStr}\n` +
                        `Status: ${props.completed ? 'Completed' : 'Pending'}`
                    );
                }
            },
            height: 'auto'
        });

        this.calendar.render();
    }

    renderProjectList() {
        const container = document.getElementById('projectList');
        container.innerHTML = '';

        this.projects.forEach(project => {
            const completionRate = project.totalTasks > 0
                ? Math.round((project.completedTasks / project.totalTasks) * 100)
                : 0;

            // Calculate days since last activity
            let activityText = '';
            if (project.totalTasks === 0) {
                activityText = '<span class="activity-status no-tasks">No tasks</span>';
            } else {
                // Get all completed tasks for this project with done dates
                const projectTasks = this.tasks.filter(t => t.project === project.name && t.completed && t.doneDate);

                if (projectTasks.length === 0) {
                    activityText = '<span class="activity-status no-activity">No completed tasks</span>';
                } else {
                    // Find the most recent done date
                    const sortedTasks = projectTasks.sort((a, b) => new Date(b.doneDate) - new Date(a.doneDate));
                    const mostRecentDate = new Date(sortedTasks[0].doneDate);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    mostRecentDate.setHours(0, 0, 0, 0);

                    const diffTime = today - mostRecentDate;
                    const daysSince = Math.floor(diffTime / (1000 * 60 * 60 * 24));

                    if (daysSince === 0) {
                        activityText = '<span class="activity-status active-today">Active today</span>';
                    } else if (daysSince === 1) {
                        activityText = '<span class="activity-status recent">1 day ago</span>';
                    } else if (daysSince <= 7) {
                        activityText = `<span class="activity-status recent">${daysSince} days ago</span>`;
                    } else if (daysSince <= 30) {
                        activityText = `<span class="activity-status moderate">${daysSince} days ago</span>`;
                    } else {
                        activityText = `<span class="activity-status stale">${daysSince} days ago</span>`;
                    }
                }
            }

            const projectItem = document.createElement('div');
            projectItem.className = 'project-item';
            projectItem.innerHTML = `
                <h3>${project.name}</h3>
                <p>${project.experiments.length} experiments • ${project.completedTasks}/${project.totalTasks} tasks completed</p>
                <p class="last-activity">Last activity: ${activityText}</p>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${completionRate}%"></div>
                </div>
            `;
            container.appendChild(projectItem);
        });
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
        analyzer.analyzeData();
        analyzer.renderDashboard();
        const fileInfo = document.getElementById('fileInfo');
        fileInfo.textContent = `✓ Loaded ${analyzer.projects.length} projects from cache`;
        fileInfo.style.color = 'var(--success)';
    }
});

document.getElementById('loadVaultBtn').addEventListener('click', async () => {
    const fileInfo = document.getElementById('fileInfo');
    fileInfo.textContent = 'Loading vault...';
    fileInfo.style.color = '';

    await analyzer.loadVault();

    if (analyzer.projects.length > 0) {
        fileInfo.textContent = `✓ Loaded ${analyzer.projects.length} projects with ${analyzer.experiments.length} experiments`;
        fileInfo.style.color = 'var(--success)';
    } else {
        fileInfo.textContent = '⚠️ No projects with experiments folder found';
    }
});

// Check for File System Access API support
if (!('showDirectoryPicker' in window)) {
    document.getElementById('loadVaultBtn').disabled = true;
    document.getElementById('fileInfo').textContent = '⚠️ Your browser does not support folder selection. Please use Chrome, Edge, or another Chromium-based browser.';
    document.getElementById('fileInfo').style.color = 'var(--warning)';
}
