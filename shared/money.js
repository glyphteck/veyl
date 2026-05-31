import { BTC_PRICE_FALLBACK, SATS_PER_BITCOIN } from './config.js';

const UNITS = ['', 'K', 'M', 'B', 'T'];
const BTC_PER_SAT = 1 / Number(SATS_PER_BITCOIN);

function formatCompactNumber(value) {
    let v = value;
    let i = 0;
    while (v >= 1000 && i < UNITS.length - 1) {
        v /= 1000;
        i++;
    }
    const showDecimals = i === 0 || Math.floor(v) < 100;
    return `${showDecimals ? v.toFixed(2) : Math.round(v)}${UNITS[i]}`;
}

export function formatToSats(amount) {
    const n = typeof amount === 'bigint' ? Number(amount) : amount;
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs < 1000) return `${sign}${abs} ${abs === 1 ? 'sat' : 'sats'}`;
    const formatted = formatCompactNumber(abs);
    return `${sign}${formatted} sats`;
}

export function formatToBTC(amount) {
    const n = typeof amount === 'bigint' ? Number(amount) : amount;
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs < 1_000_000) return formatToSats(amount);
    const btc = abs * BTC_PER_SAT;
    const formatted = formatCompactNumber(btc);
    return `${sign}${formatted} ₿`;
}

export function formatToUSD(amount, btcPrice = BTC_PRICE_FALLBACK, options = {}) {
    const { fallbackToSats = true } = options;
    const n = typeof amount === 'bigint' ? Number(amount) : amount;
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    const btc = abs * BTC_PER_SAT;
    const usd = btc * btcPrice;
    const formatted = formatCompactNumber(usd);
    if (formatted === '0.00') {
        if (!fallbackToSats) return abs === 0 ? '$0.00' : sign ? '>-$0.01' : '<$0.01';
        return formatToSats(amount);
    }
    return `${sign}$${formatted}`;
}

export function formatMoney(amount, moneyFormat, btcPrice) {
    if (moneyFormat === 'usd') return formatToUSD(amount, btcPrice);
    if (moneyFormat === 'btc') return formatToBTC(amount);
    return formatToSats(amount);
}

export const MONEY_UNITS = Object.freeze(['sats', 'btc', 'usd']);

export function moneyUnitLabel(unit) {
    if (unit === 'btc') return '₿';
    if (unit === 'usd') return '$';
    return 'sats';
}

export function toSats(value, unit, price) {
    if (!value) return 0n;
    if (unit === 'sats') return BigInt(value || 0);
    if (unit === 'btc') {
        const [whole = '0', decimal = ''] = value.split('.');
        return BigInt(whole) * SATS_PER_BITCOIN + BigInt(decimal.padEnd(8, '0').slice(0, 8));
    }
    const usdValue = parseFloat(value);
    if (Number.isNaN(usdValue)) return 0n;
    return BigInt(Math.round((usdValue * Number(SATS_PER_BITCOIN)) / price));
}

export function toDisplay(sats, unit, price) {
    const satsValue = typeof sats === 'bigint' ? sats : BigInt(sats || 0);
    if (unit === 'sats') return satsValue.toString();
    if (unit === 'btc') {
        const whole = satsValue / SATS_PER_BITCOIN;
        const decimal = (satsValue % SATS_PER_BITCOIN).toString().padStart(8, '0').replace(/0+$/, '');
        return decimal ? `${whole}.${decimal}` : `${whole}`;
    }
    const usdValue = Number(satsValue) * (price / Number(SATS_PER_BITCOIN));
    return usdValue.toFixed(4).replace(/\.?0+$/, '');
}

export function renderMoney(amount, format, price, prefix = '') {
    return prefix + formatMoney(amount, format, price);
}

export function renderBalance(amount, format, price) {
    if (amount == null) return '—';
    return renderMoney(amount, format, price);
}

export function renderNet(amount, format, price) {
    if (amount == null) return '—';
    if (Number(amount) === 0) return 'even';
    return renderMoney(amount, format, price, Number(amount) > 0 ? '+' : '');
}
