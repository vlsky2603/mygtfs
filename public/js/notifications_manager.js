// ===================================================================
//     notifications_manager.js - Менеджер уведомлений
// ===================================================================

import { determineSimulationTimeUTC } from './utils.js';
import { allLocalStops, gtfsData } from './gtfs_handler.js';

// Константы
const NOTIFICATION_CHECK_INTERVAL = 30000;
const RULE_MONITOR_INTERVAL = 60000;
const DEFAULT_NOTIFICATION_MINUTES_BEFORE = 5;
const REGULAR_NOTIFICATIONS_STORAGE_KEY = 'transitMapRegularNotificationRules';
const API_BASE = window.location.origin;

// Глобальные переменные
let scheduledNotifications = [];
export let regularNotificationRules = [];
let notificationCheckIntervalId = null;
let ruleMonitorIntervalId = null;
let iosInfoShown = localStorage.getItem('iosNotificationInfoShown') === 'true';

// Утилитарные функции
function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function createToastContainer() {
    let container = document.getElementById('toast-notifications');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-notifications';
        document.body.appendChild(container);
    }
    return container;
}

async function ensureNotificationPermission() {
    if (isIOS()) {
        return false;
    }
    if (!("Notification" in window)) {
        console.warn("Browser does not support the Notification API for local notifications.");
        return false;
    }
    if (Notification.permission === "granted") {
        return true;
    }
    if (Notification.permission === "denied") {
        console.warn("Local notification permission has been explicitly denied by the user.");
        return false;
    }
    try {
        const permission = await Notification.requestPermission();
        return permission === "granted";
    } catch (error) {
        console.error("Error requesting local notification permission:", error);
        return false;
    }
}

export async function scheduleNotification(routeNumber, routeName, variantKey, targetTimeISO, minutesBefore, buttonElement, ruleId = null) {
    const isDeviceIOS = isIOS();
    if (isDeviceIOS && !iosInfoShown) {
        alert("On iOS, browser notifications have limitations. You'll see in-app reminders (toasts). For full notifications, please await our upcoming native app!");
        localStorage.setItem('iosNotificationInfoShown', 'true');
        iosInfoShown = true;
    }

    if (!isDeviceIOS && "Notification" in window && Notification.permission === 'default') {
        await ensureNotificationPermission();
    }
    
    const targetTime = new Date(targetTimeISO); 
    const notificationTime = new Date(targetTime.getTime() - minutesBefore * 60 * 1000);
    const nowForSim = determineSimulationTimeUTC();

    let notificationId;
    if (ruleId) {
        notificationId = `rule-${ruleId}-variant-${variantKey}-target-${targetTime.getTime()}`;
    } else {
        notificationId = `route-${routeNumber}-variant-${variantKey}-time-${targetTime.getTime()}`;
    }

    const existingNotificationIndex = scheduledNotifications.findIndex(n => n.id === notificationId);

    if (existingNotificationIndex > -1) {
        scheduledNotifications.splice(existingNotificationIndex, 1);
        if (buttonElement) {
            buttonElement.innerHTML = '<i class="far fa-bell"></i>';
            buttonElement.title = 'Set reminder (in-app toast)';
            buttonElement.classList.remove('active-notification');
        }
    } else {
        if (ruleId && notificationTime.getTime() <= nowForSim.getTime()) {
            return;
        }
        if (!ruleId && notificationTime.getTime() <= nowForSim.getTime()) {
             alert(`It's too late to set an in-app reminder for this bus.`);
             return;
        }

        const notificationData = {
            id: notificationId, ruleId, routeNumber, routeName, variantKey,
            targetTime: targetTime, notificationTime: notificationTime, 
            minutesBefore, triggered: false, buttonElement
        };
        scheduledNotifications.push(notificationData);

        if (buttonElement) {
            buttonElement.innerHTML = '<i class="fas fa-bell"></i>';
            buttonElement.title = `Cancel in-app reminder for ${routeName} (at ${notificationTime.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})})`;
            buttonElement.classList.add('active-notification');
        }
    }

    if (scheduledNotifications.length > 0 && !notificationCheckIntervalId) {
        notificationCheckIntervalId = setInterval(checkScheduledNotifications, NOTIFICATION_CHECK_INTERVAL);
    } else if (scheduledNotifications.length === 0 && notificationCheckIntervalId) {
        if (!regularNotificationRules.some(r => r.isEnabled)) {
            clearInterval(notificationCheckIntervalId);
            notificationCheckIntervalId = null;
        }
    }
}

