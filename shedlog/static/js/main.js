// AM Shed-01 Loom Fault Logger — Client Controller
// Rewrote for robustness: clean autocomplete, safe DOM, error-first design

document.addEventListener("DOMContentLoaded", () => {

    // ─── Application State ───────────────────────────────────────────────────
    const state = {
        config: { machines: [], faults: [], remedies: [], employees: [], parts: [] },
        adminToken: localStorage.getItem("am_admin_token") || null,
        currentConfigType: "machines",
        charts: {},
        analyticsData: null
    };

    // Initialize Lucide Icons
    if (window.lucide) lucide.createIcons();

    // ─── Safe DOM Element Accessor ───────────────────────────────────────────
    function $id(id) {
        const el = document.getElementById(id);
        if (!el) console.warn(`[AM] Element not found: #${id}`);
        return el;
    }

    const el = {
        // Theme & admin
        themeToggleBtn:    $id("theme-toggle-btn"),
        adminPanelBtn:     $id("admin-panel-btn"),
        adminModal:        $id("admin-modal"),
        adminAuthPanel:    $id("admin-auth-panel"),
        adminConfigPanel:  $id("admin-config-panel"),
        adminPwInput:      $id("admin-pw-input"),
        authSubmitBtn:     $id("auth-submit-btn"),
        authErrorMsg:      $id("auth-error-msg"),
        logoutAdminBtn:    $id("logout-admin-btn"),

        // Log form inputs
        logForm:           $id("log-form"),
        inputMachine:      $id("input-machine"),
        inputStatus:       $id("input-status"),
        inputFault:        $id("input-fault"),
        inputRemedy:       $id("input-remedy"),
        inputShift:        $id("input-shift"),
        inputEmployee:     $id("input-employee"),
        inputPart:         $id("input-part"),
        inputRemarks:      $id("input-remarks"),
        inputStartDate:    $id("input-start-date"),
        inputStartTime:    $id("input-start-time"),
        inputEndDate:      $id("input-end-date"),
        inputEndTime:      $id("input-end-time"),
        clearFormBtn:      $id("clear-form-btn"),
        saveEntryBtn:      $id("save-entry-btn"),

        // Today's entries
        todayEntriesContainer: $id("today-entries-container"),
        entriesCountBadge:     $id("entries-count-badge"),
        todayTotalDowntime:    $id("today-total-downtime"),
        todayStopCount:        $id("today-stop-count"),

        // Analytics
        filterStartDate:   $id("filter-start-date"),
        filterEndDate:     $id("filter-end-date"),
        applyFilterBtn:    $id("apply-filter-btn"),
        quickYearSelect:   $id("quick-year-select"),
        kpiTotalFaults:    $id("kpi-total-faults"),
        kpiTotalDowntime:  $id("kpi-total-downtime"),
        kpiActiveLooms:    $id("kpi-active-looms"),
        kpiTopFault:       $id("kpi-top-fault"),
        remediesFaultSelect:    $id("remedies-fault-select"),
        remediesListContainer:  $id("remedies-list-container"),

        // Admin panel
        configNewItemInput: $id("config-new-item-input"),
        configAddItemBtn:   $id("config-add-item-btn"),
        configItemsList:    $id("config-items-list"),
        configContentTitle: $id("config-content-title"),

        // Notifications
        toastContainer: $id("toast-container"),
    };

    // ─── 1. Toast Notifications ───────────────────────────────────────────────
    function showToast(message, type = "success") {
        if (!el.toastContainer) return;
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        const icons = { success: "check-circle", error: "alert-circle", warning: "alert-triangle" };
        toast.innerHTML = `<i data-lucide="${icons[type] || 'info'}"></i><span>${message}</span>`;
        el.toastContainer.appendChild(toast);
        if (window.lucide) lucide.createIcons();
        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = "translateX(100%)";
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // ─── 2. Tab Navigation ────────────────────────────────────────────────────
    const tabBtns     = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const target = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.remove("active"));
            tabContents.forEach(c => c.classList.toggle("active", c.id === target));
            btn.classList.add("active");
            if (target === "analytics-tab") loadAnalytics();
        });
    });

    // ─── 3. Theme Toggle ─────────────────────────────────────────────────────
    if (el.themeToggleBtn) {
        el.themeToggleBtn.addEventListener("click", () => {
            const isDark = document.body.classList.toggle("dark-mode");
            document.body.classList.toggle("light-mode", !isDark);
            el.themeToggleBtn.innerHTML = isDark
                ? '<i data-lucide="sun"></i>'
                : '<i data-lucide="moon"></i>';
            if (window.lucide) lucide.createIcons();
            if (state.analyticsData) renderCharts(state.analyticsData);
        });
    }

    // ─── 4. Form Defaults ─────────────────────────────────────────────────────
    function padZ(n) { return String(n).padStart(2, "0"); }
    function formatDate(d) {
        return `${d.getFullYear()}-${padZ(d.getMonth()+1)}-${padZ(d.getDate())}`;
    }

    function setDefaultDateTimes() {
        const now  = new Date();
        const past = new Date(now - 30 * 60 * 1000);
        if (el.inputStartDate) el.inputStartDate.value = formatDate(now);
        if (el.inputEndDate)   el.inputEndDate.value   = formatDate(now);
        if (el.inputStartTime) el.inputStartTime.value = `${padZ(past.getHours())}:${padZ(past.getMinutes())}`;
        if (el.inputEndTime)   el.inputEndTime.value   = `${padZ(now.getHours())}:${padZ(now.getMinutes())}`;

        // Relaxed bounds to allow historical records
        ["inputStartDate","inputEndDate"].forEach(k => {
            if (el[k]) { el[k].min = "2010-01-01"; el[k].max = "2035-12-31"; }
        });

        // Default analytics range: last 1 year
        const yearAgo = new Date(now);
        yearAgo.setFullYear(now.getFullYear() - 1);
        if (el.filterStartDate) el.filterStartDate.value = formatDate(yearAgo);
        if (el.filterEndDate)   el.filterEndDate.value   = formatDate(now);
    }
    setDefaultDateTimes();

    // ─── 5. Autocomplete Engine ───────────────────────────────────────────────
    /**
     * Attaches autocomplete behavior to an input element.
     * @param {HTMLInputElement} input   - The text input
     * @param {string[]}         options - Array of option strings
     */
    function attachAutocomplete(input, options) {
        if (!input) return;

        const wrapper  = input.closest(".autocomplete-wrapper");
        if (!wrapper) {
            console.warn("[AM] No .autocomplete-wrapper found for", input.id);
            return;
        }

        const dropdown = wrapper.querySelector(".autocomplete-dropdown");
        if (!dropdown) {
            console.warn("[AM] No .autocomplete-dropdown found inside wrapper for", input.id);
            return;
        }

        const trigger = wrapper.querySelector(".dropdown-trigger");
        let activeIndex = -1;

        function getMatches(query) {
            if (!query) return [...options];
            const q = query.toLowerCase();
            const starts   = options.filter(o => o.toLowerCase().startsWith(q));
            const contains = options.filter(o => !o.toLowerCase().startsWith(q) && o.toLowerCase().includes(q));
            return [...starts, ...contains];
        }

        function renderDropdown(matches) {
            dropdown.innerHTML = "";
            activeIndex = -1;

            if (matches.length === 0) {
                dropdown.innerHTML = `<div class="autocomplete-empty">No matches found</div>`;
            } else {
                matches.forEach((item, idx) => {
                    const div = document.createElement("div");
                    div.className = "autocomplete-item";
                    div.textContent = item;
                    div.dataset.idx = idx;
                    div.addEventListener("mousedown", e => {
                        e.preventDefault(); // prevent blur before click
                        input.value = item;
                        closeDropdown();
                        input.dispatchEvent(new Event("change", { bubbles: true }));
                    });
                    dropdown.appendChild(div);
                });
            }
            dropdown.classList.remove("hidden");
        }

        function closeDropdown() {
            dropdown.classList.add("hidden");
            activeIndex = -1;
        }

        function openDropdown() {
            renderDropdown(getMatches(input.value.trim()));
        }

        function highlightItem(idx) {
            const items = dropdown.querySelectorAll(".autocomplete-item");
            items.forEach((item, i) => item.classList.toggle("highlighted", i === idx));
            if (items[idx]) items[idx].scrollIntoView({ block: "nearest" });
        }

        input.addEventListener("focus", openDropdown);
        input.addEventListener("input", openDropdown);

        input.addEventListener("blur", () => {
            // Small delay so mousedown on dropdown item fires first
            setTimeout(closeDropdown, 150);
        });

        input.addEventListener("keydown", e => {
            const items = dropdown.querySelectorAll(".autocomplete-item");
            if (dropdown.classList.contains("hidden")) {
                if (e.key === "ArrowDown") { e.preventDefault(); openDropdown(); }
                return;
            }
            if (e.key === "ArrowDown") {
                e.preventDefault();
                activeIndex = (activeIndex + 1) % items.length;
                highlightItem(activeIndex);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                activeIndex = (activeIndex - 1 + items.length) % items.length;
                highlightItem(activeIndex);
            } else if (e.key === "Enter") {
                e.preventDefault();
                const target = activeIndex >= 0 ? items[activeIndex] : items[0];
                if (target) target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            } else if (e.key === "Escape") {
                closeDropdown();
            }
        });

        if (trigger) {
            trigger.addEventListener("click", e => {
                e.stopPropagation();
                if (dropdown.classList.contains("hidden")) {
                    input.focus();
                    openDropdown();
                } else {
                    closeDropdown();
                }
            });
        }

        // Close on click outside
        document.addEventListener("click", e => {
            if (!wrapper.contains(e.target)) closeDropdown();
        });
    }

    // ─── 6. Load Config & Wire Autocomplete ──────────────────────────────────
    async function loadConfigurations() {
        try {
            const res = await fetch("/api/config");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            state.config = data;

            attachAutocomplete(el.inputMachine,  data.machines  || []);
            attachAutocomplete(el.inputFault,    data.faults    || []);
            attachAutocomplete(el.inputRemedy,   data.remedies  || []);
            attachAutocomplete(el.inputEmployee, data.employees || []);
            attachAutocomplete(el.inputPart,     data.parts     || []);

        } catch (err) {
            showToast("Could not load option lists: " + err.message, "error");
        }
    }
    loadConfigurations();

    // ─── 7. Today's Log Stream ───────────────────────────────────────────────
    async function loadTodayEntries() {
        if (!el.todayEntriesContainer) return;
        try {
            const res = await fetch("/api/logs/today");
            if (!res.ok) throw new Error("Server error");
            const entries = await res.json();
            renderTodayEntries(entries);
        } catch (err) {
            if (el.todayEntriesContainer) {
                el.todayEntriesContainer.innerHTML =
                    `<div class="empty-state"><p>Could not load today's entries: ${err.message}</p></div>`;
            }
        }
    }

    function renderTodayEntries(entries) {
        if (!el.todayEntriesContainer) return;
        el.todayEntriesContainer.innerHTML = "";
        if (el.entriesCountBadge) el.entriesCountBadge.textContent = `${entries.length} entries`;

        let totalDowntime = 0, stopsCount = 0;

        if (entries.length === 0) {
            el.todayEntriesContainer.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="inbox" style="width:36px;height:36px;"></i>
                    <p>No fault logs recorded yet today.</p>
                </div>`;
            if (window.lucide) lucide.createIcons();
            if (el.todayTotalDowntime) el.todayTotalDowntime.textContent = "0 mins";
            if (el.todayStopCount)     el.todayStopCount.textContent = "0";
            return;
        }

        entries.forEach(entry => {
            totalDowntime += parseFloat(entry.downtime || 0);
            if (entry.status === "Stop") stopsCount++;

            let fmtStart = entry.startTime || "";
            try {
                const d = new Date(entry.startTime);
                if (!isNaN(d)) fmtStart = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            } catch(_) {}

            const card = document.createElement("div");
            card.className = `log-item-card${entry.status === "Stop" ? " status-stop" : ""}`;
            card.innerHTML = `
                <div class="log-item-top">
                    <span class="log-item-machine">${entry.machine || "—"}</span>
                    <div class="log-item-meta">
                        <span class="status-badge ${(entry.status||"Running").toLowerCase()}">${entry.status||"Running"}</span>
                        <span class="log-item-downtime">${parseFloat(entry.downtime||0).toFixed(1)}m</span>
                    </div>
                </div>
                <div class="log-item-fault"><strong>Fault:</strong> ${entry.fault || "—"}</div>
                <div class="log-item-remedy"><strong>Action:</strong> ${entry.remedy || "—"}</div>
                ${entry.partChange ? `<div style="font-size:12px;color:var(--text-secondary)"><strong>Part Changed:</strong> ${entry.partChange}</div>` : ""}
                ${entry.remarks    ? `<div style="font-size:12px;color:var(--text-muted);font-style:italic">"${entry.remarks}"</div>` : ""}
                <div class="log-item-footer">
                    <span class="staff"><i data-lucide="user" style="width:12px;height:12px;"></i> ${entry.employee||"—"}</span>
                    <span>Shift ${entry.shift||"?"} | ${fmtStart}</span>
                </div>`;
            el.todayEntriesContainer.appendChild(card);
        });

        if (window.lucide) lucide.createIcons();
        if (el.todayTotalDowntime) el.todayTotalDowntime.textContent = `${totalDowntime.toFixed(1)} mins`;
        if (el.todayStopCount)     el.todayStopCount.textContent = stopsCount;
    }

    loadTodayEntries();

    // ─── 8. Log Form Submission ───────────────────────────────────────────────
    if (el.logForm) {
        el.logForm.addEventListener("submit", async e => {
            e.preventDefault();

            const machine    = el.inputMachine  ?.value.trim() || "";
            const status     = el.inputStatus   ?.value        || "Running";
            const fault      = el.inputFault    ?.value.trim() || "";
            const remedy     = el.inputRemedy   ?.value.trim() || "";
            const shift      = el.inputShift    ?.value        || "";
            const employee   = el.inputEmployee ?.value.trim() || "";
            const partChange = el.inputPart     ?.value.trim() || "";
            const remarks    = el.inputRemarks  ?.value.trim() || "";
            const startDate  = el.inputStartDate?.value        || "";
            const startTime  = el.inputStartTime?.value        || "";
            const endDate    = el.inputEndDate  ?.value        || "";
            const endTime    = el.inputEndTime  ?.value        || "";

            if (!machine || !fault || !remedy || !shift || !employee || !startDate || !startTime || !endDate || !endTime) {
                showToast("Please fill in all required fields marked with *", "warning");
                return;
            }

            const startFullStr = `${startDate} ${startTime}`;
            const endFullStr   = `${endDate} ${endTime}`;

            if (new Date(endFullStr) < new Date(startFullStr)) {
                showToast("End date/time cannot be before start date/time", "error");
                return;
            }

            if (el.saveEntryBtn) {
                el.saveEntryBtn.disabled = true;
                el.saveEntryBtn.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div> Saving...`;
            }

            try {
                const res = await fetch("/api/logs", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ machine, status, fault, remedy, shift, employee, partChange, remarks,
                                          startTime: startFullStr, endTime: endFullStr })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Save failed");
                showToast("Log entry saved successfully!");
                if (!data.db_synced) showToast("PostgreSQL offline — saved to Excel only.", "warning");
                resetForm();
                loadTodayEntries();
            } catch (err) {
                showToast(err.message, "error");
            } finally {
                if (el.saveEntryBtn) {
                    el.saveEntryBtn.disabled = false;
                    el.saveEntryBtn.innerHTML = `<i data-lucide="save"></i> Save Entry`;
                    if (window.lucide) lucide.createIcons();
                }
            }
        });
    }

    function resetForm() {
        if (el.logForm) el.logForm.reset();
        if (el.inputStatus) el.inputStatus.value = "Running";
        setDefaultDateTimes();
    }

    if (el.clearFormBtn) el.clearFormBtn.addEventListener("click", resetForm);

    // ─── 9. Admin Panel ───────────────────────────────────────────────────────
    // Open modal
    if (el.adminPanelBtn && el.adminModal) {
        el.adminPanelBtn.addEventListener("click", () => {
            el.adminModal.classList.remove("hidden");
            if (state.adminToken) {
                showAdminConfig();
            } else {
                showAuthPanel();
            }
        });
    }

    // Close modal buttons
    document.querySelectorAll(".close-modal-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            if (el.adminModal) el.adminModal.classList.add("hidden");
        });
    });

    // Click outside modal to close
    if (el.adminModal) {
        el.adminModal.addEventListener("click", e => {
            if (e.target === el.adminModal) el.adminModal.classList.add("hidden");
        });
    }

    function showAuthPanel() {
        if (el.adminAuthPanel)   el.adminAuthPanel.classList.remove("hidden");
        if (el.adminConfigPanel) el.adminConfigPanel.classList.add("hidden");
        if (el.adminPwInput)     el.adminPwInput.value = "";
        if (el.authErrorMsg)     el.authErrorMsg.classList.add("hidden");
    }

    function showAdminConfig() {
        if (el.adminAuthPanel)   el.adminAuthPanel.classList.add("hidden");
        if (el.adminConfigPanel) el.adminConfigPanel.classList.remove("hidden");
        loadConfigPanel("machines");
    }

    // Auth submit
    if (el.authSubmitBtn) {
        el.authSubmitBtn.addEventListener("click", async () => {
            const pw = el.adminPwInput?.value || "";
            try {
                const res = await fetch("/api/admin/login", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ password: pw })
                });
                const data = await res.json();
                if (data.success) {
                    state.adminToken = data.token;
                    localStorage.setItem("am_admin_token", data.token);
                    showAdminConfig();
                } else {
                    if (el.authErrorMsg) el.authErrorMsg.classList.remove("hidden");
                }
            } catch(_) {
                if (el.authErrorMsg) el.authErrorMsg.classList.remove("hidden");
            }
        });
    }

    // Logout
    if (el.logoutAdminBtn) {
        el.logoutAdminBtn.addEventListener("click", () => {
            state.adminToken = null;
            localStorage.removeItem("am_admin_token");
            if (el.adminModal) el.adminModal.classList.add("hidden");
        });
    }

    // Config sidebar tabs
    const configSidebar = document.querySelector(".config-tabs-sidebar");
    if (configSidebar) {
        configSidebar.addEventListener("click", e => {
            const btn = e.target.closest(".sidebar-tab-btn");
            if (!btn) return;
            configSidebar.querySelectorAll(".sidebar-tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            state.currentConfigType = btn.dataset.type;
            loadConfigPanel(state.currentConfigType);
        });
    }

    async function loadConfigPanel(type) {
        state.currentConfigType = type;
        const titles = { machines: "Loom Machines", faults: "Weaving Faults",
                         remedies: "Remedies / Actions", employees: "Operators / Staff", parts: "Spare Parts" };
        if (el.configContentTitle) el.configContentTitle.textContent = `Configure ${titles[type] || type}`;
        if (!el.configItemsList) return;
        el.configItemsList.innerHTML = `<li class="config-loading">Loading...</li>`;
        try {
            const res = await fetch("/api/config");
            const data = await res.json();
            renderConfigList(data[type] || []);
        } catch(err) {
            el.configItemsList.innerHTML = `<li class="config-loading">Error: ${err.message}</li>`;
        }
    }

    function renderConfigList(items) {
        if (!el.configItemsList) return;
        el.configItemsList.innerHTML = "";
        if (items.length === 0) {
            el.configItemsList.innerHTML = `<li class="config-empty">No items yet. Add one above.</li>`;
            return;
        }
        items.forEach(item => {
            const li = document.createElement("li");
            li.className = "config-item";
            li.innerHTML = `
                <span class="config-item-text">${item}</span>
                <button class="config-delete-btn" data-value="${item}" title="Delete">
                    <i data-lucide="trash-2"></i>
                </button>`;
            li.querySelector(".config-delete-btn").addEventListener("click", () => deleteConfigItem(item));
            el.configItemsList.appendChild(li);
        });
        if (window.lucide) lucide.createIcons();
    }

    if (el.configAddItemBtn) {
        el.configAddItemBtn.addEventListener("click", async () => {
            const value = el.configNewItemInput?.value.trim() || "";
            if (!value) { showToast("Enter a value to add", "warning"); return; }
            try {
                const res = await fetch("/api/config", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${state.adminToken}`
                    },
                    body: JSON.stringify({ type: state.currentConfigType, value })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                if (el.configNewItemInput) el.configNewItemInput.value = "";
                renderConfigList(data.items || []);
                state.config[state.currentConfigType] = data.items || [];
                showToast(`Added "${value}" to ${state.currentConfigType}`);
                // Re-wire autocomplete with updated list
                rewireAutocomplete(state.currentConfigType, data.items || []);
            } catch(err) {
                showToast(err.message, "error");
            }
        });
    }

    async function deleteConfigItem(value) {
        try {
            const res = await fetch("/api/config", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${state.adminToken}`
                },
                body: JSON.stringify({ type: state.currentConfigType, value })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            renderConfigList(data.items || []);
            state.config[state.currentConfigType] = data.items || [];
            showToast(`Removed "${value}"`);
            rewireAutocomplete(state.currentConfigType, data.items || []);
        } catch(err) {
            showToast(err.message, "error");
        }
    }

    // Re-wire autocomplete after admin edits
    const autocompleteMap = {
        machines:  "inputMachine",
        faults:    "inputFault",
        remedies:  "inputRemedy",
        employees: "inputEmployee",
        parts:     "inputPart"
    };
    function rewireAutocomplete(type, items) {
        const inputKey = autocompleteMap[type];
        if (inputKey && el[inputKey]) attachAutocomplete(el[inputKey], items);
    }

    // ─── 10. Analytics ────────────────────────────────────────────────────────
    if (el.quickYearSelect) {
        el.quickYearSelect.addEventListener("change", () => {
            const yr = el.quickYearSelect.value;
            if (!yr) return;
            const now = new Date();
            const year = yr === "all" ? now.getFullYear() : parseInt(yr);
            if (el.filterStartDate) el.filterStartDate.value = `${year}-01-01`;
            if (el.filterEndDate)   el.filterEndDate.value   = `${year}-12-31`;
            loadAnalytics();
        });
    }

    if (el.applyFilterBtn) {
        el.applyFilterBtn.addEventListener("click", () => {
            if (el.quickYearSelect) el.quickYearSelect.value = "";
            loadAnalytics();
        });
    }

    async function loadAnalytics() {
        const start = el.filterStartDate?.value;
        const end   = el.filterEndDate?.value;
        if (!start || !end) { showToast("Select date range", "warning"); return; }
        try {
            const res = await fetch(`/api/analytics?start_date=${start}&end_date=${end}`);
            if (!res.ok) {
                const d = await res.json();
                throw new Error(d.error || "Analytics failed");
            }
            const data = await res.json();
            state.analyticsData = data;
            updateKPIs(data.summary);
            renderCharts(data);
            populateRemedySelector(data);
        } catch(err) {
            showToast(err.message, "error");
        }
    }

    function updateKPIs(summary) {
        if (el.kpiTotalFaults)   el.kpiTotalFaults.textContent   = summary.total_faults;
        if (el.kpiTotalDowntime) el.kpiTotalDowntime.innerHTML    = `${(summary.total_downtime||0).toLocaleString()} <small>mins</small>`;
        if (el.kpiActiveLooms)   el.kpiActiveLooms.textContent    = summary.active_machines;
        if (el.kpiTopFault)      el.kpiTopFault.textContent       = summary.top_fault || "None";
    }

    // ─── 11. Chart Rendering ──────────────────────────────────────────────────
    const COLORS = [
        "rgba(61,106,159,0.85)", "rgba(245,166,35,0.85)", "rgba(16,185,129,0.85)",
        "rgba(239,68,68,0.85)",  "rgba(139,92,246,0.85)", "rgba(20,184,166,0.85)"
    ];

    function isDarkMode() { return document.body.classList.contains("dark-mode"); }

    function chartDefaults() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: isDarkMode() ? "#E2E8F0" : "#1A2E40", font: { size: 12 } }
                }
            },
            scales: {
                x: { ticks: { color: isDarkMode() ? "#94A3B8" : "#4A5D6E" }, grid: { color: "rgba(128,128,128,0.1)" } },
                y: { ticks: { color: isDarkMode() ? "#94A3B8" : "#4A5D6E" }, grid: { color: "rgba(128,128,128,0.1)" }, beginAtZero: true }
            }
        };
    }

    function destroyChart(key) {
        if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
    }

    function renderCharts(data) {
        // 1. Fault Trend Line Chart
        const trendCanvas = document.getElementById("chart-fault-trend");
        if (trendCanvas) {
            destroyChart("trend");
            const months = data.trends.map(t => t.month);
            const faultNames = data.trends.length ? Object.keys(data.trends[0].shares) : [];
            const datasets = faultNames.map((fn, i) => ({
                label: fn,
                data: data.trends.map(t => t.shares[fn] || 0),
                borderColor: COLORS[i % COLORS.length],
                backgroundColor: COLORS[i % COLORS.length].replace("0.85", "0.15"),
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 7
            }));
            if (datasets.length === 0 && months.length > 0) {
                datasets.push({
                    label: "Total Faults",
                    data: data.trends.map(t => t.total_faults),
                    borderColor: COLORS[0],
                    backgroundColor: COLORS[0].replace("0.85", "0.15"),
                    tension: 0.4, fill: true, pointRadius: 4
                });
            }
            state.charts.trend = new Chart(trendCanvas, {
                type: "line",
                data: { labels: months, datasets },
                options: {
                    ...chartDefaults(),
                    plugins: {
                        ...chartDefaults().plugins,
                        tooltip: { mode: "index", intersect: false }
                    }
                }
            });
        }

        // 2. Fault Frequency Bar Chart
        const freqCanvas = document.getElementById("chart-fault-frequency");
        if (freqCanvas) {
            destroyChart("freq");
            const top = data.faults.slice(0, 10);
            state.charts.freq = new Chart(freqCanvas, {
                type: "bar",
                data: {
                    labels: top.map(f => f.name),
                    datasets: [{ label: "Count", data: top.map(f => f.count),
                                 backgroundColor: COLORS, borderRadius: 6 }]
                },
                options: { ...chartDefaults(), plugins: { ...chartDefaults().plugins, legend: { display: false } } }
            });
        }

        // 3. Machine Downtime Bar Chart
        const dtCanvas = document.getElementById("chart-machine-downtime");
        if (dtCanvas) {
            destroyChart("machine");
            const top = data.machines.slice(0, 10);
            state.charts.machine = new Chart(dtCanvas, {
                type: "bar",
                data: {
                    labels: top.map(m => m.name),
                    datasets: [{ label: "Downtime (mins)", data: top.map(m => m.downtime),
                                 backgroundColor: COLORS.map(c => c.replace("0.85", "0.7")), borderRadius: 6 }]
                },
                options: { ...chartDefaults(), indexAxis: "y",
                           plugins: { ...chartDefaults().plugins, legend: { display: false } } }
            });
        }

        // 4. Shift Distribution Donut
        const shiftCanvas = document.getElementById("chart-shift-distribution");
        if (shiftCanvas) {
            destroyChart("shift");
            state.charts.shift = new Chart(shiftCanvas, {
                type: "doughnut",
                data: {
                    labels: data.shifts.map(s => `Shift ${s.name}`),
                    datasets: [{ data: data.shifts.map(s => s.count),
                                 backgroundColor: COLORS, borderWidth: 2,
                                 borderColor: isDarkMode() ? "#0B132B" : "#F0F4F8" }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { position: "bottom", labels: { color: isDarkMode() ? "#E2E8F0" : "#1A2E40", padding: 16 } }
                    },
                    cutout: "60%"
                }
            });
        }
    }

    // ─── 12. Remedies Lookup ──────────────────────────────────────────────────
    function populateRemedySelector(data) {
        if (!el.remediesFaultSelect) return;
        el.remediesFaultSelect.innerHTML = `<option value="">-- Select logged fault --</option>`;
        Object.keys(data.remedies).sort().forEach(f => {
            const opt = document.createElement("option");
            opt.value = f; opt.textContent = f;
            el.remediesFaultSelect.appendChild(opt);
        });
        if (el.remediesListContainer)
            el.remediesListContainer.innerHTML = `<p class="empty-state-text">Select a fault above to view applied remedies.</p>`;
    }

    if (el.remediesFaultSelect) {
        el.remediesFaultSelect.addEventListener("change", () => {
            const fault = el.remediesFaultSelect.value;
            if (!el.remediesListContainer) return;
            el.remediesListContainer.innerHTML = "";
            if (!fault || !state.analyticsData?.remedies?.[fault]) {
                el.remediesListContainer.innerHTML = `<p class="empty-state-text">No data for selected fault.</p>`;
                return;
            }
            const remedies = state.analyticsData.remedies[fault];
            const total = remedies.reduce((s, r) => s + r.count, 0);
            remedies.forEach(r => {
                const pct = total ? Math.round(r.count / total * 100) : 0;
                const div = document.createElement("div");
                div.className = "remedy-row";
                div.innerHTML = `
                    <div class="remedy-info">
                        <span class="remedy-name">${r.name}</span>
                        <span class="remedy-count">${r.count}× (${pct}%)</span>
                    </div>
                    <div class="remedy-bar-wrap">
                        <div class="remedy-bar" style="width:${pct}%"></div>
                    </div>`;
                el.remediesListContainer.appendChild(div);
            });
        });
    }

}); // end DOMContentLoaded
