export const BOT_MODE = 'mirror';
export const BOT_UNDERFUNDED_TEXT = 'not enough balance right now';

export function botSecretId(username) {
    const name = String(username ?? '').trim().toLowerCase();
    if (!name) {
        throw new Error('bot secret id requires username');
    }
    return `veyl-bot-${name}-seed`;
}

export function walletEventId(txId) {
    const nextTxId = String(txId ?? '').trim();
    if (!nextTxId) {
        throw new Error('wallet event id requires txId');
    }
    return `wallet:${nextTxId}`;
}
