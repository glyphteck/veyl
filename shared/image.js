'use client';

export function bytesView(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return null;
}

function imageKind(bytes) {
    const body = bytesView(bytes);
    if (!body) return null;
    if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'jpeg';
    if (body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) return 'png';
    if (body[0] === 0x47 && body[1] === 0x49 && body[2] === 0x46) return 'gif';
    if (body[0] === 0x52 && body[1] === 0x49 && body[2] === 0x46 && body[3] === 0x46 && body[8] === 0x57 && body[9] === 0x45 && body[10] === 0x42 && body[11] === 0x50) return 'webp';
    return null;
}

export function imageMimeType(bytes, fallback = 'application/octet-stream') {
    const kind = imageKind(bytes);
    return kind ? `image/${kind}` : fallback;
}

export function imageExtension(bytes, fallback = 'img') {
    const kind = imageKind(bytes);
    return kind === 'jpeg' ? 'jpg' : (kind ?? fallback);
}