export function checkScheduledNotifications() {
    const nowForSim = determineSimulationTimeUTC(); 
    let activeRemindersPending = false;

    for (let i = scheduledNotifications.length - 1; i >= 0; i--) {
        const notif = scheduledNotifications[i];
        if (notif.triggered) continue;

        if (nowForSim.getTime() >= notif.notificationTime.getTime()) {
            if (nowForSim.getTime() <= (notif.targetTime.getTime() + 3 * 60 * 1000)) {
                showNotification(notif);
            }
            notif.triggered = true;
            if (notif.buttonElement && !notif.ruleId) {
                notif.buttonElement.innerHTML = '<i class="far fa-bell"></i>';
                notif.buttonElement.title = 'Set reminder (in-app toast)';
                notif.buttonElement.classList.remove('active-notification');
            }
        }
        if (!notif.triggered && nowForSim.getTime() < notif.targetTime.getTime()) {
            activeRemindersPending = true;
        }
    }
    scheduledNotifications = scheduledNotifications.filter(n => 
        !n.triggered || (n.triggered && nowForSim.getTime() < (n.targetTime.getTime() + 5 * 60 * 1000))
    );
    
    const activeRegularRules = regularNotificationRules.some(r => r.isEnabled);
    if (!activeRemindersPending && !activeRegularRules && notificationCheckIntervalId) {
        clearInterval(notificationCheckIntervalId);
        notificationCheckIntervalId = null;
    }
}

function showNotification(notificationData) {
    const targetTimeLocal = notificationData.targetTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', timeZone: 'America/Winnipeg'});
    const title = `Reminder: Route ${notificationData.routeNumber}`;
    const body = `${notificationData.routeName} is due around ${targetTimeLocal}.`;
    const iconUrl = './bus-notification-icon.png';

    const toastContainer = document.getElementById('toast-notifications') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = 'toast-notification show reminder-toast';
    toast.innerHTML = `<strong>${title}</strong><p>${body}</p>`;
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = () => { 
        toast.classList.remove('show'); 
        setTimeout(() => { if(toast.parentElement) toast.parentElement.removeChild(toast); }, 500);
    };
    toast.appendChild(closeBtn);
    toastContainer.appendChild(toast);

    if (!isIOS() && "Notification" in window && Notification.permission === "granted") {
        const options = {
            body: body,
            icon: iconUrl,
            tag: notificationData.id + "_local_native",
            renotify: true,
        };
        try {
            const nativeNotification = new Notification(title, options);
            nativeNotification.onclick = () => {
                window.focus();
                toast.remove();
            };
        } catch (e) {
            console.error("Error showing local native notification:", e);
        }
    }
}

export function loadRegularNotificationRules() {
    const storedRules = localStorage.getItem(REGULAR_NOTIFICATIONS_STORAGE_KEY);
    if (storedRules) {
        try {
            regularNotificationRules = JSON.parse(storedRules);
            if (!Array.isArray(regularNotificationRules)) regularNotificationRules = [];
        } catch (e) {
            console.error("Error parsing regular notification rules:", e);
            regularNotificationRules = [];
        }
    } else {
        regularNotificationRules = [];
    }
    regularNotificationRules.forEach(rule => {
        if (!rule.stopNameDisplay && rule.stopId && allLocalStops.length > 0) {
            const stopDetail = allLocalStops.find(s => String(s.stop_id) === String(rule.stopId));
            rule.stopNameDisplay = stopDetail ? (stopDetail.stop_name || `Stop #${rule.stopId}`) : `Stop #${rule.stopId}`;
        }
        if (!rule.routeNumberDisplay && rule.routeNumber && gtfsData.routes.length > 0) {
             const routeDetail = gtfsData.routes.find(r => String(r.route_short_name) === String(rule.routeNumber) || String(r.route_id) === String(rule.routeNumber));
             rule.routeNumberDisplay = routeDetail ? (routeDetail.route_long_name ? `${routeDetail.route_short_name} - ${routeDetail.route_long_name}`: routeDetail.route_short_name) : rule.routeNumber;
        }
    });
    renderRegularNotificationsPanel();
}

