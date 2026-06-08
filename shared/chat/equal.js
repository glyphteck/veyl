import { toBytes } from '../crypto/core.js';

function readableBytes(value) {
    try {
        return value == null ? null : toBytes(value, 'chat bytes');
    } catch {
        return null;
    }
}

export function sameBytes(a, b) {
    if (a === b) {
        return true;
    }

    const left = readableBytes(a);
    const right = readableBytes(b);
    if (!left || !right || left.length !== right.length) {
        return false;
    }

    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }
    return true;
}

export function sameHead(a, b) {
    if (a === b) {
        return true;
    }
    return a?.from === b?.from && a?.cid === b?.cid;
}
