import { domains } from './links.js';
import { getAppOrigin, resolveNetwork } from './network.js';

function getQrOrigin() {
    const origin = globalThis?.location?.origin;
    const host = globalThis?.location?.hostname;
    if (host === domains.veylDev) {
        return getAppOrigin('REGTEST');
    }
    if (origin && host && (host === domains.veyl || host === domains.veylTest)) {
        return origin;
    }

    return getAppOrigin(resolveNetwork(globalThis?.process?.env ?? {}));
}

const tx = {
    request: 'req',
    payment: 'pay',
};

export const qr = Object.freeze({
    user: 'user',
    request: 'request',
    payment: 'payment',
    bitcoin: 'bitcoin',
});

function text(value) {
    if (value == null) return '';
    return String(value).trim();
}

function maybe(value) {
    const next = text(value);
    return next || null;
}

function cleanUsername(value) {
    const next = maybe(value);
    return next?.startsWith('@') ? maybe(next.slice(1)) : next;
}

function readUser(value) {
    const username = cleanUsername(typeof value === 'string' ? value : (value?.u ?? value?.username));
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

function pickParam(value, key) {
    const raw = typeof value?.get === 'function' ? value.get(key) : value?.[key];
    if (Array.isArray(raw)) return raw[0] ?? null;
    return raw;
}

function decodeParam(value) {
    try {
        return decodeURIComponent(String(value).replace(/\+/g, ' '));
    } catch {
        return value;
    }
}

function parseQuery(value) {
    const start = value.indexOf('?');
    if (start < 0) return null;

    const hash = value.indexOf('#', start + 1);
    const query = value.slice(start + 1, hash < 0 ? undefined : hash);
    if (!query) return null;

    return Object.fromEntries(
        query
            .split('&')
            .map((part) => {
                const eq = part.indexOf('=');
                const key = decodeParam(eq < 0 ? part : part.slice(0, eq));
                const val = decodeParam(eq < 0 ? '' : part.slice(eq + 1));
                return [key, val];
            })
            .filter(([key]) => key)
    );
}

function readParams(params) {
    const user = readUser({ username: pickParam(params, 'u') });
    if (user) return user;

    const request = readTx({
        t: tx.request,
        r: pickParam(params, 'r'),
        s: pickParam(params, 's'),
        a: pickParam(params, 'a'),
        c: pickParam(params, 'c'),
        p: pickParam(params, 'p'),
        m: pickParam(params, 'm'),
    });
    if (request) return request;

    const address = readBitcoin(pickParam(params, 'b'));
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
    return user ? makeLink(user) : null;
}

function makeBitcoinValue(value) {
    const address = readBitcoin(value);
    return address ? `bitcoin:${address}` : null;
}

function readApp(raw) {
    if (raw && typeof raw === 'object') {
        return readParams(raw);
    }

    const value = text(raw);
    if (!value) return null;

    const params = parseQuery(value);
    return params ? readParams(params) : null;
}

function readBitcoin(value) {
    const raw = text(value);
    let clean = raw;
    if (raw.toLowerCase().startsWith('bitcoin:')) clean = raw.slice(8);

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

    const address = readBitcoin(raw);
    if (!address) return null;

    return {
        kind: qr.bitcoin,
        address,
    };
}

export function makeQr(data) {
    if (!data) return null;

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
