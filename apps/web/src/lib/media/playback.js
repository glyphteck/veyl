'use client';

let current = null;

export function play(media) {
    if (current && current !== media) {
        try {
            current.pause();
        } catch {}
    }
    current = media;
}

export function clear(media) {
    if (current === media) {
        current = null;
    }
}
