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
