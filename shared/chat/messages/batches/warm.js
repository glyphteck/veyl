export function warmCandidates(chats, chatPK, pendingDeleteIds, limit) {
    return (Array.isArray(chats) ? chats : [])
        .filter((chatItem) => chatItem?.id && !pendingDeleteIds.has(chatItem.id) && chatItem.peerChatPK)
        .slice(0, Math.max(0, limit));
}

export function warmTaskKey(task) {
    if (task?.key) {
        return String(task.key);
    }
    return `${task?.chatId || ''}:${task?.pageSize || 0}`;
}