function saveRegularNotificationRules() {
    localStorage.setItem(REGULAR_NOTIFICATIONS_STORAGE_KEY, JSON.stringify(regularNotificationRules));
    renderRegularNotificationsPanel();
     if (regularNotificationRules.some(rule => rule.isEnabled) && !ruleMonitorIntervalId) {
        startRuleMonitor();
    } else if (!regularNotificationRules.some(rule => rule.isEnabled) && ruleMonitorIntervalId) {
        stopRuleMonitor();
    }
}

export function renderRegularNotificationsPanel() {
    const container = document.querySelector('#regular-notifications-panel .regular-notifications-list-container');
    if (!container) return;
    container.innerHTML = '';

    if (regularNotificationRules.length === 0) {
        container.innerHTML = '<p class="no-regular-notifications">No regular reminders set up yet. Click "+" or set one from a stop\'s schedule.</p>';
        return;
    }

    regularNotificationRules.sort((a,b) => (a.stopNameDisplay || a.stopId).localeCompare(b.stopNameDisplay || b.stopId) || (a.routeNumberDisplay || a.routeNumber).localeCompare(b.routeNumberDisplay || b.routeNumber) ).forEach(rule => {
        const item = document.createElement('div');
        item.className = 'regular-notification-item';
        item.dataset.ruleId = rule.id;

        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const selectedDays = rule.days.map(d => days[d]).join(', ') || 'No days';
        const summary = `Route ${rule.routeNumberDisplay || rule.routeNumber} at ${rule.stopNameDisplay || `Stop #${rule.stopId}`}`;
        const details = `Remind ${rule.notifyMinutesBefore} min before, between ${rule.timeStart}-${rule.timeEnd} on ${selectedDays}.`;

        item.innerHTML = `
            <div class="regular-notification-item-info">
                <div class="rule-summary">${summary}</div>
                <div class="rule-details">${details}</div>
            </div>
            <div class="regular-notification-item-actions">
                <label class="switch" title="${rule.isEnabled ? 'Disable' : 'Enable'} reminder">
                    <input type="checkbox" class="toggle-rule-enabled" ${rule.isEnabled ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
                <button class="action-button edit-rule-btn" title="Edit Rule"><i class="fas fa-edit"></i></button>
                <button class="action-button delete-rule-btn" title="Delete Rule"><i class="fas fa-trash"></i></button>
            </div>
        `;
        item.querySelector('.toggle-rule-enabled').addEventListener('change', (e) => toggleRuleEnabled(rule.id, e.target.checked));
        item.querySelector('.edit-rule-btn').addEventListener('click', () => openRuleEditorForEdit(rule.id));
        item.querySelector('.delete-rule-btn').addEventListener('click', () => deleteRule(rule.id));
        container.appendChild(item);
    });
}

function openRuleEditorForStop(stopData) {
    if (!stopData || !stopData.stop_id) {
        console.error("Cannot open rule editor: stopData is invalid");
        alert("Could not set up reminder: stop information is missing.");
        return;
    }
    openRuleEditor('add-from-stop', null, stopData);
}

