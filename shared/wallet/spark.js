import { bech32m } from 'bech32';

export { UNILATERAL_EXIT_MIN_LEAF_SATS as minWithdrawalSats } from './fees.js';

const SPARK_ADDRESS_PREFIX = Object.freeze({
    MAINNET: 'spark',
    TESTNET: 'sparkt',
    REGTEST: 'sparkrt',
    SIGNET: 'sparks',
    LOCAL: 'sparkl',
});

function getSparkAddressPrefix(network) {
    return SPARK_ADDRESS_PREFIX[String(network ?? '').toUpperCase()] ?? SPARK_ADDRESS_PREFIX.REGTEST;
}

function hexToBytes(hex) {
    const value = String(hex ?? '').trim();
    if (value.length % 2 !== 0) {
        throw new Error('invalid hex');
    }

    const bytes = new Uint8Array(value.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        const start = i * 2;
        const byte = Number.parseInt(value.slice(start, start + 2), 16);
        if (Number.isNaN(byte)) {
            throw new Error('invalid hex');
        }
        bytes[i] = byte;
    }
    return bytes;
}

export function walletPKtoSparkAddress(walletPK, network) {
    const key = hexToBytes(walletPK);
    if (key.length !== 33) {
        throw new Error('need 33-byte compressed pubkey');
    }

    const payload = new Uint8Array(2 + key.length);
    payload[0] = 0x0a;
    payload[1] = 0x21;
    payload.set(key, 2);

    return bech32m.encode(getSparkAddressPrefix(network), bech32m.toWords(payload), 1500);
}
