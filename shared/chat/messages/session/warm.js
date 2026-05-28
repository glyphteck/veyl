export function warmCandidates(rows, chatPK, pendingDeleteIds, limit) {
    return (Array.isArray(rows) ? rows : [])
        .filter((chatItem) => chatItem?.id && !pendingDeleteIds.has(chatItem.id) && Array.isArray(chatItem.participants) && chatItem.participants.includes(chatPK))
        .slice(0, Math.max(0, limit));
}

export function warmTaskKey(task) {
    if (task?.key) {
        return String(task.key);
    }
    return `${task?.chatId || ''}:${task?.pageSize || 0}`;
}

export function markDiag(diag, label, data) {
    try {
        diag?.(label, data);
    } catch {}
}

export function markDone(diag, label, startedAt, data = {}) {
    markDiag(diag, `${label}.done`, { ...data, elapsedMs: Date.now() - startedAt });
}

export function markError(diag, label, startedAt, error, data = {}) {
    markDiag(diag, `${label}.error`, { ...data, elapsedMs: Date.now() - startedAt, code: error?.code || '', message: error?.message || String(error) });
}
