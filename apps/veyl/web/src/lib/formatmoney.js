const UNITS = ['', 'K', 'M', 'B', 'T'];
function formatNumber(v, units) {
    let i = 0;
    while (v >= 1000 && i < units.length - 1) {
        v /= 1000;
        i++;
    }
    const showDecimals = i === 0 || Math.floor(v) < 100;
    return `${showDecimals ? v.toFixed(2) : Math.round(v)}${units[i]}`;
}
export function formatToSats(amount) {
    const n = typeof amount === 'bigint' ? Number(amount) : amount;
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs < 1000) return `${sign}${abs} ${abs === 1 ? 'sat' : 'sats'}`;
    const formatted = formatNumber(abs, UNITS, 2);
    return `${sign}${formatted} sats`;
}
export function formatToBTC(amount) {
    const n = typeof amount === 'bigint' ? Number(amount) : amount;
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs < 1_000_000) return formatToSats(amount);
    const BTC_PER_SAT = 1 / 100_000_000;
    const btc = abs * BTC_PER_SAT;
    const formatted = formatNumber(btc, UNITS, 2);
    return `${sign}${formatted} ₿`;
}

export function formatToUSD(amount, btcPrice) {
    const n = typeof amount === 'bigint' ? Number(amount) : amount;
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    const BTC_PER_SAT = 1 / 100_000_000;
    const btc = abs * BTC_PER_SAT;
    const usd = btc * btcPrice;
    const formatted = formatNumber(usd, UNITS, 2);
    if (formatted === '0.00') {
        return formatToSats(amount);
    }
    return `${sign}$${formatted}`;
}

export function formatMoney(amount, moneyFormat, btcPrice) {
    if (moneyFormat === 'usd') return formatToUSD(amount, btcPrice);
    if (moneyFormat === 'btc') return formatToBTC(amount);
    return formatToSats(amount);
}