function openRuleEditor(mode = 'add', ruleId = null, preselectedStopData = null) {
    const modal = document.getElementById('rule-editor-modal');
    const stopSelect = document.getElementById('rule-stop-select');
    const routeSelect = document.getElementById('rule-route-select');
    const editorTitle = document.getElementById('rule-editor-title');

    stopSelect.innerHTML = '<option value="">-- Select a Stop --</option>';
    allLocalStops.sort((a,b) => (a.stop_name || `Stop #${a.stop_id}`).localeCompare(b.stop_name || `Stop #${b.stop_id}`)).forEach(stop => {
        const option = document.createElement('option');
        option.value = stop.stop_id;
        option.textContent = `${stop.stop_name || `Stop #${stop.stop_id}`} (#${stop.stop_id})`;
        stopSelect.add(option);
    });
    routeSelect.innerHTML = '<option value="">-- Select Route --</option>';
    routeSelect.disabled = true;

    document.getElementById('rule-editor-mode').value = mode.startsWith('add') ? 'add' : 'edit';
    document.getElementById('rule-editor-rule-id').value = ruleId || '';

    document.getElementById('rule-time-start').value = "08:00";
    document.getElementById('rule-time-end').value = "09:00";
    document.getElementById('rule-notify-minutes').value = DEFAULT_NOTIFICATION_MINUTES_BEFORE;
    document.querySelectorAll('#rule-days-select input[type="checkbox"]').forEach(cb => cb.checked = (parseInt(cb.value) >= 1 && parseInt(cb.value) <= 5)); 
    routeSelect.value = "";


    if (mode === 'edit' && ruleId) {
        editorTitle.textContent = "Edit Reminder Rule";
        const rule = regularNotificationRules.find(r => r.id === ruleId);
        if (rule) {
            stopSelect.value = rule.stopId;
            onRuleEditorStopChange({ target: stopSelect }, rule.routeNumber); 

            document.getElementById('rule-time-start').value = rule.timeStart;
            document.getElementById('rule-time-end').value = rule.timeEnd;
            document.getElementById('rule-notify-minutes').value = rule.notifyMinutesBefore;
            
            document.querySelectorAll('#rule-days-select input[type="checkbox"]').forEach(cb => {
                cb.checked = rule.days.includes(parseInt(cb.value));
            });
        }
    } else if (mode === 'add-from-stop' && preselectedStopData) {
        editorTitle.textContent = "Add New Reminder Rule";
        stopSelect.value = preselectedStopData.stop_id;
        onRuleEditorStopChange({ target: stopSelect });
    }
    else { 
        editorTitle.textContent = "Add New Reminder Rule";
        stopSelect.value = "";
    }
    modal.classList.remove('modal-hidden');
    document.body.classList.add('modal-open');
    setTimeout(() => modal.classList.add('modal-visible'), 10);
}

function openRuleEditorForAdd() { openRuleEditor('add'); }
function openRuleEditorForEdit(ruleId) { openRuleEditor('edit', ruleId); }

export function closeRuleEditor() {
    const modal = document.getElementById('rule-editor-modal');
    modal.classList.remove('modal-visible');
    document.body.classList.remove('modal-open');
    setTimeout(() => modal.classList.add('modal-hidden'), 300);
}

async function onRuleEditorStopChange(event, preselectRouteNumber = null) {
    const stopId = event.target.value;
    const routeSelect = document.getElementById('rule-route-select');
    routeSelect.innerHTML = '<option value="">Loading routes...</option>';
    routeSelect.disabled = true;

    if (!stopId) {
        routeSelect.innerHTML = '<option value="">-- Select Stop First --</option>';
        return;
    }

    try {
        const nowForSim = determineSimulationTimeUTC();

        const scheduleStartTime = new Date(nowForSim.getTime() - 60 * 60 * 1000); 
        const scheduleEndTime = new Date(nowForSim.getTime() + 24 * 60 * 60 * 1000); 

        const fetchUrl = `${API_BASE}/api/stops/${stopId}/schedule?usage=short&start=${scheduleStartTime.toISOString()}&end=${scheduleEndTime.toISOString()}`;
        
        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error('Failed to fetch routes for stop');
        const scheduleData = await response.json();
        
        const routesAtStop = scheduleData?.data?.['stop-schedule']?.['route-schedules'] || [];

        routeSelect.innerHTML = '<option value="">-- Select Route --</option>';
        if (routesAtStop.length > 0) {
            const uniqueRoutes = {};
            routesAtStop.forEach(rs => {
                if (rs.route && rs.route.number) {
                     const gtfsRouteInfo = gtfsData.routes.find(r => String(r.route_short_name) === String(rs.route.number));
                     const displayName = gtfsRouteInfo?.route_long_name ? `${rs.route.number} - ${gtfsRouteInfo.route_long_name}` : `${rs.route.number} - ${rs.route.name || `Route ${rs.route.number}`}`;
                    uniqueRoutes[rs.route.number] = displayName;
                }
            });
            
            Object.entries(uniqueRoutes).sort(([,a],[,b]) => {
                const numA = parseInt(a.split(" - ")[0]);
                const numB = parseInt(b.split(" - ")[0]);
                if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
                return a.localeCompare(b);
            }).forEach(([number, name]) => {
                const option = document.createElement('option');
                option.value = number;
                option.textContent = name;
                routeSelect.add(option);
            });
            routeSelect.disabled = false;
            if (preselectRouteNumber) {
                routeSelect.value = preselectRouteNumber;
            }
        } else {
            routeSelect.innerHTML = '<option value="">-- No routes found --</option>';
        }
    } catch (error) {
        console.error("Error fetching routes for rule editor:", error);
        routeSelect.innerHTML = '<option value="">-- Error loading --</option>';
    }
}

