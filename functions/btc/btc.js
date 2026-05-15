import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, FieldValue } from '../lib/admin.js';

const BTC_SOURCES = [
    {
        name: 'binance',
        url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
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

/* Get current block height from mempool.space */
async function getBlockHeight() {
    try {
        const r = await fetch('https://mempool.space/api/blocks/tip/height');
        if (!r.ok) throw new Error('Failed to fetch block height');
        return await r.json();
    } catch (e) {
        console.error('Error fetching block height:', e);
        throw e;
    }
}

async function getSourcePrice(source) {
    const r = await fetch(source.url);
    if (!r.ok) {
        throw new Error(`${source.name} returned ${r.status}`);
    }

    const data = await r.json();
    const price = Number(source.read(data));
    if (!Number.isFinite(price) || price <= 0) {
        throw new Error(`${source.name} returned an invalid BTC price`);
    }

    return {
        name: source.name,
        price,
    };
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
        console.warn('BTC price source failures:', errors.join('; '));
    }

    return {
        price: median(prices.map((source) => source.price)),
        sources: prices,
    };
}

export const getBTCdata = onSchedule({ schedule: '* * * * *', timeZone: 'America/Los_Angeles' }, async () => {
    try {
        const [btc, block] = await Promise.all([getBTCprice(), getBlockHeight()]);
        await db.collection('bitcoin').doc('current').set(
            {
                price: btc.price,
                sources: btc.sources,
                block,
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
    } catch (e) {
        console.error('Error fetching BTC data:', e);
    }
});
