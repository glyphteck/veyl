import { randomBytes, toHex } from '../crypto/core.js';

export function cleanExtension(ext = 'bin') {
    return String(ext || 'bin').replace(/^\./, '').trim().toLowerCase() || 'bin';
}

export function safeFilePart(value, fallback = 'default') {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_') || fallback;
}

export function filenameWithExtension(name, ext = 'bin', fallback = 'file') {
    const cleanExt = cleanExtension(ext);
    const raw = String(name || fallback).trim();
    const base = raw
        .replace(/\.[^.]+$/, '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
        .trim() || fallback;
    return `${base}.${cleanExt}`;
}

export function randomFilename(ext = 'bin', bytes = 8) {
    return `${toHex(randomBytes(bytes))}.${cleanExtension(ext)}`;
}