function saveRuleFromEditor() {
    const mode = document.getElementById('rule-editor-mode').value;
    const ruleId = document.getElementById('rule-editor-rule-id').value;

    const stopId = document.getElementById('rule-stop-select').value;
    const stopOption = document.getElementById('rule-stop-select').selectedOptions[0];
    const stopNameDisplay = stopOption ? stopOption.textContent.split(" (#")[0] : stopId;

    const routeNumber = document.getElementById('rule-route-select').value;
    const routeOption = document.getElementById('rule-route-select').selectedOptions[0];
    const routeNumberDisplay = routeOption ? routeOption.textContent : routeNumber;

    const timeStart = document.getElementById('rule-time-start').value;
    const timeEnd = document.getElementById('rule-time-end').value;
    const notifyMinutesBefore = parseInt(document.getElementById('rule-notify-minutes').value, 10);
    const selectedDays = [];
    document.querySelectorAll('#rule-days-select input[type="checkbox"]:checked').forEach(cb => {
        selectedDays.push(parseInt(cb.value));
    });

    if (!stopId || !routeNumber || !timeStart || !timeEnd || isNaN(notifyMinutesBefore) || selectedDays.length === 0) {
        alert("Please fill in all fields and select at least one day.");
        return;
    }
    if (timeStart >= timeEnd) {
        alert("Start time must be before end time for the notification window.");
        return;
    }

    const ruleData = {
        stopId, stopNameDisplay, routeNumber, routeNumberDisplay,
        timeStart, timeEnd, days: selectedDays.sort((a,b) => a-b),
        notifyMinutesBefore,
        isEnabled: (mode === 'edit' && ruleId) ? (regularNotificationRules.find(r => r.id === ruleId)?.isEnabled ?? true) : true
    };

    if (mode === 'edit' && ruleId) {
        const index = regularNotificationRules.findIndex(r => r.id === ruleId);
        if (index > -1) {
            regularNotificationRules[index] = { ...regularNotificationRules[index], ...ruleData };
        } else {
            ruleData.id = 'rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            regularNotificationRules.push(ruleData);
        }
    } else {
        ruleData.id = 'rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        regularNotificationRules.push(ruleData);
    }
    saveRegularNotificationRules();
    closeRuleEditor();
}

function toggleRuleEnabled(ruleId, isEnabled) {
    const rule = regularNotificationRules.find(r => r.id === ruleId);
    if (rule) {
        rule.isEnabled = isEnabled;
        saveRegularNotificationRules();
    }
}

function deleteRule(ruleId) {
    if (confirm("Are you sure you want to delete this reminder rule?")) {
        regularNotificationRules = regularNotificationRules.filter(r => r.id !== ruleId);
        scheduledNotifications = scheduledNotifications.filter(n => n.ruleId === ruleId); 
        saveRegularNotificationRules();
    }
}

export function startRuleMonitor() {
    if (ruleMonitorIntervalId) clearInterval(ruleMonitorIntervalId);
    ruleMonitorIntervalId = setInterval(checkAndProcessRegularNotificationRules, RULE_MONITOR_INTERVAL);
    checkAndProcessRegularNotificationRules(); 
}

function stopRuleMonitor() {
    if (ruleMonitorIntervalId) {
        clearInterval(ruleMonitorIntervalId);
        ruleMonitorIntervalId = null;
    }
}

