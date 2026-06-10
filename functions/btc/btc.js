import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, FieldValue } from '../lib/admin.js';
import { devError, devWarn } from '../lib/devlog.js';

const FETCH_TIMEOUT_MS = 8000;

const BTC_SOURCES = [
    {
        name: 'binance.us',
        url: 'https://api.binance.us/api/v3/ticker/price?symbol=BTCUSDT',
        read: (data) => data?.price,
    },
    {
        name: 'coinbase',
        url: 'https://api.exchange.coinbase.com/products/BTC-USD/ticker',
        read: (data) => data?.price,
    },
    {
        name: 'kraken',
        url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
        read: (data) => data?.result?.XXBTZUSD?.c?.[0],
    },
];

const MEMPOOL_SOURCES = {
    block: {
        name: 'mempool.block',
        url: 'https://mempool.space/api/blocks/tip/height',
        read: async (response) => Number(await response.text()),
    },
    fees: {
        name: 'mempool.fees',
        url: 'https://mempool.space/api/v1/fees/recommended',
        read: async (response) => response.json(),
    },
};

async function fetchSource(source) {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
        throw new Error(`${source.name} returned ${response.status}`);
    }
    return source.read(response);
}

async function getBlockHeight() {
    const block = await fetchSource(MEMPOOL_SOURCES.block);
    if (!Number.isSafeInteger(block) || block <= 0) {
        throw new Error('mempool.block returned an invalid block height');
    }
    return block;
}

async function getSourcePrice(source) {
    const data = await fetchSource({ ...source, read: (response) => response.json() });
    const price = Number(source.read(data));
    if (!Number.isFinite(price) || price <= 0) {
        throw new Error(`${source.name} returned an invalid BTC price`);
    }

    return {
        name: source.name,
        price,
    };
}

function roundFeeRate(value) {
    if (!Number.isFinite(value) || value < 0) {
        return null;
    }
    return Math.round(value * 100) / 100;
}

function readFeeRate(data, key) {
    const feeRate = roundFeeRate(Number(data?.[key]));
    return feeRate > 0 ? feeRate : null;
}

function firstFeeRate(data, keys) {
    for (const key of keys) {
        const feeRate = readFeeRate(data, key);
        if (feeRate != null) {
            return feeRate;
        }
    }
    return null;
}

function normalizeFeeRates(data) {
    const low = firstFeeRate(data, ['minimumFee', 'economyFee', 'hourFee']);
    const medium = firstFeeRate(data, ['halfHourFee', 'hourFee', 'economyFee', 'minimumFee']);
    const high = firstFeeRate(data, ['fastestFee', 'halfHourFee', 'hourFee']);
    const fallback = low ?? medium ?? high;

    if (fallback == null) {
        throw new Error('mempool.fees returned no valid fee rates');
    }

    return {
        source: 'mempool.space',
        satPerVbyte: {
            low: low ?? fallback,
            medium: medium ?? fallback,
            high: high ?? fallback,
        },
        updatedAtIso: new Date().toISOString(),
    };
}

async function getBitcoinFees() {
    return normalizeFeeRates(await fetchSource(MEMPOOL_SOURCES.fees));
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/* Get BTC price from public exchange tickers */
async function getBTCprice() {
    const results = await Promise.allSettled(BTC_SOURCES.map(getSourcePrice));
    const prices = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    const errors = results.flatMap((result, index) => (result.status === 'rejected' ? [`${BTC_SOURCES[index].name}: ${result.reason?.message ?? result.reason}`] : []));

    if (prices.length < 2) {
        throw new Error(`Only ${prices.length} BTC price source(s) succeeded: ${errors.join('; ')}`);
    }

    if (errors.length > 0) {
        devWarn('BTC price source failures:', errors.join('; '));
    }

    return {
        price: median(prices.map((source) => source.price)),
        sources: prices,
    };
}

export const getBTCdata = onSchedule({ schedule: '* * * * *', timeZone: 'America/Los_Angeles', timeoutSeconds: 45, maxInstances: 1 }, async () => {
    const [btcResult, blockResult, feeResult] = await Promise.allSettled([getBTCprice(), getBlockHeight(), getBitcoinFees()]);
    const payload = {};

    if (btcResult.status === 'fulfilled') {
        payload.price = btcResult.value.price;
        payload.sources = btcResult.value.sources;
    } else {
        devError('Error fetching BTC price:', btcResult.reason);
    }

    if (blockResult.status === 'fulfilled') {
        payload.block = blockResult.value;
    } else {
        devError('Error fetching block height:', blockResult.reason);
    }

    if (feeResult.status === 'fulfilled') {
        payload.fees = feeResult.value;
    } else {
        devError('Error fetching Bitcoin fee data:', feeResult.reason);
    }

    if (Object.keys(payload).length) {
        const ref = db.collection('bitcoin').doc('current');
        const next = {
            ...payload,
            updatedAt: FieldValue.serverTimestamp(),
        };

        try {
            await ref.update(next);
        } catch (error) {
            if (error?.code !== 5 && error?.code !== 'not-found') {
                throw error;
            }
            await ref.set(next, { merge: true });
        }
    }
});
