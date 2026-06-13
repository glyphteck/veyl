import { appLinkDomains, origins } from './links.js';
import { getRouteParam } from './navigation/params.js';
import { isUsername, normalizeUsername } from './username.js';
import { cleanText, lowerText } from './utils/text.js';

function getQrOrigin() {
    return origins.veyl;
}

const tx = {
    request: 'req',
    payment: 'pay',
};
const qrHosts = new Set(appLinkDomains);

export const qr = Object.freeze({
    user: 'user',
    request: 'request',
    payment: 'payment',
    bitcoin: 'bitcoin',
    lightning: 'lightning',
    spark: 'spark',
});

function maybe(value) {
    const next = cleanText(value);
    return next || null;
}

function userHandle(value) {
    const next = maybe(value);
    if (!next) return null;

    const raw = next.startsWith('@') ? next.slice(1) : next;
    const username = normalizeUsername(raw);
    return isUsername(username) ? username : null;
}

function readUser(value) {
    const username = userHandle(typeof value === 'string' ? value : (value?.u ?? value?.username));
    if (!username) return null;

    return {
        kind: qr.user,
        username,
    };
}

function readTx(value) {
    if (!value || typeof value !== 'object') return null;

    const tag = maybe(value.t ?? value.type);
    const to = maybe(value.r ?? value.to ?? value.receiver);
    if (!tag || !to) return null;
    if (tag !== tx.request && tag !== tx.payment) return null;

    return {
        kind: tag === tx.request ? qr.request : qr.payment,
        to,
        from: maybe(value.s ?? value.from ?? value.sender),
        amount: maybe(value.a ?? value.amount),
        currency: maybe(value.c ?? value.currency),
        pay: maybe(value.p ?? value.pay ?? value.payment ?? value.paymentType),
        message: maybe(value.m ?? value.message),
    };
}

function readQrUrlParams(value) {
    try {
        const url = new URL(value, getQrOrigin());
        if (url.protocol !== 'https:' || url.pathname !== '/qr' || !qrHosts.has(url.hostname)) {
            return null;
        }
        return url.searchParams;
    } catch {
        return null;
    }
}

function readParams(params) {
    const user = readUser({
        u: getRouteParam(params, 'u'),
        username: getRouteParam(params, 'username'),
    });
    if (user) return user;

    const request = readTx({
        t: tx.request,
        r: getRouteParam(params, 'r'),
        s: getRouteParam(params, 's'),
        a: getRouteParam(params, 'a'),
        c: getRouteParam(params, 'c'),
        p: getRouteParam(params, 'p'),
        m: getRouteParam(params, 'm'),
    });
    if (request) return request;

    const lightning = readLightning({
        invoice: getRouteParam(params, 'l') || getRouteParam(params, 'lightning') || getRouteParam(params, 'invoice'),
        username: getRouteParam(params, 'lu') || getRouteParam(params, 'lightningUser'),
        walletPK: getRouteParam(params, 'lw') || getRouteParam(params, 'lightningWalletPK'),
    });
    if (lightning) return lightning;

    const spark = readSpark(getRouteParam(params, 's') || getRouteParam(params, 'spark'));
    if (spark) return spark;

    const address = readBitcoin(getRouteParam(params, 'b'));
    if (!address) return null;

    return {
        kind: qr.bitcoin,
        address,
    };
}

function makeLink(params) {
    const query = Object.entries(params)
        .map(([key, value]) => {
            const next = maybe(value);
            return next ? `${encodeURIComponent(key)}=${encodeURIComponent(next)}` : null;
        })
        .filter(Boolean)
        .join('&');

    return query ? `${getQrOrigin()}/qr?${query}` : null;
}

function makeUserValue(value) {
    const user = makeUserQr(value);
    return user ? makeLink({ u: user.u }) : null;
}

function makeBitcoinValue(value) {
    const address = readBitcoin(value);
    return address ? `bitcoin:${address}` : null;
}

function getLightningInvoice(value) {
    const raw = cleanText(typeof value === 'string' ? value : (value?.invoice ?? value?.encodedInvoice ?? value?.bolt11));
    const lower = lowerText(raw);
    if (!lower) return null;

    const invoice = lower.startsWith('lightning://') ? raw.slice(12).trim() : lower.startsWith('lightning:') ? raw.slice(10).trim() : raw;
    const normalized = lowerText(invoice);
    return /^ln[a-z0-9]+$/.test(normalized) ? invoice : null;
}

function ceilDiv(value, divisor) {
    return (value + divisor - 1n) / divisor;
}

