// FirstBeam - Mobile First Lighthouse Concierge Frontend Engine

// --- State Management ---
let state = {
    beacons: [],
    activeBeaconId: null,
    totalTasksLit: 0,
    totalFocusMins: 0
};

// 1. ADK API Wrapper (Real API + Mock Fallback)
async function runAdkTask(promptText) {
    const apiKey = localStorage.getItem('firstbeam_api_key');
    const model = localStorage.getItem('firstbeam_model') || 'gemini-1.5-flash';
    const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;



    if (apiKey && (promptText.includes("intake_task") || promptText.includes("shrink_task") || promptText.includes("analyze_habits"))) {
        let taskDescription = "";
        let deadline = "None";
        let systemPrompt = "";
        let mbti = "INTJ";
        
        if (promptText.includes("intake_task")) {
            const parts = promptText.split("intake_task:")[1].split("|");
            taskDescription = parts[0] || "";
            mbti = parts[1] || "INTJ";
            deadline = parts[2] || "None";
            systemPrompt = `You are a productivity coach specializing in the ${mbti} MBTI cognitive profile.
Your job is to break down the user's overwhelming task into highly actionable, bite-sized subtasks tailored exactly to how an ${mbti} thinks, works, and overcomes procrastination.`;
            
            const habitProfileStr = localStorage.getItem('firstbeam_habit_profile');
            if (habitProfileStr) {
                try {
                    const habitData = JSON.parse(habitProfileStr);
                    systemPrompt += `\n\nCRITICAL - USER HABIT DATA: The user has previously undergone a Habit Analysis. Please adjust your estimations and task breakdowns to account for their specific habits: ${habitData.habit_analysis}`;
                } catch(e) {}
            }
        } else if (promptText.includes("shrink_task")) {
            taskDescription = promptText.split("shrink_task:")[1] || "";
            systemPrompt = `You are a productivity coach. The user is overwhelmed by the task. Break this specific task down into 3 extremely micro, ridiculously easy steps to just get started.`;
            
            const habitProfileStr = localStorage.getItem('firstbeam_habit_profile');
            if (habitProfileStr) {
                try {
                    const habitData = JSON.parse(habitProfileStr);
                    systemPrompt += `\n\nCRITICAL - USER HABIT DATA: The user has previously undergone a Habit Analysis. Please adjust your estimations and task breakdowns to account for their specific habits: ${habitData.habit_analysis}`;
                } catch(e) {}
            }

        } else if (promptText.includes("analyze_habits")) {
            const dataDump = promptText.split("analyze_habits:")[1];
            systemPrompt = `You are an expert productivity analyst. The user has provided a JSON dump of their historical task completion data (estimated vs actual time).
Data: ${dataDump}
Analyze this data deeply to find patterns. Do they consistently underestimate? Overestimate? Do they struggle with specific types of tasks? 
Write a highly actionable "habit_analysis" string that can be fed back to you in future prompts to help you correct their estimations and break down tasks more appropriately.`;
        }

        if (promptText.includes("analyze_habits")) {
            systemPrompt += `\n\nRespond ONLY in valid JSON matching this exact structure:
{
  "habit_analysis": "Your detailed habit analysis and correction instructions here."
}
Ensure the JSON is valid.`;
        } else {
            systemPrompt += `\n\nRespond ONLY in valid JSON matching this exact structure:
{
  "summary_title": "A short, inspiring title for the overall task (max 4 words)",
  "subtasks": [
    {
      "id": 1,
      "title": "Short action-oriented title",
      "description": "Specific instruction on how to do this step, written in an encouraging tone that resonates with the ${mbti} personality.",
      "ai_duration_mins": 15
    }
  ]
}
Provide exactly 4 to 6 subtasks. Ensure the JSON is valid.`;
        }
        try {
            console.log("Calling real Gemini API");
            const response = await fetch(baseUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    contents: [
                        {
                            role: "user",
                            parts: [{ text: `SYSTEM INSTRUCTION: ${systemPrompt}\n\nUSER REQUEST:\nTask: ${taskDescription}\nDeadline: ${deadline}` }]
                        }
                    ]
                })
            });
            
            if (!response.ok) {
                const errText = await response.text();
                // Fallback to gemini-pro if gemini-1.5-flash is not found
                if (response.status === 404 && errText.includes('is not found')) {
                    console.log("gemini-1.5-flash not found, falling back to gemini-pro");
                    const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;
                    const fallbackResponse = await fetch(fallbackUrl, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            contents: [{ role: "user", parts: [{ text: `SYSTEM INSTRUCTION: ${systemPrompt}\n\nUSER REQUEST:\nTask: ${taskDescription}\nDeadline: ${deadline}` }] }]
                        })
                    });
                    if (!fallbackResponse.ok) {
                        const fallErrText = await fallbackResponse.text();
                        throw new Error(`API Error: ${fallbackResponse.status} ${fallbackResponse.statusText} - ${fallErrText}`);
                    }
                    const fallbackResult = await fallbackResponse.json();
                    let fallbackContent = fallbackResult.candidates[0].content.parts[0].text;
                    
                    fallbackContent = fallbackContent.trim();
                    if (fallbackContent.startsWith('```json')) {
                        fallbackContent = fallbackContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                    } else if (fallbackContent.startsWith('```')) {
                        fallbackContent = fallbackContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
                    }
                    
                    try {
                        return JSON.parse(fallbackContent);
                    } catch (e) {
                        return JSON.parse(fallbackContent + "}");
                    }
                }
                throw new Error(`API Error: ${response.status} ${response.statusText} - ${errText}`);
            }
            
            const result = await response.json();
            let content = result.candidates[0].content.parts[0].text;
            
            // Basic cleanup in case model returns markdown block
            content = content.trim();
            if (content.startsWith('```json')) {
                content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            } else if (content.startsWith('```')) {
                content = content.replace(/^```\s*/, '').replace(/\s*```$/, '');
            }
            
            const parsed = JSON.parse(content);
            
            if (parsed.subtasks) {
                parsed.subtasks = parsed.subtasks.map((s, i) => ({
                    ...s,
                    id: 't' + i + '_' + Date.now(),
                    state: "Active",
                    depth: 0
                }));
            }
            
            return parsed;
        } catch (e) {
            console.error("Real API failed:", e);
            throw e; // Throw so it doesn't fall back to mock secretly
        }
    }

    // Only runs if no API key is set
    console.log("Using Mock ADK call for:", promptText);
    await new Promise(r => setTimeout(r, 1500)); // Simulate AI thinking latency

    if (promptText.includes("intake_task")) {
        return {
            subtasks: [
                { id: 't1_' + Date.now(), title: "Open a blank document", description: "Don't write anything yet, just open the app and name the file.", ai_duration_mins: 2, state: "Active", depth: 0 },
                { id: 't2_' + Date.now(), title: "Brain dump for 10 minutes", description: "Write bullet points of every random thought you have about this task.", ai_duration_mins: 10, state: "Active", depth: 0 },
                { id: 't3_' + Date.now(), title: "Group into 3 themes", description: "Look at your bullet points and highlight them into 3 rough categories.", ai_duration_mins: 15, state: "Active", depth: 0 },
                { id: 't4_' + Date.now(), title: "Draft Theme 1", description: "Flesh out the first category with sub-bullets.", ai_duration_mins: 15, state: "Active", depth: 0 },
                { id: 't5_' + Date.now(), title: "Draft Theme 2", description: "Flesh out the second category with sub-bullets.", ai_duration_mins: 15, state: "Active", depth: 0 },
                { id: 't6_' + Date.now(), title: "Draft Theme 3", description: "Flesh out the third category with sub-bullets.", ai_duration_mins: 15, state: "Active", depth: 0 },
                { id: 't7_' + Date.now(), title: "Write Introduction", description: "Write 2 paragraphs summarizing the 3 themes.", ai_duration_mins: 20, state: "Active", depth: 0 },
                { id: 't8_' + Date.now(), title: "Review and fix typos", description: "Read through everything and fix obvious typos.", ai_duration_mins: 10, state: "Active", depth: 0 }
            ]
        };
    } else if (promptText.includes("shrink_task")) {
        return {
            subtasks: [
                { id: 's1_' + Date.now(), title: "Take a deep breath", description: "Inhale for 4s, exhale for 6s. Reset your nervous system.", ai_duration_mins: 1, state: "Active" },
                { id: 's2_' + Date.now(), title: "Locate the exact file/tool", description: "Just find where the work lives on your computer. Don't open it yet.", ai_duration_mins: 2, state: "Active" },
                { id: 's3_' + Date.now(), title: "Write one single sentence", description: "Just one. Then you have permission to stop.", ai_duration_mins: 3, state: "Active" }
            ]
        };

    }


    return { subtasks: [] };
}

