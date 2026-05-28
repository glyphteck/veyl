export const BOT_MODE = 'mirror';
export const BOT_UNDERFUNDED_TEXT = 'not enough balance right now';
export const BOT_SEEDS_SECRET_ID = 'veyl-bot-seeds';

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
