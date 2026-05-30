export const BOT_MODE = 'mirror';
export const BOT_UNDERFUNDED_TEXT = 'not enough balance right now';
export const BOT_SEEDS_SECRET_ID = 'veyl-bot-seeds';
export const BOT_RUNTIME_DOC_ID = 'bot';
export const BOT_RUNTIME_LEASE_MS = 45000;
export const BOT_RUNTIME_ACTIONS = 'actions';
export const BOT_ACTION_TYPE_BURST = 'burst';
export const BOT_ACTION_STATUS_QUEUED = 'queued';
export const BOT_ACTION_STATUS_RUNNING = 'running';
export const BOT_ACTION_STATUS_DONE = 'done';
export const BOT_ACTION_STATUS_ERROR = 'error';

export function botSeedKey(username) {
    const name = String(username ?? '').trim().toLowerCase();
    if (!name) {
        throw new Error('bot seed key requires username');
    }
    return name;
}

export function walletEventId(txId) {
    const nextTxId = String(txId ?? '').trim();
    if (!nextTxId) {
        throw new Error('wallet event id requires txId');
    }
    return `wallet:${nextTxId}`;
}
