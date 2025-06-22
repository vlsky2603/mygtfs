// ===================================================================
//     utils.js - Вспомогательные утилиты
// ===================================================================
// Мелкие, но важные функции, которые используются в разных
// частях приложения: рандомные сообщения, форматирование времени,
// и другие полезные хелперы.
// ===================================================================

function determineSimulationTimeUTC() {
    return new Date();
}

function gtfsTimeToSeconds(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const parts = timeStr.split(':');
    if (parts.length !== 3) return null;
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseInt(parts[2], 10);
    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return null;
    return hours * 3600 + minutes * 60 + seconds;
}

function getDatetimeForGtfsTime(gtfsTimeSeconds, serviceDateUTC) {
    if (gtfsTimeSeconds === null) return null;
    const serviceDayStart = new Date(serviceDateUTC);
    serviceDayStart.setUTCHours(0, 0, 0, 0);
    return new Date(serviceDayStart.getTime() + gtfsTimeSeconds * 1000);
}

function formatArrivalTime(sStopTimes, nowForFormattingUTC) {
    const scheduledTimeStr = sStopTimes?.scheduled;
    const estimatedTimeStr = sStopTimes?.estimated;
    const effectiveTimeStr = estimatedTimeStr || scheduledTimeStr;
    if (!effectiveTimeStr) return { text: '', css: '', timestamp: Infinity };

    const targetTimeUTC = new Date(effectiveTimeStr);
    const diffSeconds = (targetTimeUTC.getTime() - nowForFormattingUTC.getTime()) / 1000;
    const timestamp = targetTimeUTC.getTime();
    const min = Math.round(diffSeconds / 60);

    if (min < -10) return { text: '', css: '', timestamp: Infinity };
    let cssClass = '', displayText = '';
    if (min <= 1 && min >= -5) { displayText = 'Now'; cssClass = 'now'; }
    else if (min > 1 && min < 60) { displayText = `${min} min`; cssClass = ''; }
    else if (min >= 60) {
        displayText = targetTimeUTC.toLocaleTimeString([], {timeZone: "America/Winnipeg", hour: '2-digit', minute: '2-digit'});
        cssClass = 'scheduled-time';
        
        const nowDateWinnipeg = nowForFormattingUTC.toLocaleDateString("en-CA", {timeZone: "America/Winnipeg"});
        const targetDateWinnipeg = targetTimeUTC.toLocaleDateString("en-CA", {timeZone: "America/Winnipeg"});
        if (targetDateWinnipeg !== nowDateWinnipeg) {
             cssClass += ' future-date';
        }
    } else return { text: '', css: '', timestamp: Infinity };
    
    if (estimatedTimeStr) {
        cssClass += ' live';
    }
    if (min > 1 && min < 5) cssClass += ' critical-soon';
    else if (min >= 5 && min < 10) cssClass += ' soon';
    else if (min >= 10 && min < 20) cssClass += ' approaching';

    return { text: displayText, css: cssClass.trim(), timestamp };
}

const loadingMessages = [ "Warming up the buses...", "Checking Portage & Main for stragglers...", "Navigating the North End maze...", "Counting bison... I mean, stops...", "Avoiding a 'Winnipeg handshake'...", "Finding the Forks, one stop at a time...", "Plotting routes, eh? Almost social-worthy!", "Don't be a snowbird, your data is coming!", "Almost there, buddy guy! Just a sec.", "Friendly Manitoba is loading your transit data!" ];
let lastLoadingMessageIndex = -1;
function getRandomLoadingMessage() { let randomIndex; do { randomIndex = Math.floor(Math.random() * loadingMessages.length); } while (randomIndex === lastLoadingMessageIndex && loadingMessages.length > 1); lastLoadingMessageIndex = randomIndex; return loadingMessages[randomIndex]; }

const scheduleWaitingMessages = [ "Consulting the transit spirits...", "Hold your toques, fetching times!", "Our hamsters are pedaling furiously for your schedule!", "Just a sec, asking the bus nicely if it's on time...", "Is it colder than a Winnipeg winter out there? We'll get your bus times soon!", "Polishing the Peggo card reader... and your schedule!", "Patience, young mosquito! The bus schedule is buzzing in.", "Recalibrating the Slurpee machine... Oh, and schedules.", "Wrangling the data like a true Manitoban cowboy!" ];
let lastScheduleWaitingMessageIndex = -1;
function getRandomScheduleWaitingMessage() { let randomIndex; do { randomIndex = Math.floor(Math.random() * scheduleWaitingMessages.length); } while (randomIndex === lastScheduleWaitingMessageIndex && scheduleWaitingMessages.length > 1); lastWaitingMessageIndex = randomIndex; return scheduleWaitingMessages[randomIndex]; }

const noScheduleMessages = [ "Looks like the buses are taking a nap here!", "No upcoming buses... time for a Portage Ave stroll?", "This stop is quiet. Too quiet. Maybe a coffee at Timmies?", "Is the bus playing hide and seek? Or just stuck on Pembina?", "Zilch. Nada. No buses soon, sorry eh.", "Even the Goldeyes have more action right now.", "Did a moose eat the schedule for this stop?", "This stop's as empty as the Jets' trophy case... (kidding, mostly!)", "Perhaps it's time to embrace the 'Winterpeg' walk?" ];
let lastNoScheduleMessageIndex = -1;
function getRandomNoScheduleMessage() { let randomIndex; do { randomIndex = Math.floor(Math.random() * noScheduleMessages.length); } while (randomIndex === lastNoScheduleMessageIndex && noScheduleMessages.length > 1); lastNoScheduleMessageIndex = randomIndex; return noScheduleMessages[randomIndex]; }

function isIOS() {
  return [
    'iPad Simulator', 'iPhone Simulator', 'iPod Simulator', 'iPad', 'iPhone', 'iPod'
  ].includes(navigator.platform)
  || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
}