'use client';

import { encoder } from './core.js';

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function canonicalPart(value, label) {
    if (value === null) {
        return 'null';
    }
    if (value === undefined) {
        throw new Error(`${label} must be json`);
    }

    switch (typeof value) {
        case 'string':
            return JSON.stringify(value);
        case 'boolean':
            return value ? 'true' : 'false';
        case 'number':
            if (!Number.isFinite(value)) {
                throw new Error(`${label} must be finite`);
            }
            return Object.is(value, -0) ? '0' : JSON.stringify(value);
        case 'object':
            if (Array.isArray(value)) {
                return `[${value.map((item, index) => canonicalPart(item, `${label}[${index}]`)).join(',')}]`;
            }
            if (!isPlainObject(value)) {
                throw new Error(`${label} must be plain json`);
            }
            return `{${Object.keys(value)
                .sort()
                .map((key) => `${JSON.stringify(key)}:${canonicalPart(value[key], `${label}.${key}`)}`)
                .join(',')}}`;
        default:
            throw new Error(`${label} must be json`);
    }
}

export function canonicalJson(value, label = 'value') {
    return canonicalPart(value, label);
}

export function canonicalBytes(value, label = 'value') {
    return encoder.encode(canonicalJson(value, label));
}
