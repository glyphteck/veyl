'use client';

export function replaceDocument(href) {
    if (typeof window === 'undefined') return;
    window.location.replace(href);
}