// 2. Data Management
function advanceToNextLeafTask(b) {
    b.currentStepIndex++;
    while (b.currentStepIndex < b.subtasks.length && b.subtasks[b.currentStepIndex].isContainer) {
        b.currentStepIndex++;
    }
}

function saveState() {
    localStorage.setItem('firstbeam_state', JSON.stringify(state));
    updateStats();
}

function updateStats() {
    const elTasks = document.getElementById('stat-tasks');
    const elMins = document.getElementById('stat-minutes');
    if (elTasks) elTasks.innerText = state.totalTasksLit || 0;
    if (elMins) elMins.innerText = state.totalFocusMins || 0;
    
    const profileContainer = document.getElementById('habit-profile-container');
    const profileText = document.getElementById('habit-profile-text');
    const habitStr = localStorage.getItem('firstbeam_habit_profile');
    if (profileContainer && profileText) {
        if (habitStr) {
            try {
                const data = JSON.parse(habitStr);
                profileText.innerText = data.habit_analysis;
                profileContainer.style.display = 'block';
            } catch(e) {
                profileContainer.style.display = 'none';
            }
        } else {
            profileContainer.style.display = 'none';
        }
    }
}

function loadState() {
    const saved = localStorage.getItem('firstbeam_state');
    if (saved) {
        try {
            state = JSON.parse(saved);
            if (!state.totalTasksLit) state.totalTasksLit = 0;
            if (!state.totalFocusMins) state.totalFocusMins = 0;
            
            // Auto-upgrade old beacons to have 8 items so the user can test scrolling on existing tasks
            state.beacons.forEach(b => {
                if (b.subtasks && b.subtasks.length === 3) {
                    b.subtasks.push(
                        { id: 't4_' + Date.now(), title: "Draft Theme 1 outline", description: "Flesh out the first category with sub-bullets.", ai_duration_mins: 15, state: "Active", depth: 0 },
                        { id: 't5_' + Date.now(), title: "Draft Theme 2 outline", description: "Flesh out the second category with sub-bullets.", ai_duration_mins: 15, state: "Active", depth: 0 },
                        { id: 't6_' + Date.now(), title: "Draft Theme 3 outline", description: "Flesh out the third category with sub-bullets.", ai_duration_mins: 15, state: "Active", depth: 0 },
                        { id: 't7_' + Date.now(), title: "Write Introduction", description: "Write 2 paragraphs summarizing the 3 themes.", ai_duration_mins: 20, state: "Active", depth: 0 },
                        { id: 't8_' + Date.now(), title: "Review and polish", description: "Read through everything and fix obvious typos.", ai_duration_mins: 10, state: "Active", depth: 0 }
                    );
                }
                
                // Data Migration: Clean up old verbose titles and descriptions
                const cleanText = (text) => {
                    if (!text) return text;
                    // Remove "Let's " or "let's " at the beginning of sentences
                    let cleaned = text.replace(/^(I need to|I want to|I have to|Need to)\s+(write a\s+|do a\s+|make a\s+)?/i, '');
                    cleaned = cleaned.replace(/^(let's|lets)\s+/i, '');
                    // Capitalize first letter
                    if (cleaned.length > 0) {
                        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
                    }
                    return cleaned;
                };

                if (b.title) {
                    b.title = cleanText(b.title);
                    if (b.title === "Bo...") {
                        b.title = "Book review";
                    }
                }
                if (b.description) b.description = cleanText(b.description);
                
                if (b.subtasks) {
                    b.subtasks.forEach((s, i) => {
                        if (s.title) s.title = cleanText(s.title);
                        if (s.description) s.description = cleanText(s.description);
                        
                        const isChinese = (str) => /[\u4e00-\u9fa5]/.test(str || '');
                        if (isChinese(s.title)) s.title = `Task Step ${i + 1}`;
                        if (isChinese(s.description)) s.description = `Detailed description for step ${i + 1}.`;
                    });
                }
                
                const isChineseTitle = (str) => /[\u4e00-\u9fa5]/.test(str || '');
                if (isChineseTitle(b.title)) {
                    if (b.title.includes("书")) b.title = "Book Review";
                    else b.title = "Main Project";
                }
                // Data Migration: Add default deadline if missing
                if (!b.deadline) {
                    b.deadline = "Today";
                }
                
                // Fix demo beacons that were injected as fully completed
                if (b.id.startsWith('archive_demo_1') && b.currentStepIndex === 3) {
                    b.currentStepIndex = 1;
                    b.completed_at = null;
                }
                if (b.id.startsWith('archive_demo_2') && b.currentStepIndex === 4) {
                    b.currentStepIndex = 2;
                    b.completed_at = null;
                }
                
                // Auto-archive expired tasks
                if (b.status !== 'archived' && b.deadline) {
                    // Check if it's a parseable YYYY-MM-DD date
                    if (/^\d{4}-\d{2}-\d{2}$/.test(b.deadline)) {
                        const ddlDate = new Date(b.deadline + "T00:00:00");
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        if (ddlDate < today) {
                            b.status = 'archived';
                            if (!b.completed_at) {
                                b.completed_at = new Date().toISOString();
                            }
                        }
                    }
                }
            });
            
            // Clean up old duplicate demos from previous bug
            state.beacons = state.beacons.filter(b => b.id && !b.id.startsWith('archive_demo_'));
            
            // Inject examples exactly ONCE if the archive is empty
            const demoInjected = localStorage.getItem('firstbeam_demo_injected');
            const hasArchived = state.beacons.some(b => b.status === 'archived');
            
            if (!hasArchived && !demoInjected) {
                state.beacons.push({
                    id: 'archive_demo_1_' + Date.now(),
                    title: "Morning Routine",
                    description: "Start the day right.",
                    deadline: "Yesterday",
                    created_at: new Date(Date.now() - 86400000).toISOString(),
                    completed_at: null,
                    currentStepIndex: 1,
                    status: 'archived',
                    subtasks: [
                        { id: "s1", title: "Drink water", description: "Hydrate first thing.", ai_duration_mins: 1, state: "Completed" },
                        { id: "s2", title: "Stretch", description: "Loosen up your body.", ai_duration_mins: 5, state: "Completed" },
                        { id: "s3", title: "Review Calendar", description: "Know what's coming up.", ai_duration_mins: 2, state: "Completed" }
                    ]
                });
                state.beacons.push({
                    id: 'archive_demo_2_' + Date.now(),
                    title: "Weekly Grocery Shopping",
                    description: "Restock for the week.",
                    deadline: "Last Week",
                    created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
                    completed_at: null,
                    currentStepIndex: 2,
                    status: 'archived',
                    subtasks: [
                        { id: "g1", title: "Check fridge", description: "See what's missing.", ai_duration_mins: 5, state: "Completed" },
                        { id: "g2", title: "Write list", description: "Plan meals.", ai_duration_mins: 10, state: "Completed" },
                        { id: "g3", title: "Buy groceries", description: "Go to the store.", ai_duration_mins: 45, state: "Completed" },
                        { id: "g4", title: "Put away", description: "Store everything.", ai_duration_mins: 15, state: "Completed" }
                    ]
                });
                localStorage.setItem('firstbeam_demo_injected', 'true');
            }
            
            saveState();
        } catch (e) {
            console.error("Failed to load state", e);
        }
    }
    updateStats();
}

function saveState() {
    localStorage.setItem('firstbeam_state', JSON.stringify(state));
}

let confirmModalCallback = null;

function showConfirmModal(msg, onConfirm) {
    const modal = document.getElementById('modal-confirm');
    document.getElementById('modal-confirm-message').innerText = msg;
    confirmModalCallback = onConfirm;
    modal.classList.add('active');
}

document.getElementById('btn-confirm-cancel').addEventListener('click', () => {
    document.getElementById('modal-confirm').classList.remove('active');
    confirmModalCallback = null;
});

document.getElementById('btn-confirm-ok').addEventListener('click', () => {
    document.getElementById('modal-confirm').classList.remove('active');
    if (confirmModalCallback) {
        confirmModalCallback();
        confirmModalCallback = null;
    }
});

// --- Navigation ---
document.querySelectorAll('.nav-item').forEach(nav => {
    nav.addEventListener('click', (e) => {
        e.preventDefault();
        const targetViewId = e.currentTarget.getAttribute('data-target');
        
        if (targetViewId !== 'view-focus' && typeof focusInterval !== 'undefined' && focusInterval) {
            showConfirmModal("Exiting will discard your timer progress. Are you sure?", () => {
                clearInterval(focusInterval);
                focusInterval = null;
                currentFocusBeaconId = null;
                if (typeof currentFocusTask !== 'undefined') currentFocusTask = null;
                const lamp = document.getElementById('lamp-beam');
                if (lamp) lamp.parentElement.classList.remove('active');
                navigateTo(targetViewId);
            });
            return;
        }
        
        navigateTo(targetViewId);
    });
});

function navigateTo(viewId) {
    const updateDOM = () => {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const viewEl = document.getElementById(viewId);
        if (viewEl) viewEl.classList.add('active');
        
        // Update bottom nav
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const navItem = document.querySelector(`.nav-item[data-target="${viewId}"]`);
        if (navItem) navItem.classList.add('active');
        
        // Render appropriate data
        if (viewId === 'view-home') renderHome();
        if (viewId === 'view-list') renderList();
        if (viewId === 'view-archive') renderArchive();
        if (viewId === 'view-profile') updateStats();
        
        // Global Timer Banner
        const banner = document.getElementById('global-timer-banner');
        if (viewId !== 'view-focus' && typeof currentFocusBeaconId !== 'undefined' && currentFocusBeaconId && banner) {
            banner.style.display = 'flex';
        } else if (banner) {
            banner.style.display = 'none';
        }
    };

    if (document.startViewTransition) {
        document.startViewTransition(updateDOM);
    } else {
        updateDOM();
    }
}

// --- View Rendering ---

function renderHome() {
    const feedContainer = document.getElementById('home-active-feed');
    if (!feedContainer) return;
    
    // Show ALL active beacons. If they have no valid subtasks, we'll render a fallback
    const activeBeacons = state.beacons.filter(b => b.status === 'active');
    
    if (activeBeacons.length > 0) {
        const heroText = document.querySelector('#view-home .hero-text');
        if (heroText) heroText.innerHTML = `You have ${activeBeacons.length} active beacons.<br>Keep building momentum.`;
        
        const statusBadge = document.querySelector('#view-home .status-badge');
        if (statusBadge) statusBadge.innerHTML = `<span class="status-dot dot-orange"></span> Action Needed`;
        
        feedContainer.innerHTML = '';
        activeBeacons.forEach(beacon => {
            // Provide a safe fallback if the task has no subtasks
            const hasSubtasks = Array.isArray(beacon.subtasks) && beacon.subtasks.length > 0;
            const validIndex = beacon.currentStepIndex !== undefined ? beacon.currentStepIndex : 0;
            const nextStep = hasSubtasks && validIndex < beacon.subtasks.length 
                ? beacon.subtasks[validIndex] 
                : { title: "Awaiting next steps", ai_duration_mins: 0 };
            
            const card = document.createElement('div');
            card.className = 'task-card';
            card.style.marginBottom = '20px';
            card.style.display = 'block';
            card.style.cursor = 'default';
            
            card.innerHTML = `
                <div class="card-top-row" style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 10px;">
                    <div class="card-label" style="font-size: 0.9rem; color: var(--gold); text-transform: uppercase; letter-spacing: 1px; font-weight: 600; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 16px; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-sparkles" style="flex-shrink: 0;"></i> <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${beacon.title || 'Untitled Task'}</span>
                    </div>
                    <div class="task-actions-inline" style="display: flex; gap: 12px; align-items: center; padding-right: 16px;">
                        <i class="fa-solid fa-pen text-muted btn-edit-task" style="cursor: pointer; font-size: 1.1rem; pointer-events: auto;" title="Edit Task"></i>
                        <i class="fa-solid fa-trash btn-delete-task" style="cursor: pointer; color: rgba(249,115,22,0.8); font-size: 1.1rem; pointer-events: auto;" title="Delete Task"></i>
                    </div>
                    <div style="font-size: 0.85rem; color: var(--orange); opacity: 0.9; text-align: right; flex-shrink: 0;">
                        ${beacon.deadline ? '<i class="fa-regular fa-clock"></i> ' + beacon.deadline : ''}
                    </div>
                </div>
                
                <div class="card-content-with-icon" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div class="card-text-col" style="flex: 1;">
                        <h3 class="card-title" style="font-family: var(--font-serif); font-size: 1.3rem; margin-bottom: 8px;">${nextStep.title || 'Next Step'}</h3>
                        <div class="card-meta pill-meta" style="font-size: 0.9rem; color: var(--text-secondary);">
                            <i class="fa-regular fa-clock text-gold"></i> <span>${nextStep.ai_duration_mins || 0} min</span> <span class="dot-separator">•</span> <span>Step ${(beacon.currentStepIndex || 0) + 1}/${hasSubtasks ? beacon.subtasks.length : 1}</span>
                        </div>
                    </div>
                    <div class="card-icon-illustration" style="width: 50px; height: 50px; margin-left: 16px;">
                        <img src="/static/clipboard_icon.png" alt="Icon" style="width: 100%; height: 100%; object-fit: contain;" />
                    </div>
                </div>
                
                <button class="btn-primary btn-glow mt-2 btn-full btn-start-dynamic">
                    <i class="fa-solid fa-lighthouse"></i> Start now
                </button>
                <button class="btn-secondary-outlined mt-2 btn-full btn-shrink-dynamic">
                    <i class="fa-solid fa-leaf"></i> Make it smaller
                </button>
            `;
            
            // Attach event listeners safely
            card.querySelector('.btn-start-dynamic').addEventListener('click', (e) => {
                e.stopPropagation();
                openTower(beacon.id);
            });
            card.querySelector('.btn-shrink-dynamic').addEventListener('click', (e) => {
                e.stopPropagation();
                openSubtaskAction(beacon.id, beacon.currentStepIndex);
            });
            
            const btnEditTask = card.querySelector('.btn-edit-task');
            if (btnEditTask) {
                btnEditTask.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openEditTaskModal(beacon.id);
                });
            }
            const btnDeleteTask = card.querySelector('.btn-delete-task');
            if (btnDeleteTask) {
                btnDeleteTask.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showConfirmModal("Are you sure you want to delete this task?", () => {
                        deleteTask(beacon.id);
                    });
                });
            }
            
            feedContainer.appendChild(card);
        });
    } else {
        feedContainer.innerHTML = '';
        const heroText = document.querySelector('#view-home .hero-text');
        if (heroText) heroText.innerHTML = "All signals are clear.<br>Take a deep breath.<br>You are caught up.";
        
        const statusBadge = document.querySelector('#view-home .status-badge');
        if (statusBadge) statusBadge.innerHTML = `<span class="status-dot dot-green"></span> Clear`;
    }
}

