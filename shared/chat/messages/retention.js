import { cleanChatRetention, hasChatRetention } from '../ttl.js';

export function retentionPatch(message) {
    return hasChatRetention(message?.retention) ? { retention: cleanChatRetention(message.retention) } : {};
}
