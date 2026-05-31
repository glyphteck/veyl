export function sameBytes(a, b) {
    if (a === b) {
        return true;
    }
    if (typeof a?.isEqual === 'function') {
        return a.isEqual(b);
    }
    if (typeof b?.isEqual === 'function') {
        return b.isEqual(a);
    }
    if (typeof a?.toUint8Array !== 'function' || typeof b?.toUint8Array !== 'function') {
        return false;
    }

    const left = a.toUint8Array();
    const right = b.toUint8Array();
    if (left.length !== right.length) {
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