async function checkAndProcessRegularNotificationRules() {
    const nowForSim = determineSimulationTimeUTC(); 
    
    const currentDay = new Date(nowForSim.toLocaleString("en-US", {timeZone: "America/Winnipeg"})).getDay();
    const winnipegTimeForCompare = new Date(nowForSim.toLocaleString("en-US", {timeZone: "America/Winnipeg"}));
    const currentTimeWinnipeg = `${String(winnipegTimeForCompare.getHours()).padStart(2, '0')}:${String(winnipegTimeForCompare.getMinutes()).padStart(2, '0')}`;

    let activeRulesFound = false;

    for (const rule of regularNotificationRules) {
        if (!rule.isEnabled) continue;
        activeRulesFound = true;
        if (!rule.days.includes(currentDay)) continue;
        if (currentTimeWinnipeg < rule.timeStart || currentTimeWinnipeg > rule.timeEnd) continue;

        try {
            const scheduleStartTimeUTC = new Date(nowForSim.getTime() - (rule.notifyMinutesBefore + 15) * 60000); 
            const scheduleEndTimeUTC = new Date(nowForSim.getTime() + 75 * 60000); 
            
            const fetchUrl = `${API_BASE}/api/stops/${rule.stopId}/schedule?usage=long&start=${scheduleStartTimeUTC.toISOString()}&end=${scheduleEndTimeUTC.toISOString()}`;
            const response = await fetch(fetchUrl);
            if (!response.ok) {
                console.warn(`CLIENT RULE CHECK: Failed to fetch schedule for rule (stop ${rule.stopId}, route ${rule.routeNumber}): ${response.status}`);
                continue;
            }
            const scheduleData = await response.json();
            const routeSchedulesAPI = scheduleData?.data?.['stop-schedule']?.['route-schedules'] || [];
            const targetRouteSchedule = routeSchedulesAPI.find(rs => String(rs.route.number) === String(rule.routeNumber));

            if (targetRouteSchedule) {
                const scheduledStopsAPI = targetRouteSchedule['scheduled-stops'] || [];
                for (const sStop of scheduledStopsAPI) {
                    if (sStop.cancelled === "true") continue; 

                    const effectiveDepartureTimeStr = sStop.times?.departure?.estimated || sStop.times?.departure?.scheduled;
                    if (!effectiveDepartureTimeStr) continue;
                    
                    const busTargetTimeUTC = new Date(effectiveDepartureTimeStr); 
                    const notificationTriggerTimeUTC = new Date(busTargetTimeUTC.getTime() - rule.notifyMinutesBefore * 60000);
                    
                    const instanceNotificationId = `rule-${rule.id}-variant-${sStop.variant.key}-target-${busTargetTimeUTC.getTime()}`;
                    const existingReminder = scheduledNotifications.find(n => n.id === instanceNotificationId);

                    if (!existingReminder && 
                        notificationTriggerTimeUTC.getTime() > (nowForSim.getTime() - RULE_MONITOR_INTERVAL - 60000) && 
                        notificationTriggerTimeUTC.getTime() <= (nowForSim.getTime() + 60000) && 
                        busTargetTimeUTC.getTime() > (nowForSim.getTime() - 3 * 60000)  
                    ) {
                        scheduleNotification(
                            rule.routeNumber,
                            sStop.variant.name || targetRouteSchedule.route.name || `Route ${rule.routeNumber}`,
                            sStop.variant.key,
                            busTargetTimeUTC.toISOString(), 
                            rule.notifyMinutesBefore,
                            null, 
                            rule.id
                        );
                    }
                }
            }
        } catch (error) {
            console.error("CLIENT RULE CHECK: Error processing rule for in-app reminder:", rule, error);
        }
    }
    if (!activeRulesFound && ruleMonitorIntervalId) { 
        stopRuleMonitor();
    }
}

export function cancelScheduledNotification(notificationId) {
    const index = scheduledNotifications.findIndex(n => n.id === notificationId);
    if (index > -1) {
        const notification = scheduledNotifications[index];
        scheduledNotifications.splice(index, 1);
        
        if (notification.buttonElement) {
            notification.buttonElement.innerHTML = '<i class="far fa-bell"></i>';
            notification.buttonElement.title = 'Set reminder (in-app toast)';
            notification.buttonElement.classList.remove('active-notification');
        }
        
        console.log(`Cancelled notification: ${notificationId}`);
        return true;
    }
    return false;
}