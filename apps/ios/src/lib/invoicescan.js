import { qr } from '@veyl/shared/qr';
import { cleanText, lowerText } from '@veyl/shared/utils/text';

const SUPPRESS_MS = 10 * 60 * 1000;
const suppressedInvoices = new Map();

function invoiceKey({ type, invoice } = {}) {
    const invoiceType = lowerText(type);
    if (invoiceType !== qr.lightning && invoiceType !== qr.spark) return null;

    const value = lowerText(cleanText(invoice));
    return value ? `${invoiceType}:${value}` : null;
}

function pruneSuppressedInvoices(now = Date.now()) {
    for (const [key, expiresAt] of suppressedInvoices.entries()) {
        if (expiresAt <= now) suppressedInvoices.delete(key);
    }
}

export function suppressInvoiceScan(value) {
    const key = invoiceKey(value);
    if (!key) return false;

    pruneSuppressedInvoices();
    suppressedInvoices.set(key, Date.now() + SUPPRESS_MS);
    return true;
}

export function releaseInvoiceScan(value) {
    const key = invoiceKey(value);
    if (!key) return;
    suppressedInvoices.delete(key);
}

export function isInvoiceScanSuppressed(value) {
    const key = invoiceKey(value);
    if (!key) return false;

    const now = Date.now();
    pruneSuppressedInvoices(now);
    return (suppressedInvoices.get(key) || 0) > now;
}