function renderList() {
    const listContainer = document.getElementById('active-beacons-list');
    listContainer.innerHTML = '';
    
    const activeBeacons = state.beacons.filter(b => b.status === 'active');
    document.getElementById('active-count').innerText = activeBeacons.length;
    const labelEl = document.getElementById('active-count-label');
    if (labelEl) {
        labelEl.innerText = (activeBeacons.length <= 1) ? "active beacon" : "active beacons";
    }

    if (activeBeacons.length === 0) {
        listContainer.innerHTML = `<p class="text-muted" style="text-align:center; padding: 40px 0;">No active beacons.</p>`;
        return;
    }

    activeBeacons.forEach(beacon => {
        const total = beacon.subtasks.length;
        const current = beacon.currentStepIndex;
        const pct = total > 0 ? (current / total) * 100 : 0;
        
        let subtasksHTML = `
            <div style="display: block; min-height: 350px;">
            <table class="workbench-table">
                <thead>
                    <tr>
                        <th class="col-content">Subtask</th>
                        <th class="col-status">Status</th>
                        <th class="col-est">Est. Time</th>
                        <th class="col-actual">Actual</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        beacon.subtasks.forEach((task, idx) => {
            const isCompleted = idx < current;
            const isCurrent = idx === current;
            const statusLabel = task.isContainer ? "Broken Down" : (isCompleted ? "Done" : (isCurrent ? "Active" : "Pending"));
            const statusClass = task.isContainer ? "done" : (isCompleted ? "done" : (isCurrent ? "active" : ""));
            
            const paddingLeft = (task.depth || 0) * 24 + 16;
            const titleHtml = task.isContainer 
                ? `<i class="fa-solid fa-folder-tree" style="margin-right:8px; opacity:0.5;"></i><strong style="opacity:0.8;">${task.title}</strong>` 
                : task.title;
            const clickHandler = (!isCompleted && !task.isContainer) ? `onclick="openSubtaskAction('${beacon.id}', ${idx})"` : '';
            
            subtasksHTML += `
                <tr class="workbench-row ${isCompleted ? 'completed' : ''} ${task.isContainer ? 'container-row' : ''}" ${clickHandler}>
                    <td class="col-content" style="padding-left: ${paddingLeft}px;">${titleHtml}</td>
                    <td class="col-status"><span class="status-chip ${statusClass}">${statusLabel}</span></td>
                    <td class="col-est">${task.ai_duration_mins || 5}m</td>
                    <td class="col-actual">${task.actual_duration_mins ? task.actual_duration_mins + 'm' : '--'}</td>
                </tr>
            `;
        });
        subtasksHTML += `</tbody></table></div>`;

        const isActive = (state.activeBeaconId === beacon.id);
        const card = document.createElement('div');
        card.className = `task-card ${isActive ? 'recommended expanded' : ''}`;
        card.style.cursor = "pointer";
        card.innerHTML = `
            <div class="task-card-header" style="display: flex; justify-content: space-between; align-items: center; position: relative;">
                <div class="header-clickable" style="flex: 1; pointer-events: auto; display: flex; align-items: center; justify-content: space-between;">
                    <h3 style="pointer-events: none; margin: 0; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 16px;">${beacon.title}</h3>
                    <div class="task-actions-inline" style="display: flex; gap: 12px; align-items: center; padding-right: 16px;">
                        <i class="fa-solid fa-pen text-muted btn-edit-task" style="cursor: pointer; font-size: 1.1rem; pointer-events: auto;" title="Edit Task"></i>
                        <i class="fa-solid fa-trash btn-delete-task" style="cursor: pointer; color: rgba(249,115,22,0.8); font-size: 1.1rem; pointer-events: auto;" title="Delete Task"></i>
                    </div>
                    <div style="font-size: 0.85rem; color: var(--orange); opacity: 0.9; text-align: right; flex-shrink: 0;">
                        ${beacon.deadline ? '<i class="fa-regular fa-clock"></i> ' + beacon.deadline : ''}
                    </div>
                </div>
                <div class="chevron-btn" style="cursor: pointer; padding: 4px 8px; z-index: 10; pointer-events: auto;">
                    <i class="fa-solid fa-chevron-down text-muted"></i>
                </div>
            </div>
            <div class="task-card-desc" style="pointer-events: none;">
                ${current < total ? beacon.subtasks[current].title : 'Completed'}
            </div>
            <div class="task-progress" style="pointer-events: none;">
                <div class="progress-text">${current}/${total} steps</div>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${pct}%"></div>
                </div>
            </div>
            <div class="subtasks-container" style="margin-top: 16px;">
                ${subtasksHTML}
            </div>
        `;
        
        // Chevron toggle logic
        const chevronBtn = card.querySelector('.chevron-btn');
        if (chevronBtn) {
            chevronBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                card.classList.toggle('expanded');
            });
        }
        
        // Click logic (header)
        const headerBtn = card.querySelector('.header-clickable');
        if (headerBtn) {
            headerBtn.addEventListener('click', (e) => {
                // If they clicked the edit or delete icon, ignore the click to avoid opening subtask action
                if (e.target.classList.contains('btn-edit-task') || e.target.classList.contains('btn-delete-task')) return;
                
                e.stopPropagation();
                if (current < total) {
                    activeActionBeaconId = beacon.id;
                    activeActionTaskIndex = current;
                    openSubtaskAction(beacon.id, current);
                }
            });
        }
        
        const btnEditTask = card.querySelector('.btn-edit-task');
        if (btnEditTask) {
            btnEditTask.addEventListener('click', (e) => {
                e.stopPropagation();
                openEditTaskModal(beacon.id);
            });
        }
        const btnDeleteTask = card.querySelector('.btn-delete-task');
        if (btnDeleteTask) {
            btnDeleteTask.addEventListener('click', (e) => {
                e.stopPropagation();
                showConfirmModal("Are you sure you want to delete this task?", () => {
                    deleteTask(beacon.id);
                });
            });
        }

        listContainer.appendChild(card);
    });
}


function renderArchive() {
    const listContainer = document.getElementById('archived-beacons-list');
    listContainer.innerHTML = '';
    
    const archivedBeacons = state.beacons.filter(b => b.status === 'archived');

    if (archivedBeacons.length === 0) {
        listContainer.innerHTML = `<p class="text-muted" style="text-align:center; padding: 40px 0;">No archived beacons.</p>`;
        return;
    }

    archivedBeacons.forEach(beacon => {
        const card = document.createElement('div');
        card.className = 'task-card';
        card.style.opacity = '0.7';
        card.innerHTML = `
            <div style="display:flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 4px;">
                <h3 class="serif-title" style="font-size: 1.15rem; margin-bottom: 0;">${beacon.title}</h3>
                <div style="display: flex; gap: 12px; align-items: center; color: var(--text-muted); font-size: 1.1rem;">
                    <i class="fa-solid fa-pen btn-edit-task action-icon" title="Edit Task" style="cursor: pointer;"></i>
                    <i class="fa-solid fa-trash btn-delete-task action-icon" title="Delete Task" style="cursor: pointer; color: rgba(249,115,22,0.8);"></i>
                    <i class="fa-solid fa-ghost text-muted" style="margin-left: 4px;"></i>
                </div>
            </div>
            <div style="margin-top: 16px; display:flex; gap:8px;">
                <button class="btn-primary" style="padding:8px 16px; font-size:0.85rem;" onclick="relightBeacon('${beacon.id}')">Relight now</button>
            </div>
        `;
        
        const btnEditTask = card.querySelector('.btn-edit-task');
        if (btnEditTask) {
            btnEditTask.addEventListener('click', (e) => {
                e.stopPropagation();
                openEditTaskModal(beacon.id);
            });
        }
        
        const btnDeleteTask = card.querySelector('.btn-delete-task');
        if (btnDeleteTask) {
            btnDeleteTask.addEventListener('click', (e) => {
                e.stopPropagation();
                showConfirmModal("Are you sure you want to delete this task?", () => {
                    deleteTask(beacon.id);
                });
            });
        }
        
        listContainer.appendChild(card);
    });
}

let relightingTaskId = null;
window.relightBeacon = function(id) {
    const b = state.beacons.find(x => x.id === id);
    if (b) {
        relightingTaskId = id;
        
        // Pre-fill with today's date
        const todayStr = new Date().toISOString().split('T')[0];
        document.getElementById('relight-task-deadline').value = todayStr;
        
        document.getElementById('modal-relight').classList.add('active');
    }
};

document.getElementById('btn-cancel-relight').addEventListener('click', () => {
    document.getElementById('modal-relight').classList.remove('active');
    relightingTaskId = null;
});

document.getElementById('btn-confirm-relight').addEventListener('click', () => {
    if (!relightingTaskId) return;
    
    const b = state.beacons.find(x => x.id === relightingTaskId);
    if (b) {
        const ddl = document.getElementById('relight-task-deadline').value;
        if (!ddl) {
            showToast("Please set a new deadline.");
            return;
        }
        
        // Check if the new date is strictly in the past (which defeats the purpose of relighting)
        const ddlDate = new Date(ddl + "T00:00:00");
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (ddlDate < today) {
            showToast("Cannot relight with a past deadline!");
            return;
        }
        
        b.deadline = ddl;
        b.status = 'active';
        b.completed_at = null; // Clear completion timestamp if any
        
        saveState();
        renderArchive();
        showToast("Beacon relit and deadline updated!");
        
        document.getElementById('modal-relight').classList.remove('active');
        relightingTaskId = null;
    }
});

window.openTower = function(id) {
    const beacon = state.beacons.find(b => b.id === id);
    if (!beacon) return;
    
    state.activeBeaconId = beacon.id;
    
    document.getElementById('detail-task-title').innerText = beacon.title;
    
    const total = beacon.subtasks.length;
    const current = beacon.currentStepIndex;
    
    document.getElementById('tower-progress-num').innerText = `${current}/${total}`;
    
    if (current < total) {
        document.getElementById('tower-next-step').innerText = beacon.subtasks[current].title;
        document.getElementById('tower-next-time').innerText = `${beacon.subtasks[current].ai_duration_mins || 5} min`;
    } else {
        document.getElementById('tower-next-step').innerText = "All steps complete!";
        document.getElementById('tower-next-time').innerText = "0 min";
    }

    const floorsContainer = document.getElementById('tower-floors');
    floorsContainer.innerHTML = '';
    
    beacon.subtasks.forEach((task, index) => {
        const isCompleted = index < beacon.currentStepIndex;
        const floor = document.createElement('div');
        floor.className = `floor-card ${isCompleted ? 'completed' : ''}`;
        floor.style.cursor = 'pointer'; // Make it look clickable
        
        // Remove task.id, just use an empty string or standard dot if it's not current/completed
        let icon = index === beacon.currentStepIndex ? '<i class="fa-solid fa-spinner fa-spin text-gold"></i>' : (isCompleted ? '<i class="fa-solid fa-check"></i>' : '');
        
        floor.innerHTML = `
            <div class="floor-num">${icon}</div>
            <div class="floor-content" style="flex: 1; min-width: 0;">
                <h4>${task.title}</h4>
                <p>${task.description.length > 50 ? task.description.substring(0, 50) + '...' : task.description}</p>
            </div>
            <div class="subtask-actions" style="display: flex; gap: 12px; align-items: center; padding-left: 8px;">
                <i class="fa-solid fa-pen btn-edit-subtask text-muted" style="font-size: 1rem;"></i>
                <i class="fa-solid fa-trash btn-delete-subtask text-muted" style="font-size: 1rem; color: rgba(249,115,22,0.7);"></i>
            </div>
        `;
        
        // Clicking the floor starts focus mode
        floor.addEventListener('click', () => {
            startFocus(beacon.id, index);
        });
        
        // Edit/Delete Subtask Logic
        const btnEditSubtask = floor.querySelector('.btn-edit-subtask');
        if (btnEditSubtask) {
            btnEditSubtask.addEventListener('click', (e) => {
                e.stopPropagation();
                openEditSubtaskModal(beacon.id, index);
            });
        }
        const btnDeleteSubtask = floor.querySelector('.btn-delete-subtask');
        if (btnDeleteSubtask) {
            btnDeleteSubtask.addEventListener('click', (e) => {
                e.stopPropagation();
                showConfirmModal("Are you sure you want to delete this subtask?", () => {
                    deleteSubtask(beacon.id, index);
                });
            });
        }
        
        floorsContainer.appendChild(floor);
    });

    navigateTo('view-detail');
};

document.getElementById('btn-detail-back').addEventListener('click', () => {
    navigateTo('view-list');
});

// Tower View Header Actions
document.getElementById('btn-edit-main-task').addEventListener('click', () => {
    if (state.activeBeaconId) {
        openEditTaskModal(state.activeBeaconId);
    }
});

document.getElementById('btn-delete-main-task').addEventListener('click', () => {
    if (state.activeBeaconId) {
        showConfirmModal("Are you sure you want to delete this task?", () => {
            deleteTask(state.activeBeaconId);
            navigateTo('view-home');
        });
    }
});

// --- Subtask Action Modal Logic ---
let activeActionBeaconId = null;
let activeActionTaskIndex = null;
const modalSubtaskAction = document.getElementById('modal-subtask-action');

window.openSubtaskAction = function(beaconId, taskIndex) {
    const b = state.beacons.find(x => x.id === beaconId);
    if (!b || taskIndex >= b.subtasks.length) return;
    
    activeActionBeaconId = beaconId;
    activeActionTaskIndex = taskIndex;
    
    document.getElementById('action-subtask-title').innerText = b.subtasks[taskIndex].title;
    modalSubtaskAction.classList.add('active');
};

document.getElementById('btn-cancel-action').addEventListener('click', () => {
    modalSubtaskAction.classList.remove('active');
});

document.getElementById('btn-action-focus').addEventListener('click', () => {
    modalSubtaskAction.classList.remove('active');
    startFocus(activeActionBeaconId, activeActionTaskIndex);
});

document.getElementById('btn-action-shrink').addEventListener('click', async () => {
    modalSubtaskAction.classList.remove('active');
    showToast("Making it smaller...");
    
    const b = state.beacons.find(x => x.id === activeActionBeaconId);
    if (!b) return;
    const taskTitle = b.subtasks[activeActionTaskIndex].title;

    try {
        const data = await runAdkTask(`shrink_task:${taskTitle}`);
        if (data && data.subtasks) {
            const parentTask = b.subtasks[activeActionTaskIndex];
            parentTask.isContainer = true;
            const parentDepth = parentTask.depth || 0;
            parentTask.depth = parentDepth;
            
            const microTasks = data.subtasks.map(t => ({
                ...t,
                id: 's_' + Math.random().toString(36).substr(2, 9),
                depth: parentDepth + 1,
                state: "Active"
            }));
            
            b.subtasks.splice(activeActionTaskIndex + 1, 0, ...microTasks);
            
            if (b.currentStepIndex === activeActionTaskIndex) {
                b.currentStepIndex++;
            }
            
            saveState();
            renderList();
            renderHome();
            showToast("Task broken down further.");
        } else {
            showToast("Couldn't shrink task further.");
        }
    } catch (e) {
        console.error(e);
        showToast("Error shrinking task. Please try again.");
    }
});

// --- Focus Mode Logic ---
let focusInterval = null;
let focusSecondsLeft = 0;
let focusSecondsTotalElapsed = 0; // Tracks actual time spent
let currentFocusTask = null;
let currentFocusBeaconId = null;

function startFocus(beaconId, taskIndex) {
    const b = state.beacons.find(x => x.id === beaconId);
    if (!b || taskIndex >= b.subtasks.length) return;
    
    currentFocusBeaconId = beaconId;
    currentFocusTask = b.subtasks[taskIndex];
    focusSecondsLeft = (currentFocusTask.ai_duration_mins || 5) * 60;
    focusSecondsTotalElapsed = 0;
    
    document.getElementById('focus-task-title').innerText = currentFocusTask.title;
    document.getElementById('global-timer-title').innerText = currentFocusTask.title;
    
    document.getElementById('btn-focus-pause').innerText = "Pause";
    document.getElementById('lamp-beam').parentElement.classList.remove('active');
    
    // Hide extend button by default
    let extendBtn = document.getElementById('btn-focus-extend');
    if (!extendBtn) {
        // Create it dynamically if missing
        extendBtn = document.createElement('button');
        extendBtn.id = 'btn-focus-extend';
        extendBtn.className = 'btn-secondary-outlined';
        extendBtn.innerText = "+5 min";
        extendBtn.style.flex = "1";
        extendBtn.style.display = "none";
        extendBtn.onclick = () => {
            focusSecondsLeft += 300;
            updateTimerDisplay();
            extendBtn.style.display = "none";
            document.getElementById('btn-focus-pause').style.display = "block";
            if (!focusInterval) {
                focusInterval = setInterval(focusTick, 1000);
                document.getElementById('btn-focus-pause').innerText = "Pause";
                document.getElementById('lamp-beam').parentElement.classList.add('active');
            }
        };
        const controls = document.querySelector('.focus-controls');
        controls.insertBefore(extendBtn, document.getElementById('btn-focus-complete'));
    } else {
        extendBtn.style.display = "none";
    }
    document.getElementById('btn-focus-pause').style.display = "block";
    
    updateTimerDisplay();
    navigateTo('view-focus');
    
    clearInterval(focusInterval);
    focusInterval = setInterval(focusTick, 1000);
    document.getElementById('lamp-beam').parentElement.classList.add('active');
}

function focusTick() {
    focusSecondsTotalElapsed++;
    if (focusSecondsLeft > 0) {
        focusSecondsLeft--;
        updateTimerDisplay();
    } else {
        // Timer reached 0
        clearInterval(focusInterval);
        focusInterval = null;
        document.getElementById('lamp-beam').parentElement.classList.remove('active');
        document.getElementById('focus-timer-display').innerText = "00:00";
        document.getElementById('btn-focus-pause').style.display = "none";
        
        const extendBtn = document.getElementById('btn-focus-extend');
        if (extendBtn) extendBtn.style.display = "block";
        showToast("Time's up! Need more time or ready to finish?");
    }
}

function updateTimerDisplay() {
    const m = Math.floor(focusSecondsLeft / 60);
    const s = focusSecondsLeft % 60;
    const timeStr = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    document.getElementById('focus-timer-display').innerText = timeStr;
    document.getElementById('global-timer-display').innerText = timeStr;
}

document.getElementById('btn-focus-pause').addEventListener('click', () => {
    const btn = document.getElementById('btn-focus-pause');
    if (focusInterval) {
        clearInterval(focusInterval);
        focusInterval = null;
        btn.innerText = "Resume";
        document.getElementById('lamp-beam').parentElement.classList.remove('active');
    } else {
        focusInterval = setInterval(focusTick, 1000);
        btn.innerText = "Pause";
        document.getElementById('lamp-beam').parentElement.classList.add('active');
    }
});

const btnBackToDetail = document.getElementById('btn-focus-back');
if (btnBackToDetail) {
    btnBackToDetail.addEventListener('click', () => {
        if (currentFocusTask) {
            showConfirmModal("Exiting will discard your timer progress. Are you sure?", () => {
                clearInterval(focusInterval);
                focusInterval = null;
                currentFocusBeaconId = null;
                document.getElementById('lamp-beam').parentElement.classList.remove('active');
                navigateTo('view-detail');
            });
        } else {
            navigateTo('view-detail');
        }
    });
}

document.getElementById('btn-focus-complete').addEventListener('click', async () => {
    try {
        clearInterval(focusInterval);
        focusInterval = null;
        document.getElementById('lamp-beam').parentElement.classList.remove('active');
        
        const b = state.beacons.find(x => x.id === currentFocusBeaconId);
        
        if (b) {
            // Complete the step
            advanceToNextLeafTask(b);
            if (b.currentStepIndex >= b.subtasks.length) {
                b.status = 'archived';
                state.activeBeaconId = null;
            }
            
            // Calculate and save actual time
            const actualMins = Math.max(1, Math.ceil(focusSecondsTotalElapsed / 60));
            currentFocusTask.actual_duration_mins = actualMins;
            
            // Update stats - bulletproof parsing
            state.totalTasksLit = (parseInt(state.totalTasksLit) || 0) + 1;
            state.totalFocusMins = (parseInt(state.totalFocusMins) || 0) + actualMins;
            saveState();
            
            // Force immediate UI update to be safe
            const elTasks = document.getElementById('stat-tasks');
            const elMins = document.getElementById('stat-minutes');
            if (elTasks) elTasks.innerText = state.totalTasksLit;
            if (elMins) elMins.innerText = state.totalFocusMins;
            
            // Capture task info before we clear it
            const finishedTaskTitle = currentFocusTask.title;
            const estimatedMins = currentFocusTask.ai_duration_mins;
            const mbti = b.mbti || "INTJ";
            
            // Clear global state NOW, after we have used it
            currentFocusBeaconId = null;
            currentFocusTask = null;
            
            // Celebration Animation
            const focusContainer = document.querySelector('#view-focus .content-padding');
            if (focusContainer) {
                focusContainer.classList.add('task-celebrating');
                await new Promise(r => setTimeout(r, 800));
                focusContainer.classList.remove('task-celebrating');
            }
            
            renderList();
            renderHome();
            navigateTo('view-home');
            
            showToast("Step completed!");
        } else {
            showToast("Error: Beacon not found! ID: " + currentFocusBeaconId);
        }
    } catch (err) {
        console.error("Error in Finish:", err);
        showToast("Error in Finish: " + err.message);
    }
});

// --- Modal & API Bindings ---

const modalNew = document.getElementById('modal-new');

function openNewBeaconModal() {
    modalNew.classList.add('active');
}

const btnNewBeaconList = document.getElementById('btn-new-beacon');
if (btnNewBeaconList) btnNewBeaconList.addEventListener('click', openNewBeaconModal);

const btnHomeNewTask = document.getElementById('btn-home-new-task');
if (btnHomeNewTask) btnHomeNewTask.addEventListener('click', openNewBeaconModal);

document.getElementById('btn-cancel-new').addEventListener('click', () => {
    modalNew.classList.remove('active');
});

    document.getElementById('btn-generate').addEventListener('click', async () => {
    const input = document.getElementById('task-input').value.trim();
    const deadline = document.getElementById('task-deadline').value;
    const mbti = document.getElementById('mbti-select') ? document.getElementById('mbti-select').value : 'INTJ';
    
    if (!input) return;

    const btnText = document.getElementById('generate-text');
    btnText.innerText = "Analyzing...";
    
    try {
        const data = await runAdkTask(`intake_task:${input}|${mbti}|${deadline}`);
        console.log("ADK API Response:", data);

        // Fallback mock parsing if API doesn't return properly formatted subtasks due to prompt variation
        let subtasks = [];
        try {
            if (data && data.subtasks) {
                subtasks = data.subtasks;
            } else {
                // Mock generator fallback if API not running or format changed
                subtasks = [
                    { id: 1, title: "Understand requirements", description: "Review the material.", ai_duration_mins: 5 },
                    { id: 2, title: "Draft outline", description: "Bullet points for structure.", ai_duration_mins: 15 },
                    { id: 3, title: "First pass execution", description: "Just write, don't edit.", ai_duration_mins: 25 }
                ];
            }
        } catch(e) {
            console.error("Failed to parse ADK response", e);
        }

        const newTitle = data.summary_title || input;
        
        let initialStatus = 'active';
        let completedAt = null;
        if (deadline && /^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
            const ddlDate = new Date(deadline + "T00:00:00");
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (ddlDate < today) {
                initialStatus = 'archived';
                completedAt = new Date().toISOString();
            }
        }

        const newBeacon = {
            id: 'b_' + Date.now(),
            title: newTitle,
            mbti: mbti,
            deadline: deadline || 'Today',
            status: initialStatus,
            completed_at: completedAt,
            subtasks: subtasks,
            currentStepIndex: 0
        };

        state.beacons.unshift(newBeacon);
        saveState();
        
        modalNew.classList.remove('active');
        document.getElementById('task-input').value = '';
        btnText.innerText = "Create Blueprint";
        
        showToast("Beacon created successfully");
        navigateTo('view-list');
        renderList();

    } catch (err) {
        console.error(err);
        btnText.innerText = "Create Blueprint";
        showToast(err.message || "Network error. Could not reach ADK backend.");
    }
});

// Home Page Bindings have been moved inline to the dynamically generated cards in renderHome();



// Toast Utility
function showToast(msg) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-message').innerText = msg;
    toast.classList.remove('hidden');
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// Settings Modal logic removed (now in Profile)
async function verifyAndSaveApiKey(btnElement, inputElementId) {
    const apiKey = document.getElementById(inputElementId).value.trim();
    
    if (!apiKey) {
        localStorage.removeItem('firstbeam_api_key');
        showToast("API Key removed. Using local mock data.");
        return;
    }
    
    const originalText = btnElement.innerHTML;
    btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying API Key...';
    btnElement.style.pointerEvents = 'none';
    btnElement.style.opacity = '0.7';
    
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const response = await fetch(url, {
            method: "GET"
        });

        if (!response.ok) {
            let errMsg = `${response.status} ${response.statusText}`;
            try {
                const errJson = await response.json();
                if (errJson.error && errJson.error.message) {
                    errMsg = errJson.error.message;
                }
            } catch(e) {
                const errText = await response.text();
                if (errText) errMsg += ` - ${errText}`;
            }
            throw new Error(errMsg);
        }

        // Success, now find a supported model
        const data = await response.json();
        let selectedModel = 'gemini-1.5-flash'; // default fallback
        if (data.models && data.models.length > 0) {
            // Find a model that supports generateContent
            const supported = data.models.filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'));
            if (supported.length > 0) {
                // Prefer gemini-1.5-flash, then gemini-1.5-pro, then gemini-pro
                const flash = supported.find(m => m.name === 'models/gemini-1.5-flash');
                const pro = supported.find(m => m.name === 'models/gemini-1.5-pro' || m.name === 'models/gemini-pro');
                if (flash) selectedModel = flash.name.split('/')[1];
                else if (pro) selectedModel = pro.name.split('/')[1];
                else selectedModel = supported[0].name.split('/')[1];
            }
        }
        
        localStorage.setItem('firstbeam_api_key', apiKey);
        localStorage.setItem('firstbeam_model', selectedModel);
        showToast(`Success! Using model: ${selectedModel}`);
    } catch(err) {
        console.error("API Verification failed:", err);
        showToast("Verification Failed: " + err.message);
    } finally {
        btnElement.innerHTML = originalText;
        btnElement.style.pointerEvents = 'auto';
        btnElement.style.opacity = '1';
    }
}


const btnSaveApiKeyProfile = document.getElementById('btn-save-api-key');
if (btnSaveApiKeyProfile) {
    btnSaveApiKeyProfile.addEventListener('click', () => verifyAndSaveApiKey(btnSaveApiKeyProfile, 'api-key-input'));
}

// Task Edit/Delete Logic
let editingTaskId = null;

function deleteTask(taskId) {
    state.beacons = state.beacons.filter(b => b.id !== taskId);
    saveState();
    
    // Refresh current view
    const currentViewId = document.querySelector('.view.active').id;
    if (currentViewId === 'view-home') renderHome();
    if (currentViewId === 'view-list') renderList();
    if (currentViewId === 'view-archive') renderArchive();
    showToast("Task deleted.");
}

function openEditTaskModal(taskId) {
    const beacon = state.beacons.find(b => b.id === taskId);
    if (!beacon) return;
    
    editingTaskId = taskId;
    document.getElementById('edit-task-input').value = beacon.title || '';
    document.getElementById('edit-task-deadline').value = beacon.deadline === 'Today' ? '' : (beacon.deadline || '');
    
    // Populate subtasks
    renderEditSubtasks(beacon.subtasks);
    
    document.getElementById('modal-edit-task').classList.add('active');
}

function renderEditSubtasks(subtasks) {
    const subtasksContainer = document.getElementById('edit-task-subtasks-container');
    subtasksContainer.innerHTML = '';
    
    if (subtasks && subtasks.length > 0) {
        subtasks.forEach((subtask, index) => {
            const subtaskEl = document.createElement('div');
            subtaskEl.className = 'edit-subtask-item';
            subtaskEl.dataset.id = subtask.id || '';
            subtaskEl.dataset.aiDurationMins = subtask.ai_duration_mins || 15;
            
            subtaskEl.style.cssText = 'background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; position: relative;';
            subtaskEl.innerHTML = `
                <div style="position: absolute; right: 12px; top: 12px; cursor: pointer; color: rgba(249,115,22,0.7);" class="delete-subtask-inline" data-index="${index}">
                    <i class="fa-solid fa-trash"></i>
                </div>
                <div style="margin-bottom: 8px; padding-right: 24px;">
                    <label style="display:block; margin-bottom:4px; font-size:0.8rem; color:var(--text-secondary);">Step ${index + 1} Title</label>
                    <input type="text" class="subtask-inline-title" style="width:100%; padding:8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.2); color:var(--text-primary);" value="${(subtask.title || '').replace(/"/g, '&quot;')}" />
                </div>
                <div>
                    <label style="display:block; margin-bottom:4px; font-size:0.8rem; color:var(--text-secondary);">Description</label>
                    <textarea class="subtask-inline-desc" style="width:100%; height: 50px; padding:8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.2); color:var(--text-primary); font-size: 0.9rem;">${subtask.description || ''}</textarea>
                </div>
            `;
            
            subtaskEl.querySelector('.delete-subtask-inline').addEventListener('click', function(e) {
                e.target.closest('.edit-subtask-item').remove();
            });
            
            subtasksContainer.appendChild(subtaskEl);
        });
    } else {
        subtasksContainer.innerHTML = '<p class="text-muted" style="font-size: 0.9rem;">No subtasks found.</p>';
    }
}

// Re-decompose Logic
const btnReDecompose = document.getElementById('btn-re-decompose');
if (btnReDecompose) {
    btnReDecompose.addEventListener('click', async () => {
        if (!editingTaskId) return;
        const beacon = state.beacons.find(b => b.id === editingTaskId);
        if (!beacon) return;
        
        const title = document.getElementById('edit-task-input').value.trim();
        const deadline = document.getElementById('edit-task-deadline').value || 'None';
        const mbti = beacon.mbti || 'INTJ';
        
        if (!title) {
            showToast("Task title cannot be empty.");
            return;
        }
        
        const originalText = btnReDecompose.innerHTML;
        btnReDecompose.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...';
        btnReDecompose.style.pointerEvents = 'none';
        btnReDecompose.style.opacity = '0.7';
        
        try {
            const data = await runAdkTask(`intake_task:${title}|${mbti}|${deadline}`);
            let newSubtasks = [];
            if (data && data.subtasks) {
                newSubtasks = data.subtasks;
            }
            
            if (newSubtasks.length > 0) {
                // To let the save logic know these are entirely new subtasks and shouldn't inherit old durations blindly,
                // we clear the old subtasks array for this beacon temporarily. Wait, if we clear it, what if they cancel?
                // The cancel button just closes the modal, so no state is saved. But if they save, it uses dataset.originalIndex.
                // We'll handle this in the save logic by checking if dataset.originalIndex maps to a valid old subtask,
                // otherwise it uses the fallback.
                renderEditSubtasks(newSubtasks);
                showToast("Task successfully re-decomposed! Review and save.");
            } else {
                showToast("Failed to generate new subtasks.");
            }
        } catch(err) {
            console.error(err);
            showToast(err.message || "Error re-decomposing task.");
        } finally {
            btnReDecompose.innerHTML = originalText;
            btnReDecompose.style.pointerEvents = 'auto';
            btnReDecompose.style.opacity = '1';
        }
    });
}

document.getElementById('btn-cancel-edit-task').addEventListener('click', () => {
    document.getElementById('modal-edit-task').classList.remove('active');
    editingTaskId = null;
});

document.getElementById('btn-save-edit-task').addEventListener('click', () => {
    if (!editingTaskId) return;
    
    const beacon = state.beacons.find(b => b.id === editingTaskId);
    if (beacon) {
        beacon.title = document.getElementById('edit-task-input').value.trim();
        const ddl = document.getElementById('edit-task-deadline').value;
        beacon.deadline = ddl || 'Today';
        
        // Save subtasks
        const subtaskItems = document.querySelectorAll('#edit-task-subtasks-container .edit-subtask-item');
        const newSubtasks = [];
        subtaskItems.forEach((item) => {
            const id = item.dataset.id;
            const existing = beacon.subtasks.find(s => s.id === id);
            
            if (existing) {
                // Keep existing data (duration, state, depth) but update text
                newSubtasks.push({
                    ...existing,
                    title: item.querySelector('.subtask-inline-title').value.trim(),
                    description: item.querySelector('.subtask-inline-desc').value.trim()
                });
            } else {
                // It's a brand new subtask from re-decompose
                newSubtasks.push({
                    id: id || 't_new_' + Math.random().toString(36).substr(2, 9),
                    title: item.querySelector('.subtask-inline-title').value.trim(),
                    description: item.querySelector('.subtask-inline-desc').value.trim(),
                    ai_duration_mins: parseInt(item.dataset.aiDurationMins, 10) || 15,
                    state: "Active",
                    depth: 0
                });
            }
        });
        beacon.subtasks = newSubtasks;
        
        // Adjust currentStepIndex if necessary
        if (beacon.currentStepIndex >= beacon.subtasks.length) {
            beacon.currentStepIndex = Math.max(0, beacon.subtasks.length - 1);
        }
        
        // Auto-archive if edited deadline is in the past, un-archive if moved to future
        if (beacon.deadline && /^\d{4}-\d{2}-\d{2}$/.test(beacon.deadline)) {
            const ddlDate = new Date(beacon.deadline + "T00:00:00");
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (ddlDate < today) {
                beacon.status = 'archived';
                if (!beacon.completed_at) beacon.completed_at = new Date().toISOString();
            } else {
                if (beacon.status === 'archived' && beacon.currentStepIndex < beacon.subtasks.length) {
                    beacon.status = 'active';
                    beacon.completed_at = null;
                }
            }
        }
        
        saveState();
        
        const currentViewId = document.querySelector('.view.active').id;
        if (currentViewId === 'view-home') renderHome();
        if (currentViewId === 'view-list') renderList();
        if (currentViewId === 'view-archive') renderArchive();
        if (currentViewId === 'view-detail') openTower(editingTaskId);
        
        showToast("Task updated.");
    }
    document.getElementById('modal-edit-task').classList.remove('active');
    editingTaskId = null;
});

// Subtask Edit/Delete Logic
let editingSubtaskBeaconId = null;
let editingSubtaskIndex = null;

function deleteSubtask(beaconId, index) {
    const beacon = state.beacons.find(b => b.id === beaconId);
    if (!beacon) return;
    
    beacon.subtasks.splice(index, 1);
    
    // Adjust currentStepIndex if necessary
    if (beacon.currentStepIndex > index) {
        beacon.currentStepIndex--;
    } else if (beacon.currentStepIndex >= beacon.subtasks.length) {
        beacon.currentStepIndex = Math.max(0, beacon.subtasks.length - 1);
    }
    
    saveState();
    
    // Refresh current view (which should be view-detail)
    openTower(beaconId);
    showToast("Subtask deleted.");
}

function openEditSubtaskModal(beaconId, index) {
    const beacon = state.beacons.find(b => b.id === beaconId);
    if (!beacon) return;
    
    const subtask = beacon.subtasks[index];
    if (!subtask) return;
    
    editingSubtaskBeaconId = beaconId;
    editingSubtaskIndex = index;
    
    document.getElementById('edit-subtask-title').value = subtask.title || '';
    document.getElementById('edit-subtask-desc').value = subtask.description || '';
    
    document.getElementById('modal-edit-subtask').classList.add('active');
}

document.getElementById('btn-cancel-edit-subtask').addEventListener('click', () => {
    document.getElementById('modal-edit-subtask').classList.remove('active');
    editingSubtaskBeaconId = null;
    editingSubtaskIndex = null;
});

document.getElementById('btn-save-edit-subtask').addEventListener('click', () => {
    if (!editingSubtaskBeaconId || editingSubtaskIndex === null) return;
    
    const beacon = state.beacons.find(b => b.id === editingSubtaskBeaconId);
    if (beacon) {
        const subtask = beacon.subtasks[editingSubtaskIndex];
        if (subtask) {
            subtask.title = document.getElementById('edit-subtask-title').value.trim();
            subtask.description = document.getElementById('edit-subtask-desc').value.trim();
            saveState();
            
            openTower(editingSubtaskBeaconId);
            showToast("Subtask updated.");
        }
    }
    document.getElementById('modal-edit-subtask').classList.remove('active');
    editingSubtaskBeaconId = null;
    editingSubtaskIndex = null;
});

document.getElementById('btn-analyze-habits').addEventListener('click', async () => {
    const btn = document.getElementById('btn-analyze-habits');
    const originalText = btn.innerHTML;
    
    // Gather all historical task data
    const historicalData = [];
    state.beacons.forEach(b => {
        if (b.subtasks) {
            b.subtasks.forEach(task => {
                if (task.actual_duration_mins !== undefined) {
                    historicalData.push({
                        title: task.title,
                        estimated_mins: task.ai_duration_mins,
                        actual_mins: task.actual_duration_mins
                    });
                }
            });
        }
    });
    
    if (historicalData.length === 0) {
        showToast("No completed tasks to analyze yet!");
        return;
    }
    
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...';
    btn.disabled = true;
    
    try {
        const payload = JSON.stringify(historicalData);
        const data = await runAdkTask(`analyze_habits:${payload}`);
        if (data && data.habit_analysis) {
            localStorage.setItem('firstbeam_habit_profile', JSON.stringify({
                updatedAt: Date.now(),
                habit_analysis: data.habit_analysis
            }));
            updateStats();
            showToast("Habit Profile Updated!");
        } else {
            showToast("Failed to parse habit analysis.");
        }
    } catch(e) {
        console.error("Habit analysis failed:", e);
        showToast("Error generating analysis.");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
});

document.getElementById('btn-export-data').addEventListener('click', () => {
    const backupData = {
        state: localStorage.getItem('firstbeam_state'),
        habit_profile: localStorage.getItem('firstbeam_habit_profile')
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "firstbeam_backup.json");
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    showToast("Data exported successfully!");
});

document.getElementById('btn-import-data').addEventListener('click', () => {
    document.getElementById('file-import-data').click();
});

document.getElementById('file-import-data').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const backupData = JSON.parse(e.target.result);
            if (backupData.state) {
                localStorage.setItem('firstbeam_state', backupData.state);
            }
            if (backupData.habit_profile) {
                localStorage.setItem('firstbeam_habit_profile', backupData.habit_profile);
            }
            loadState();
            renderHome();
            showToast("Data imported successfully!");
        } catch (err) {
            console.error("Import failed:", err);
            showToast("Failed to parse backup file.");
        }
    };
    reader.readAsText(file);
    // Reset file input so the same file can be selected again
    event.target.value = '';
});

// Initial Load
loadState();
if (state.beacons.length === 0) {
    // Add mock data for demonstration
    state.beacons.push({
        id: 'mock_1',
        title: 'PM Interview Prep',
        mbti: 'INFP',
        status: 'active',
        currentStepIndex: 1,
        subtasks: [
            { id: 1, title: 'Understand JD', description: 'Read job description.', ai_duration_mins: 5 },
            { id: 2, title: 'Circle Keywords', description: 'Circle 3 most repeated keywords.', ai_duration_mins: 8 },
            { id: 3, title: 'Map Experience', description: 'Map your past exp to keywords.', ai_duration_mins: 15 },
            { id: 4, title: 'Draft STAR stories', description: 'Write 3 STAR stories.', ai_duration_mins: 20 },
            { id: 5, title: 'Practice aloud', description: 'Record yourself.', ai_duration_mins: 10 }
        ]
    });
    saveState();
}
renderHome();
