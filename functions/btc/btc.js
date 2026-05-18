import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, FieldValue } from '../lib/admin.js';

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
    feeBlocks: {
        name: 'mempool.fee_blocks',
        url: 'https://mempool.space/api/v1/fees/mempool-blocks',
        read: async (response) => response.json(),
    },
    mempool: {
        name: 'mempool.stats',
        url: 'https://mempool.space/api/mempool',
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
    const value = Number(data?.[key]);
    return Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeFeeHistogram(feeHistogram) {
    if (!Array.isArray(feeHistogram)) {
        return [];
    }

    return feeHistogram
        .map((bucket) => {
            const [rate, vsize] = Array.isArray(bucket) ? bucket : [];
            const feeRate = roundFeeRate(Number(rate));
            const size = Number(vsize);
            if (feeRate == null || !Number.isFinite(size) || size < 0) {
                return null;
            }
            return {
                satPerVbyte: feeRate,
                vsize: size,
            };
        })
        .filter(Boolean);
}

function normalizeMempoolStats(data) {
    const count = Number(data?.count);
    const vsize = Number(data?.vsize);
    const totalFee = Number(data?.total_fee);
    const averageFeeRate = vsize > 0 && Number.isFinite(totalFee) ? roundFeeRate(totalFee / vsize) : null;

    return {
        count: Number.isSafeInteger(count) && count >= 0 ? count : null,
        vsize: Number.isFinite(vsize) && vsize >= 0 ? vsize : null,
        totalFee: Number.isFinite(totalFee) && totalFee >= 0 ? totalFee : null,
        averageFeeRate,
        feeHistogram: normalizeFeeHistogram(data?.fee_histogram),
    };
}

function normalizeFeeRange(feeRange) {
    if (!Array.isArray(feeRange)) {
        return {};
    }

    return Object.fromEntries(
        feeRange
            .map((value, index) => {
                const feeRate = roundFeeRate(Number(value));
                return feeRate == null ? null : [`r${index}`, feeRate];
            })
            .filter(Boolean)
    );
}

function normalizeMempoolBlocks(data) {
    if (!Array.isArray(data)) {
        return [];
    }

    return data
        .map((block, index) => {
            const blockVSize = Number(block?.blockVSize);
            const blockSize = Number(block?.blockSize);
            const nTx = Number(block?.nTx);
            const totalFees = Number(block?.totalFees);
            const medianFee = roundFeeRate(Number(block?.medianFee));
            const feeRange = normalizeFeeRange(block?.feeRange);
            const feeRangeValues = Object.values(feeRange);

            if (medianFee == null && !feeRangeValues.length) {
                return null;
            }

            return {
                index,
                blockSize: Number.isFinite(blockSize) && blockSize >= 0 ? blockSize : null,
                blockVSize: Number.isFinite(blockVSize) && blockVSize >= 0 ? blockVSize : null,
                nTx: Number.isSafeInteger(nTx) && nTx >= 0 ? nTx : null,
                totalFees: Number.isFinite(totalFees) && totalFees >= 0 ? totalFees : null,
                medianFee,
                feeRange,
            };
        })
        .filter(Boolean);
}

function firstNumber(...values) {
    return values.find((value) => Number.isFinite(value) && value >= 0) ?? null;
}

function getNormalMempoolBlocks(blocks) {
    const normalBlocks = blocks.filter((block) => block.blockVSize == null || block.blockVSize <= 1100000);
    return normalBlocks.length ? normalBlocks : blocks;
}

function getLast(values) {
    return values.length ? values[values.length - 1] : null;
}

function getLastFeeRangeValue(feeRange) {
    return getLast(Object.values(feeRange ?? {}));
}

function derivePriorityFeeRates(recommended, mempool, mempoolBlocks) {
    const normalBlocks = getNormalMempoolBlocks(mempoolBlocks);
    const firstBlock = normalBlocks[0] ?? null;
    const secondBlock = normalBlocks[1] ?? null;
    const lastBlock = getLast(normalBlocks);

    const noPriority = firstNumber(lastBlock?.medianFee, recommended.minimum, recommended.economy, mempool?.averageFeeRate);
    const low = firstNumber(secondBlock?.medianFee, recommended.economy, recommended.hour, noPriority);
    const medium = firstNumber(firstBlock?.medianFee, recommended.halfHour, recommended.hour, low, mempool?.averageFeeRate);
    const high = firstNumber(recommended.fastest, getLastFeeRangeValue(firstBlock?.feeRange), recommended.halfHour, medium);

    return {
        noPriority,
        low,
        medium,
        high,
    };
}

function normalizeFeeRates(data, mempool = null, mempoolBlocks = []) {
    const recommended = {
        fastest: readFeeRate(data, 'fastestFee'),
        halfHour: readFeeRate(data, 'halfHourFee'),
        hour: readFeeRate(data, 'hourFee'),
        economy: readFeeRate(data, 'economyFee'),
        minimum: readFeeRate(data, 'minimumFee'),
    };
    const rateValues = Object.values(recommended).filter((value) => value != null);
    if (!rateValues.length && mempool?.averageFeeRate == null && !mempoolBlocks.length) {
        throw new Error('mempool.fees returned no valid fee rates');
    }

    const priority = derivePriorityFeeRates(recommended, mempool, mempoolBlocks);
    const satPerVbyte = {
        average: mempool?.averageFeeRate ?? roundFeeRate(median(rateValues)),
        default: priority.medium,
        noPriority: priority.noPriority,
        low: priority.low,
        medium: priority.medium,
        high: priority.high,
        ...recommended,
    };

    return {
        source: 'mempool.space',
        averageSatPerVbyte: satPerVbyte.average,
        satPerVbyte,
        priority,
        recommended,
        mempool,
        mempoolBlocks,
        updatedAtIso: new Date().toISOString(),
    };
}

async function getBitcoinFees() {
    const [feeResult, mempoolResult, feeBlocksResult] = await Promise.allSettled([fetchSource(MEMPOOL_SOURCES.fees), fetchSource(MEMPOOL_SOURCES.mempool), fetchSource(MEMPOOL_SOURCES.feeBlocks)]);
    const feeError = feeResult.status === 'rejected' ? feeResult.reason : null;
    const mempoolError = mempoolResult.status === 'rejected' ? mempoolResult.reason : null;
    const feeBlocksError = feeBlocksResult.status === 'rejected' ? feeBlocksResult.reason : null;
    const mempool = mempoolResult.status === 'fulfilled' ? normalizeMempoolStats(mempoolResult.value) : null;
    const mempoolBlocks = feeBlocksResult.status === 'fulfilled' ? normalizeMempoolBlocks(feeBlocksResult.value) : [];

    if (feeResult.status === 'rejected' && !mempool && !mempoolBlocks.length) {
        throw new Error(`No Bitcoin fee source succeeded: ${feeError?.message ?? feeError}`);
    }

    if (feeError) {
        console.warn('Bitcoin fee source failure:', feeError?.message ?? feeError);
    }
    if (mempoolError) {
        console.warn('Bitcoin mempool source failure:', mempoolError?.message ?? mempoolError);
    }
    if (feeBlocksError) {
        console.warn('Bitcoin mempool block source failure:', feeBlocksError?.message ?? feeBlocksError);
    }

    return normalizeFeeRates(feeResult.status === 'fulfilled' ? feeResult.value : {}, mempool, mempoolBlocks);
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

export const getBTCdata = onSchedule({ schedule: '* * * * *', timeZone: 'America/Los_Angeles', timeoutSeconds: 45, maxInstances: 1 }, async () => {
    const [btcResult, blockResult, feeResult] = await Promise.allSettled([getBTCprice(), getBlockHeight(), getBitcoinFees()]);
    const payload = {};

    if (btcResult.status === 'fulfilled') {
        payload.price = btcResult.value.price;
        payload.sources = btcResult.value.sources;
    } else {
        console.error('Error fetching BTC price:', btcResult.reason);
    }

    if (blockResult.status === 'fulfilled') {
        payload.block = blockResult.value;
    } else {
        console.error('Error fetching block height:', blockResult.reason);
    }

    if (feeResult.status === 'fulfilled') {
        payload.fees = feeResult.value;
    } else {
        console.error('Error fetching Bitcoin fee data:', feeResult.reason);
    }

    if (Object.keys(payload).length) {
        await db.collection('bitcoin').doc('current').set(
            {
                ...payload,
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
    }
});
