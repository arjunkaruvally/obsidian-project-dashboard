class ReportDashboard {
    constructor() {
        this.plannerData = { timeEntries: [] };
        this.vaultData = { tasks: [], projects: [] };
        
        // Chart instances
        this.charts = {
            productiveTime: null,
            tasksCompleted: null,
            productivityTrend: null
        };
        
        this.currentDays = 60; // Default period
        this.currentGranularity = 'weekly';
        this.currentDistribution = 'project';
    }

    async init() {
        // Load planner data natively if in Tauri desktop mode
        if (window.__TAURI__) {
            const { invoke } = window.__TAURI__.tauri;
            try {
                const plannerStr = await invoke('load_planner_data');
                if (plannerStr) {
                    this.plannerData = JSON.parse(plannerStr);
                }
            } catch (e) {
                console.error("Failed to load plannerData via Tauri:", e);
            }
        } else {
            const plannerStored = localStorage.getItem('plannerData');
            if (plannerStored) {
                try {
                    this.plannerData = JSON.parse(plannerStored);
                } catch (e) {
                    console.error("Failed to parse plannerData:", e);
                }
            }
        }
        
        // Vault definitions are cached to localStorage currently by the parser
        const vaultStored = localStorage.getItem('obsidianVaultData');
        if (vaultStored) {
            try {
                this.vaultData = JSON.parse(vaultStored);
            } catch (e) {
                console.error("Failed to parse obsidianVaultData:", e);
            }
        }

        // Setup dropdown listeners
        const periodSelect = document.getElementById('periodSelect');
        periodSelect.addEventListener('change', (e) => {
            this.currentDays = parseInt(e.target.value);
            this.updateDashboard();
        });

        const granularitySelect = document.getElementById('granularitySelect');
        granularitySelect.addEventListener('change', (e) => {
            this.currentGranularity = e.target.value;
            this.updateDashboard();
        });
        
        // Setup direct fast-reload watcher natively independent of app.js
        if (window.__TAURI__) {
            try {
                const { listen } = window.__TAURI__.event;
                listen('vault-changed', async () => {
                    console.log('[Report Analytics] Vault File Changed. Re-synchronizing backend natively...');
                    await this.syncVaultDirectly();
                    this.updateDashboard();
                });
            } catch (e) {
                console.warn('Native listener attachment failed', e);
            }
        }
        
        const distSelect = document.getElementById('distributionSelect');
        if (distSelect) {
            distSelect.addEventListener('change', (e) => {
                this.currentDistribution = e.target.value;
                this.updateDashboard();
            });
        }

        const projectFilterSelect = document.getElementById('projectFilterSelect');
        if (projectFilterSelect) {
            projectFilterSelect.addEventListener('change', () => {
                this.updateDashboard();
            });
        }

        // Initialize display
        this.updateDashboard();
    }

    getCutoffDate(days) {
        const date = new Date();
        date.setDate(date.getDate() - days);
        date.setHours(0, 0, 0, 0);
        return date;
    }

    formatTime(hours) {
        const h = Math.floor(hours);
        const m = Math.round((hours - h) * 60);
        return `${h}h ${m}m`;
    }

    updateDashboard() {
        const cutoffDate = this.getCutoffDate(this.currentDays);
        const cutoffTime = cutoffDate.getTime();
        
        // --- 1. Filter and Segment Time Entries ---
        const recentTimeEntries = (this.plannerData.timeEntries || []).filter(e => {
            const time = e.endTime || e.startTime;
            return time && time >= cutoffTime;
        });

        const productiveEntries = recentTimeEntries.filter(e => e.projectType !== 'control');
        const controlEntries = recentTimeEntries.filter(e => e.projectType === 'control');

        // --- 2. Filter Completed Tasks ---
        const recentCompletedTasks = (this.vaultData.tasks || []).filter(t => {
            if (!t.completed || !t.doneDate) return false;
            // Parse doneDate (YYYY-MM-DD or standard parse)
            const d = new Date(t.doneDate);
            if (isNaN(d.getTime())) return false; // Invalid date
            return d.getTime() >= cutoffTime;
        });

        // --- 3. Compute Productive Stats ---
        const productiveSeconds = productiveEntries.reduce((sum, e) => sum + (e.duration || 0), 0);
        const productiveHours = productiveSeconds / 3600;
        
        let avgHours = 0;
        let targetLabel = '';
        let avgLabel = '';

        if (this.currentGranularity === 'daily') {
            avgHours = productiveHours / this.currentDays;
            targetLabel = 'Target: 8h / day';
            avgLabel = 'Daily Average';
        } else if (this.currentGranularity === 'weekly') {
            avgHours = productiveHours / (this.currentDays / 7);
            targetLabel = 'Target: 40h / week';
            avgLabel = 'Weekly Average';
        } else if (this.currentGranularity === 'monthly') {
            avgHours = productiveHours / (this.currentDays / 30);
            targetLabel = 'Target: 160h / month';
            avgLabel = 'Monthly Average';
        }
        
        // Find top productive project
        const projectTimeMap = {};
        productiveEntries.forEach(e => {
            const duration = e.duration || 0;
            projectTimeMap[e.project] = (projectTimeMap[e.project] || 0) + duration;
        });
        
        let topProjectName = 'None';
        let maxTime = 0;
        for (const [project, time] of Object.entries(projectTimeMap)) {
            if (time > maxTime) {
                maxTime = time;
                topProjectName = project;
            }
        }

        // Update Productive DOM
        document.getElementById('productiveHoursAvg').textContent = this.formatTime(avgHours);
        document.getElementById('productiveHoursAvgLabel').textContent = avgLabel;
        document.getElementById('productiveHoursTarget').textContent = targetLabel;
        document.getElementById('tasksCompletedTotal').textContent = recentCompletedTasks.length;
        document.getElementById('topProjectName').textContent = topProjectName;
        document.getElementById('topProjectName').title = topProjectName;

        // --- 4. Compute Control Stats ---
        const controlSeconds = controlEntries.reduce((sum, e) => sum + (e.duration || 0), 0);
        const controlHours = controlSeconds / 3600;
        
        // Find worst habit and count breaches
        const habitTimeMap = {};
        controlEntries.forEach(e => {
            const duration = e.duration || 0;
            habitTimeMap[e.taskText || 'Untitled Habit'] = (habitTimeMap[e.taskText || 'Untitled Habit'] || 0) + duration;
        });
        
        let worstHabit = 'None';
        let maxHabitTime = 0;
        for (const [habit, time] of Object.entries(habitTimeMap)) {
            if (time > maxHabitTime) {
                maxHabitTime = time;
                worstHabit = habit;
            }
        }
        
        // Attempt to estimate target breaches by dynamically applying constraints
        let targetBreaches = 0;
        const habitRules = {};
        
        // Helper to find or parse target constraints
        const getRule = (taskText) => {
            let clean = taskText.replace(/@target\([^)]+\)/, '').trim();
            if (habitRules[clean]) return habitRules[clean];
            
            // Search vault parsed tasks
            const task = this.vaultData.tasks.find(t => t.text === clean);
            if (task && task.target) {
                habitRules[clean] = task.target;
                return task.target;
            }
            
            // Parse legacy string
            const match = taskText.match(/@target\(([^)]+)\)/);
            if (match) {
                const parts = match[1].split('/');
                if (parts.length === 2) {
                    let limitSeconds = 0;
                    if (parts[0].includes('hr') || parts[0].includes('hour')) limitSeconds = parseFloat(parts[0]) * 3600;
                    else if (parts[0].includes('min')) limitSeconds = parseFloat(parts[0]) * 60;
                    else if (parts[0].includes('sec')) limitSeconds = parseFloat(parts[0]);
                    
                    let period = 'day';
                    if (parts[1].includes('week')) period = 'week';
                    else if (parts[1].includes('month')) period = 'month';
                    
                    const target = { limitSeconds, period };
                    habitRules[clean] = target;
                    return target;
                }
            }
            return null;
        };

        // Group entries into buckets based on their native constraint period
        const habitBuckets = {}; // { 'CleanHabit': { 'BucketKey': duration } }
        
        controlEntries.forEach(e => {
            if (!e.taskText || !e.date) return;
            const clean = e.taskText.replace(/@target\([^)]+\)/, '').trim();
            const rule = getRule(e.taskText);
            
            if (rule && rule.limitSeconds > 0) {
                let granularity = 'daily';
                if (rule.period === 'week') granularity = 'weekly';
                if (rule.period === 'month') granularity = 'monthly';
                
                const bucketKey = this.getBucketKey(e.date, granularity);
                if (bucketKey) {
                    if (!habitBuckets[clean]) habitBuckets[clean] = {};
                    habitBuckets[clean][bucketKey] = (habitBuckets[clean][bucketKey] || 0) + (e.duration || 0);
                }
            }
        });
        
        // Count limits exceeded
        for (const habit in habitBuckets) {
            const rule = habitRules[habit];
            if (rule) {
                for (const bucketKey in habitBuckets[habit]) {
                    if (habitBuckets[habit][bucketKey] > rule.limitSeconds) {
                        targetBreaches++;
                    }
                }
            }
        }

        // Clean up worst habit text for display
        if (worstHabit.includes('@target')) {
            worstHabit = worstHabit.replace(/@target\([^)]+\)/, '').trim();
        }

        // Update Control DOM
        document.getElementById('controlHoursTotal').textContent = this.formatTime(controlHours);
        document.getElementById('controlBreachesTotal').textContent = targetBreaches;
        document.getElementById('topControlHabit').textContent = worstHabit;
        document.getElementById('topControlHabit').title = worstHabit;

        // --- 4.5 Compute Holistic Scores ---
        const buckets = this.generateBuckets(this.currentDays, this.currentGranularity);
        
        let targetPerBucket = 8;
        if (this.currentGranularity === 'weekly') targetPerBucket = 40;
        if (this.currentGranularity === 'monthly') targetPerBucket = 160;

        // 1. Target Adherence
        const prodMap = {};
        productiveEntries.forEach(e => {
            const key = this.getBucketKey(e.date, this.currentGranularity);
            if (key) prodMap[key] = (prodMap[key] || 0) + (e.duration || 0);
        });

        let hitCount = 0;
        buckets.forEach(b => {
            const hours = (prodMap[b.key] || 0) / 3600;
            if (hours >= targetPerBucket) {
                hitCount++;
            }
        });
        
        const adherencePercent = buckets.length > 0 ? Math.round((hitCount / buckets.length) * 100) : 0;
        document.getElementById('targetAdherenceScore').textContent = `${adherencePercent}%`;

        // 2. Net Productivity
        const netSeconds = productiveSeconds - controlSeconds;
        const totalSeconds = productiveSeconds + controlSeconds;
        
        let netPercent = 0;
        if (totalSeconds > 0) {
            netPercent = Math.round((netSeconds / totalSeconds) * 100);
        }

        let netColor = '#10b981'; // Green
        let netSign = '';
        if (netPercent < 0) {
            netColor = '#ef4444'; // Red
        } else if (netPercent > 0) {
            netSign = '+';
        }
        
        const netEl = document.getElementById('netProductivityScore');
        netEl.textContent = `${netSign}${netPercent}%`;
        netEl.style.color = netColor;

        // Populate Project Filter Dropdown
        const projectFilterSelect = document.getElementById('projectFilterSelect');
        let projectFilterVal = 'all';
        if (projectFilterSelect) {
            projectFilterVal = projectFilterSelect.value;
            const uniqueProjects = [...new Set(recentCompletedTasks.map(t => t.project || 'Uncategorized'))].sort();
            
            projectFilterSelect.innerHTML = '<option value="all">All Projects</option>';
            uniqueProjects.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p;
                opt.textContent = p;
                projectFilterSelect.appendChild(opt);
            });
            
            if (uniqueProjects.includes(projectFilterVal)) {
                projectFilterSelect.value = projectFilterVal;
            } else {
                projectFilterSelect.value = 'all';
                projectFilterVal = 'all';
            }
        }

        // Filter completed tasks for the list breakdown
        let filteredTasks = recentCompletedTasks;
        if (projectFilterVal !== 'all') {
            filteredTasks = recentCompletedTasks.filter(t => (t.project || 'Uncategorized') === projectFilterVal);
        }

        // --- 5. Render Charts ---
        this.renderDailyTimeChart(productiveEntries, buckets, targetPerBucket);
        this.renderTasksCompletedChart(recentCompletedTasks);
        this.renderCompletedTasksList(filteredTasks);
        this.renderProductivityTrendChart(productiveEntries, controlEntries, buckets);
    }

    // Generate buckets between start and end date based on granularity
    generateBuckets(days, granularity) {
        const buckets = [];
        const endDate = new Date();
        endDate.setHours(23, 59, 59, 999);
        
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);

        let curr = new Date(startDate);
        
        while (curr <= endDate) {
            let label, key;
            if (granularity === 'monthly') {
                const arr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                label = `${arr[curr.getMonth()]} ${curr.getFullYear()}`;
                key = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}`;
                
                curr.setMonth(curr.getMonth() + 1);
                curr.setDate(1);
            } else if (granularity === 'weekly') {
                const d = new Date(curr);
                const day = d.getDay();
                d.setDate(d.getDate() - day); // snap to sunday
                
                label = `Week of ${d.getMonth() + 1}/${d.getDate()}`;
                key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                
                curr.setDate(curr.getDate() + 7);
                curr.setDate(curr.getDate() - curr.getDay());
            } else {
                label = `${curr.getMonth() + 1}/${curr.getDate()}`;
                key = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}-${String(curr.getDate()).padStart(2, '0')}`;
                
                curr.setDate(curr.getDate() + 1);
            }
            buckets.push({ label, key });
        }
        return buckets;
    }
    
    getBucketKey(dateStr, granularity) {
        if (!dateStr) return null;
        let d;
        // Check if string has time or pure ISO. Since input is YYYY-MM-DD it parses UTC implicitly. 
        // We append T00:00:00 to strictly parse as local.
        if (dateStr.length === 10) {
            d = new Date(dateStr + "T00:00:00");
        } else {
            d = new Date(dateStr);
        }
        
        if (isNaN(d.getTime())) return null;
        
        if (granularity === 'monthly') {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        } else if (granularity === 'weekly') {
            const day = d.getDay();
            d.setDate(d.getDate() - day);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        } else {
            return dateStr.substring(0, 10);
        }
    }

    renderDailyTimeChart(productiveEntries, buckets, targetPerBucket) {
        const canvas = document.getElementById('productiveTimeChart');
        if (this.charts.productiveTime) {
            this.charts.productiveTime.destroy();
        }

        const labels = buckets.map(b => b.label);
        const targetData = buckets.map(() => targetPerBucket);
        
        // Aggregate mapping
        const timeMap = {};
        productiveEntries.forEach(e => {
            const key = this.getBucketKey(e.date, this.currentGranularity);
            if (key) {
                timeMap[key] = (timeMap[key] || 0) + (e.duration || 0);
            }
        });
        
        const dataPoints = buckets.map(b => {
            const seconds = timeMap[b.key] || 0;
            return (seconds / 3600).toFixed(2);
        });

        this.charts.productiveTime = new Chart(canvas, {
            data: {
                labels: labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Productive Hours',
                        data: dataPoints,
                        backgroundColor: 'rgba(99, 102, 241, 0.8)',
                        borderColor: '#4f46e5',
                        borderWidth: 1,
                        borderRadius: 4,
                        order: 2
                    },
                    {
                        type: 'line',
                        label: 'Target Goal',
                        data: targetData,
                        borderColor: 'rgba(34, 197, 94, 0.8)', // Green
                        borderWidth: 2,
                        borderDash: [5, 5],
                        fill: false,
                        pointRadius: 0,
                        order: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                        ticks: { color: '#94a3b8' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { 
                            color: '#94a3b8',
                            maxTicksLimit: 15 // Don't crowd 90 days
                        }
                    }
                },
                plugins: {
                    legend: { 
                        display: true,
                        labels: { color: '#e2e8f0', font: { size: 12 }, usePointStyle: true }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return ` ${context.dataset.label}: ${context.raw} hrs`;
                            }
                        }
                    }
                }
            }
        });
    }

    renderTasksCompletedChart(tasks) {
        const canvas = document.getElementById('tasksCompletedChart');
        if (this.charts.tasksCompleted) {
            this.charts.tasksCompleted.destroy();
        }

        const counts = {};
        
        tasks.forEach(t => {
            const projectName = t.project || 'Uncategorized';
            
            if (this.currentDistribution === 'client') {
                const projModel = (this.vaultData.projects || []).find(p => p.name === projectName);
                let clients = ['No Client Identified'];
                
                if (projModel && projModel.properties && projModel.properties.clients) {
                    const c = projModel.properties.clients;
                    if (Array.isArray(c) && c.length > 0) {
                        clients = c;
                    } else if (typeof c === 'string') {
                        clients = [c];
                    }
                }
                
                if (clients[0] === 'No Client Identified') {
                    console.log(`[Report Analytics] No client found for task: "${t.text}" (Project: ${t.project || 'None'})`);
                }
                
                clients.forEach(client => {
                    counts[client] = (counts[client] || 0) + 1;
                });
            } else {
                counts[projectName] = (counts[projectName] || 0) + 1;
            }
        });

        const sortedEntries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const labels = sortedEntries.map(e => e[0]);
        const data = sortedEntries.map(e => e[1]);
        
        // Generate nice colors
        const colors = [
            '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', 
            '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9'
        ];
        
        const bgColors = labels.map((_, i) => colors[i % colors.length]);

        this.charts.tasksCompleted = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: bgColors,
                    borderWidth: 0,
                    hoverOffset: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: '#e2e8f0',
                            font: { size: 12 },
                            padding: 15
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const value = context.raw;
                                const total = tasks.length > 0 ? tasks.length : 1;
                                const percentage = Math.round((value / total) * 100);
                                return ` ${context.label}: ${value} task${value !== 1 ? 's' : ''} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    renderCompletedTasksList(completedTasks) {
        const listContainer = document.getElementById('completedTasksList');
        if (!listContainer) return;
        
        listContainer.innerHTML = '';
        
        // Sum up all time ever tracked for these specific tasks
        const allTimeMap = {};
        (this.plannerData.timeEntries || []).forEach(e => {
            if (e.taskText) {
                const clean = e.taskText.replace(/@target\([^)]+\)/, '').trim();
                allTimeMap[clean] = (allTimeMap[clean] || 0) + (e.duration || 0);
            }
        });
        
        // Build array
        const durationList = completedTasks.map(t => {
            let daysToComplete = null;
            if (t.startedDate && t.doneDate) {
                const s = new Date(t.startedDate);
                const d = new Date(t.doneDate);
                if (!isNaN(s.getTime()) && !isNaN(d.getTime())) {
                    const diffTime = d.getTime() - s.getTime();
                    daysToComplete = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
                }
            }

            return {
                text: t.text,
                project: t.project,
                seconds: allTimeMap[t.text] || 0,
                daysToComplete: daysToComplete
            };
        }).sort((a, b) => b.seconds - a.seconds); // Sort highest duration first
        
        if (durationList.length === 0) {
            listContainer.innerHTML = '<div style="color: #94a3b8; padding: 1rem; text-align: center; font-size: 0.95rem;">No tasks were marked complete during this window.</div>';
            return;
        }
        
        durationList.forEach(item => {
            const div = document.createElement('div');
            div.className = 'task-duration-item';
            
            const h = Math.floor(item.seconds / 3600);
            const m = Math.floor((item.seconds % 3600) / 60);
            const timeStr = `${h}h ${m}m`;
            
            let daysBadge = '';
            if (item.daysToComplete !== null) {
                daysBadge = `<span style="font-size: 0.8rem; color: #94a3b8; margin-right: 0.75rem;">${item.daysToComplete} day${item.daysToComplete > 1 ? 's' : ''} to complete</span>`;
            }
            
            div.innerHTML = `
                <div>
                    <div class="task-name">${item.text}</div>
                    <div class="task-project">${item.project || 'Uncategorized'}</div>
                </div>
                <div style="display: flex; align-items: center;">
                    ${daysBadge}
                    <div class="task-time">${timeStr}</div>
                </div>
            `;
            listContainer.appendChild(div);
        });

        this.renderProjectAverages(durationList);
    }

    renderProjectAverages(durationList) {
        const listContainer = document.getElementById('projectAveragesList');
        if (!listContainer) return;
        
        listContainer.innerHTML = '';
        
        const projectStats = {};
        
        durationList.forEach(t => {
            const p = t.project || 'Uncategorized';
            if (!projectStats[p]) {
                projectStats[p] = { 
                    count: 0, 
                    timeTrackedCount: 0, 
                    totalSeconds: 0, 
                    daysCount: 0, 
                    totalDays: 0,
                    trackedSecondsList: [],
                    daysToCompleteList: []
                };
            }
            
            projectStats[p].count++;
            
            if (t.seconds > 0) {
                projectStats[p].timeTrackedCount++;
                projectStats[p].totalSeconds += t.seconds;
                projectStats[p].trackedSecondsList.push(t.seconds);
            }
            
            if (t.daysToComplete !== null) {
                projectStats[p].daysCount++;
                projectStats[p].totalDays += t.daysToComplete;
                projectStats[p].daysToCompleteList.push(t.daysToComplete);
            }
        });
        
        const sortedProjects = Object.keys(projectStats).sort((a, b) => projectStats[b].count - projectStats[a].count);
        
        if (sortedProjects.length === 0) {
            listContainer.innerHTML = '<div style="color: #94a3b8; padding: 1rem; text-align: center; font-size: 0.95rem;">No project data available.</div>';
            return;
        }
        
        sortedProjects.forEach(p => {
            const stats = projectStats[p];
            
            let timeStr = '-- / task';
            if (stats.timeTrackedCount > 0) {
                const avgSeconds = stats.totalSeconds / stats.timeTrackedCount;
                
                let varianceSq = 0;
                stats.trackedSecondsList.forEach(sec => {
                    varianceSq += Math.pow(sec - avgSeconds, 2);
                });
                const stdDevSeconds = Math.sqrt(varianceSq / stats.timeTrackedCount);
                
                const formatHms = (secs) => {
                    const h = Math.floor(secs / 3600);
                    const m = Math.floor((secs % 3600) / 60);
                    return h > 0 ? `${h}h ${m}m` : `${m}m`;
                };

                timeStr = `${formatHms(avgSeconds)} (± ${formatHms(stdDevSeconds)}) / task`;
            }
            
            let daysStr = '-- days / task';
            if (stats.daysCount > 0) {
                const avgDays = stats.totalDays / stats.daysCount;
                
                let varianceDaysSq = 0;
                stats.daysToCompleteList.forEach(d => {
                    varianceDaysSq += Math.pow(d - avgDays, 2);
                });
                const stdDevDays = Math.sqrt(varianceDaysSq / stats.daysCount).toFixed(1);
                
                daysStr = `${avgDays.toFixed(1)} (± ${stdDevDays}) days / task`;
            }
            
            const div = document.createElement('div');
            div.className = 'task-duration-item';
            
            div.innerHTML = `
                <div>
                    <div class="task-name">${p}</div>
                    <div class="task-project">${stats.count} task${stats.count !== 1 ? 's' : ''}</div>
                </div>
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.25rem;">
                    <span style="font-size: 0.8rem; color: #94a3b8;">${daysStr}</span>
                    <div class="task-time">${timeStr}</div>
                </div>
            `;
            listContainer.appendChild(div);
        });
    }

    renderProductivityTrendChart(productiveEntries, controlEntries, buckets) {
        const canvas = document.getElementById('productivityTrendChart');
        if (this.charts.productivityTrend) {
            this.charts.productivityTrend.destroy();
        }

        const labels = buckets.map(b => b.label);
        
        // Aggregate
        const prodMap = {};
        productiveEntries.forEach(e => {
            const key = this.getBucketKey(e.date, this.currentGranularity);
            if (key) prodMap[key] = (prodMap[key] || 0) + (e.duration || 0);
        });
        
        const ctrlMap = {};
        controlEntries.forEach(e => {
            const key = this.getBucketKey(e.date, this.currentGranularity);
            if (key) ctrlMap[key] = (ctrlMap[key] || 0) + (e.duration || 0);
        });
        
        const prodData = buckets.map(b => ((prodMap[b.key] || 0) / 3600).toFixed(2));
        const ctrlData = buckets.map(b => ((ctrlMap[b.key] || 0) / 3600).toFixed(2));

        this.charts.productivityTrend = new Chart(canvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Productive Time',
                        data: prodData,
                        borderColor: '#22c55e', // Success Green
                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                        borderWidth: 3,
                        tension: 0.3,
                        fill: true,
                        pointBackgroundColor: '#22c55e',
                        pointBorderColor: '#fff',
                        pointRadius: 4,
                        pointHoverRadius: 6
                    },
                    {
                        label: 'Habit Control Time',
                        data: ctrlData,
                        borderColor: '#ef4444', // Danger Red
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        borderWidth: 3,
                        borderDash: [5, 5],
                        tension: 0.3,
                        fill: false,
                        pointBackgroundColor: '#ef4444',
                        pointBorderColor: '#fff',
                        pointRadius: 4,
                        pointHoverRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Hours',
                            color: '#94a3b8'
                        },
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                        ticks: { color: '#94a3b8' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { 
                            color: '#94a3b8',
                            maxTicksLimit: 15
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: '#e2e8f0',
                            font: { size: 13, weight: '500' },
                            usePointStyle: true,
                            padding: 20
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                        titleColor: '#fff',
                        bodyColor: '#cbd5e1',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: function(context) {
                                return ` ${context.dataset.label}: ${context.raw} hrs`;
                            }
                        }
                    }
                }
            }
        });
        this.charts.productivityTrend.update();
    }

    async syncVaultDirectly() {
        if (!window.__TAURI__) return;
        const { invoke } = window.__TAURI__.tauri;
        let vaultPath = await invoke('get_stored_vault_path');
        if (!vaultPath) vaultPath = localStorage.getItem('vaultPath');
        if (!vaultPath) return;

        try {
            const entries = await invoke('read_vault_dir', { path: vaultPath });
            const projects = [];
            const tasks = [];
            
            for (const entry of entries) {
                if (!entry.children) continue;
                
                const projModel = { name: entry.name, properties: {}, tasks: [] };
                let projectFile = entry.children.find(c => c.name === entry.name + '.md' && !c.children);
                
                if (projectFile) {
                    const fmMatch = projectFile.content.match(/^---\n([\s\S]*?)\n---/);
                    if (fmMatch && typeof jsyaml !== 'undefined') {
                        try {
                            const props = jsyaml.load(fmMatch[1]) || {};
                            if (props.type === 'project' || props.type === 'control') projModel.properties = props;
                        } catch(e) {}
                    }
                }
                
                projects.push(projModel);

                const expFolder = entry.children.find(c => c.name === 'experiments' && c.children);
                if (expFolder) {
                    for (const exp of expFolder.children) {
                        if (exp.name.endsWith('.md')) {
                            const taskRegex = /^[\s]*[-*]\s+\[([ xX])\]\s+(.+)$/gm;
                            let match;
                            while ((match = taskRegex.exec(exp.content)) !== null) {
                                let tText = match[2].trim();
                                
                                const task = {
                                    completed: match[1].toLowerCase() === 'x',
                                    project: entry.name,
                                    text: tText
                                };
                                
                                const targetMatch = tText.match(/@target\(([^/]+)\s*\/\s*([^)]+)\)/);
                                if (targetMatch) {
                                    task.target = { 
                                        limitSeconds: (targetMatch[1].includes('hr') ? parseFloat(targetMatch[1])*3600 : targetMatch[1].includes('min') ? parseFloat(targetMatch[1])*60 : parseFloat(targetMatch[1])), 
                                        period: targetMatch[2].includes('week') ? 'week' : targetMatch[2].includes('month') ? 'month' : 'day' 
                                    };
                                    tText = tText.replace(/@target\([^)]+\)/, '').trim();
                                }
                                
                                const startedMatch = tText.match(/🛫\s+(\d{4}-\d{2}-\d{2})/);
                                if (startedMatch) { task.startedDate = startedMatch[1]; tText = tText.replace(/🛫\s+\d{4}-\d{2}-\d{2}/, '').trim(); }
                                
                                const doneMatch = tText.match(/✅\s+(\d{4}-\d{2}-\d{2})/);
                                if (doneMatch) { task.doneDate = doneMatch[1]; tText = tText.replace(/✅\s+\d{4}-\d{2}-\d{2}/, '').trim(); }
                                
                                task.text = tText;
                                tasks.push(task);
                            }
                        }
                    }
                }
            }
            
            this.vaultData = { projects, tasks };
            
            const plannerJson = await invoke('load_planner_data');
            if (plannerJson) {
                this.plannerData = JSON.parse(plannerJson);
            }
            
        } catch(e) {
            console.warn('Native vault synchronization failed inline', e);
        }
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const reportApp = new ReportDashboard();
    reportApp.init();
});
