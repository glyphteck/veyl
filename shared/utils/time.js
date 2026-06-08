export function timestampMs(value, fallback = null, options = {}) {
    let ms = null;
    if (typeof value?.toMillis === 'function') {
        ms = value.toMillis();
    } else if (value instanceof Date) {
        ms = value.getTime();
    } else if (typeof value?.seconds === 'number') {
        ms = value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1_000_000);
    } else if (typeof value?._seconds === 'number') {
        ms = value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1_000_000);
    } else if (Number.isFinite(value)) {
        ms = value;
    } else if (options.parseString && typeof value === 'string') {
        const numberMs = Number(value);
        ms = Number.isFinite(numberMs) ? numberMs : Date.parse(value);
    }

    if (!Number.isFinite(ms) || (options.positive && ms <= 0)) {
        return fallback;
    }
    return ms;
}

export function timestampKey(value) {
    if (value == null) {
        return null;
    }
    return timestampMs(value, null) ?? String(value);
}

export function makeTimestamp(ms) {
    return {
        toMillis() {
            return ms;
        },
        toDate() {
            return new Date(ms);
        },
    };
}

function twoDigits(value) {
    return String(value).padStart(2, '0');
}

export function dayKey(date) {
    return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

export function localDayKey(value) {
    const ms = timestampMs(value, null, { parseString: true });
    if (!Number.isFinite(ms)) return '';
    return dayKey(new Date(ms));
}

export function localDayStartMs(value) {
    const ms = timestampMs(value, null, { parseString: true });
    if (!Number.isFinite(ms)) return null;
    const date = new Date(ms);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

export function hourKey(dateOrHour) {
    const hour = dateOrHour instanceof Date ? dateOrHour.getHours() : dateOrHour;
    return twoDigits(hour);
}

export function dayHourKey(date) {
    return `${dayKey(date)}-${hourKey(date)}`;
}

export function formatDate(ymdString) {
    const [year, month, day] = ymdString.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ordinalDay(day) {
    const mod100 = day % 100;
    if (mod100 >= 11 && mod100 <= 13) {
        return `${day}th`;
    }
    switch (day % 10) {
        case 1:
            return `${day}st`;
        case 2:
            return `${day}nd`;
        case 3:
            return `${day}rd`;
        default:
            return `${day}th`;
    }
}

export function formatDayLabel(value, now = Date.now()) {
    const key = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : localDayKey(value);
    if (!key) return '';
    const nowMs = timestampMs(now, Date.now(), { parseString: true });
    const today = localDayKey(nowMs);
    if (key === today) return 'today';

    const yesterday = new Date(nowMs);
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setDate(yesterday.getDate() - 1);
    if (key === dayKey(yesterday)) return 'yesterday';

    const [year, month, day] = key.split('-').map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
    const date = new Date(year, month - 1, day);
    const monthName = date.toLocaleDateString('en-US', { month: 'long' }).toLowerCase();
    const yearText = year !== new Date(nowMs).getFullYear() ? `, ${year}` : '';
    return `${monthName} ${ordinalDay(day)}${yearText}`;
}

export function formatHour(hourString) {
    if (hourString === 'now') return 'now';
    const hour = parseInt(hourString);
    if (hour === 0) return '12 AM';
    if (hour === 12) return '12 PM';
    if (hour < 12) return `${hour} AM`;
    return `${hour - 12} PM`;
}

export function formatTimeHHMM(ts, showAMPM = false) {
    if (!ts) return '';
    const d = new Date(ts);
    if (showAMPM) {
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatFullDateTime(timestamp) {
    if (!timestamp) return '';
    const ms = timestampMs(timestamp, null, { parseString: true });
    if (!Number.isFinite(ms)) return '';
    const date = new Date(ms);
    return `${date.getMonth() + 1}/${date.getDate()} ${formatTimeHHMM(date, true)}`;
}

export function formatDuration(seconds, { hours = true } = {}) {
    const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    const minutes = Math.floor(safe / 60);
    const rest = safe % 60;
    if (!hours || minutes < 60) {
        return `${minutes}:${String(rest).padStart(2, '0')}`;
    }
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
