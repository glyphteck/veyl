export function makeChatLastMsg(msgData) {
    return {
        head: msgData.head,
        body: msgData.body,
        ttl: msgData.ttl,
    };
}

export function makeUpdatedChatLastMsg(lastMsg, fields = {}) {
    return {
        head: lastMsg?.head,
        body: fields.body ?? lastMsg?.body,
        ttl: 'ttl' in fields ? fields.ttl : (lastMsg?.ttl ?? null),
    };
}