function lightningAmountSats(invoice) {
    const value = lowerText(invoice);
    const match = value.match(/^ln(?:bcrt|bc|tb|sb|tbs)(\d+[munp]?)?1/);
    const amount = match?.[1];
    if (!amount) return null;

    const unit = /[munp]$/.test(amount) ? amount.slice(-1) : '';
    const raw = unit ? amount.slice(0, -1) : amount;
    if (!/^\d+$/.test(raw)) return null;

    const n = BigInt(raw);
    switch (unit) {
        case 'm':
            return n * 100000n;
        case 'u':
            return n * 100n;
        case 'n':
            return ceilDiv(n, 10n);
        case 'p':
            return ceilDiv(n, 10000n);
        default:
            return n * 100000000n;
    }
}

function readLightning(value) {
    const invoice = getLightningInvoice(value);
    if (!invoice) return null;
    const amountSats = lightningAmountSats(invoice);
    const username = userHandle(typeof value === 'object' ? value?.username ?? value?.user ?? value?.lu : null);
    const walletPK = maybe(typeof value === 'object' ? value?.walletPK ?? value?.receiver ?? value?.lw : null);
    return {
        kind: qr.lightning,
        invoice,
        ...(username ? { username } : {}),
        ...(walletPK ? { walletPK } : {}),
        ...(amountSats != null && amountSats > 0n ? { amount: amountSats.toString() } : {}),
    };
}

function makeLightningValue(value) {
    const invoice = getLightningInvoice(value);
    if (!invoice) return null;

    const username = userHandle(typeof value === 'object' ? value?.username ?? value?.user ?? value?.lu : null);
    const walletPK = maybe(typeof value === 'object' ? value?.walletPK ?? value?.receiver ?? value?.lw : null);
    return makeLink({ l: invoice, lu: username, lw: walletPK });
}

export function makeLightningInvoiceQr(value) {
    const invoice = getLightningInvoice(value);
    return invoice ? `lightning:${invoice}` : null;
}

function getSparkInvoice(value) {
    const raw = cleanText(typeof value === 'string' ? value : (value?.invoice ?? value?.sparkInvoice ?? value?.address));
    const lower = lowerText(raw);
    if (!lower) return null;
    return /^(spark|sparkt|sparkrt|sparks|sparkl)1[023456789acdefghjklmnpqrstuvwxyz]+$/.test(lower) ? raw : null;
}

function readSpark(value) {
    const invoice = getSparkInvoice(value);
    return invoice
        ? {
              kind: qr.spark,
              invoice,
          }
        : null;
}

function makeSparkValue(value) {
    return getSparkInvoice(value);
}

function readApp(raw) {
    if (raw && typeof raw === 'object') {
        return readParams(raw);
    }

    const value = cleanText(raw);
    if (!value) return null;

    const params = readQrUrlParams(value);
    if (params) return readParams(params);
    return value.startsWith('@') ? readUser(value) : null;
}

function readBitcoin(value) {
    const raw = cleanText(value);
    let clean = raw;
    if (lowerText(raw).startsWith('bitcoin:')) clean = raw.slice(8);

    const legacy = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
    const bech32 = /^(bc1|bcrt1)[ac-hj-np-z02-9]{39,87}$/i;
    return legacy.test(clean) || bech32.test(clean) ? clean : null;
}

export function makeUserQr(value) {
    const user = readUser(value);
    if (!user) return null;
    return { u: user.username };
}

export function makeRequestQr(value) {
    const request = readTx({
        t: tx.request,
        r: value?.r ?? value?.to ?? value?.receiver,
        s: value?.s ?? value?.from ?? value?.sender,
        a: value?.a ?? value?.amount,
        c: value?.c ?? value?.currency,
        p: value?.p ?? value?.pay ?? value?.payment ?? value?.paymentType,
        m: value?.m ?? value?.message,
    });

    if (!request || request.kind !== qr.request) return null;

    return {
        t: tx.request,
        r: request.to,
        ...(request.amount ? { a: request.amount } : {}),
        ...(request.from ? { s: request.from } : {}),
        ...(request.currency ? { c: request.currency } : {}),
        ...(request.pay ? { p: request.pay } : {}),
        ...(request.message ? { m: request.message } : {}),
    };
}

export function readQr(raw) {
    const veyl = readApp(raw);
    if (veyl) return veyl;

    const lightning = readLightning(raw);
    if (lightning) return lightning;

    const spark = readSpark(raw);
    if (spark) return spark;

    const address = readBitcoin(raw);
    if (!address) return null;

    return {
        kind: qr.bitcoin,
        address,
    };
}

export function makeQr(data) {
    if (!data) return null;

    if (data.type === qr.lightning) {
        return makeLightningValue(data.value);
    }

    if (data.type === qr.spark) {
        return makeSparkValue(data.value);
    }

    if (data.type === qr.bitcoin) {
        return makeBitcoinValue(data.value);
    }

    if (data.type === qr.user) {
        return makeUserValue(data.value);
    }

    if (data.type === qr.request) {
        const request = makeRequestQr(data.value);
        if (!request) return null;
        return makeLink({
            r: request.r,
            a: request.a,
            s: request.s,
            c: request.c,
            p: request.p,
            m: request.m,
        });
    }

    return null;
}
