import { runMessageAutoDelete } from '../autodelete.js';
import { compactMessages } from '../compact.js';
import { markDone, markError } from '../../../utils/diagnostics.js';

function isDenied(error) {
    return error?.code === 'permission-denied';
}

export function runMessageBatchCleanup({ entry, options = {}, chatBanned, isActive, chatPK, deleteMessages, markMessagesHidden, diag, onExpire, getCurrentEntry, notifyPreviewDrop, notify }) {
    if (chatBanned || !isActive || !chatPK || !entry?.chatId || !entry.peerChatPK || !entry.ready || entry.exists === false || !entry.messages?.length || typeof deleteMessages !== 'function') {
        return;
    }

    const cleanHiddenMessages = options.hiddenCleanup !== false;
    const writeCheckpoint = cleanHiddenMessages && options.writeCheckpoint !== false && typeof markMessagesHidden === 'function';
    const compactControls = options.compactControls !== false;
    if (!cleanHiddenMessages && !compactControls) {
        return;
    }

    const chatId = entry.chatId;
    const peerChatPK = entry.peerChatPK;
    const generation = entry.generation;
    const messages = entry.messages.slice();
    const deletedKeys = entry.deletedKeys instanceof Set ? entry.deletedKeys : new Set(entry.deletedKeys || []);
    const autoDeleteState = entry.autoDeleteState || { checkpointMs: 0, pendingCheckpointMs: 0 };
    entry.deletedKeys = deletedKeys;
    entry.autoDeleteState = autoDeleteState;

    void Promise.resolve()
        .then(async () => {
            const dropped = [];
            const startedAt = Date.now();

            if (cleanHiddenMessages) {
                const result = await runMessageAutoDelete({
                    chatId,
                    messages,
                    chatPK,
                    peerChatPK,
                    keepKeys: options.keepKeys,
                    deletedKeys,
                    state: autoDeleteState,
                    writeHiddenCheckpoint: writeCheckpoint ? (target) => markMessagesHidden(chatId, target, peerChatPK) : null,
                    deleteMessages: (targets) => deleteMessages(chatId, targets, peerChatPK),
                });
                if (result?.deleted?.length) {
                    dropped.push(...result.deleted);
                }
            }

            if (compactControls) {
                const compacted = await compactMessages({
                    chatId,
                    messages,
                    deletedKeys,
                    deleteMessages: (targets) => deleteMessages(chatId, targets, peerChatPK),
                });
                if (compacted.length) {
                    dropped.push(...compacted);
                }
            }

            if (dropped.length) {
                markDone(diag, 'chat.message.cleanup', startedAt, {
                    hiddenCleanup: cleanHiddenMessages,
                    writeCheckpoint,
                    compactControls,
                    droppedCount: dropped.length,
                });
            }

            const current = getCurrentEntry?.(chatId);
            if (current !== entry || current.generation !== generation || !dropped.length) {
                return;
            }

            notifyPreviewDrop(onExpire, chatId, dropped, current.messages, chatPK, peerChatPK);
            notify(current);
        })
        .catch((error) => {
            if (!isDenied(error)) {
                markError(diag, 'chat.message.cleanup', Date.now(), error, {
                    hiddenCleanup: cleanHiddenMessages,
                    writeCheckpoint,
                    compactControls,
                });
            }
        });
}
