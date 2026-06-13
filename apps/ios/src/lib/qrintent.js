import AsyncStorage from '@react-native-async-storage/async-storage';
import { qr } from '@veyl/shared/qr';
import { cleanText, lowerText } from '@veyl/shared/utils/text';

const PENDING_QR_INTENT_KEY = 'veyl.pendingQrIntent';

export const qrIntent = Object.freeze({
    payment: 'payment',
    withdraw: 'withdraw',
});

function maybe(value) {
    const next = cleanText(value);
    return next || null;
}

function cleanIntent(value) {
    if (!value || typeof value !== 'object') return null;

    if (value.kind === qrIntent.payment) {
        const invoiceType = lowerText(value.invoiceType);
        const invoice = maybe(value.invoice);
        const walletPK = maybe(value.walletPK);
        const username = maybe(value.username);
        if ((invoiceType === qr.lightning || invoiceType === qr.spark) && invoice) {
            return {
                kind: qrIntent.payment,
                invoiceType,
                invoice,
                ...(username ? { username } : {}),
                ...(walletPK ? { walletPK } : {}),
                ...(maybe(value.amount) ? { amount: maybe(value.amount) } : {}),
            };
        }
        if (walletPK) {
            return {
                kind: qrIntent.payment,
                walletPK,
                ...(maybe(value.amount) ? { amount: maybe(value.amount) } : {}),
            };
        }
    }

    if (value.kind === qrIntent.withdraw) {
        const address = maybe(value.address);
        return address ? { kind: qrIntent.withdraw, address } : null;
    }

    return null;
}

export function qrIntentFromData(data) {
    if (data?.kind === qr.request && data.to) {
        return cleanIntent({
            kind: qrIntent.payment,
            walletPK: data.to,
            amount: data.amount,
        });
    }

    if (data?.kind === qr.lightning || data?.kind === qr.spark) {
        return cleanIntent({
            kind: qrIntent.payment,
            invoiceType: data.kind,
            invoice: data.invoice,
            username: data.username,
            walletPK: data.walletPK,
            amount: data.amount,
        });
    }

    if (data?.kind === qr.bitcoin && data.address) {
        return cleanIntent({
            kind: qrIntent.withdraw,
            address: data.address,
        });
    }

    return null;
}

export async function writePendingQrIntent(value) {
    const intent = cleanIntent(value) || qrIntentFromData(value);
    if (!intent) return null;

    try {
        await AsyncStorage.setItem(PENDING_QR_INTENT_KEY, JSON.stringify(intent));
        return intent;
    } catch {
        return null;
    }
}

export async function readPendingQrIntent() {
    try {
        return cleanIntent(JSON.parse(await AsyncStorage.getItem(PENDING_QR_INTENT_KEY)));
    } catch {
        return null;
    }
}

export async function dropPendingQrIntent() {
    try {
        await AsyncStorage.removeItem(PENDING_QR_INTENT_KEY);
    } catch {}
}
