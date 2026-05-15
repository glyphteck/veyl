'use client';

function cleanMp3Name(name) {
    const base = String(name || 'audio')
        .trim()
        .replace(/\.[^.]*$/, '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
        .trim();
    return `${base || 'audio'}.mp3`;
}

function toInt16(channel, start, end) {
    const size = end - start;
    const output = new Int16Array(size);
    for (let i = 0; i < size; i += 1) {
        const value = Math.max(-1, Math.min(1, channel[start + i] || 0));
        output[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
    }
    return output;
}

function getLame(mod) {
    return mod?.default?.Mp3Encoder ? mod.default : mod;
}

function isMp3(file) {
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    return type === 'audio/mpeg' || type === 'audio/mp3' || name.endsWith('.mp3');
}

async function getDuration(file) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
        return null;
    }

    const ctx = new AudioCtx();
    try {
        const data = await file.arrayBuffer();
        const decoded = await ctx.decodeAudioData(data.slice(0));
        return decoded.duration;
    } catch {
        return null;
    } finally {
        await ctx.close?.();
    }
}

export async function toMp3(file) {
    if (!file || typeof file.arrayBuffer !== 'function') {
        throw new Error('audio file required');
    }

    if (isMp3(file)) {
        return {
            file: file.type === 'audio/mpeg' ? file : new File([file], cleanMp3Name(file.name), { type: 'audio/mpeg', lastModified: file.lastModified || Date.now() }),
            duration: await getDuration(file),
        };
    }

    const [{ default: MPEGMode }, { default: Lame }, data] = await Promise.all([import('lamejs/src/js/MPEGMode.js'), import('lamejs/src/js/Lame.js'), file.arrayBuffer()]);
    globalThis.MPEGMode = MPEGMode;
    globalThis.Lame = Lame;
    const { default: lameDefault, ...lameRest } = await import('lamejs');
    const lame = getLame(lameDefault?.Mp3Encoder ? lameDefault : lameRest);
    if (!lame?.Mp3Encoder) {
        throw new Error('mp3 encoder unavailable');
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
        throw new Error('audio conversion unavailable');
    }

    const ctx = new AudioCtx();
    try {
        const decoded = await ctx.decodeAudioData(data.slice(0));
        const channels = decoded.numberOfChannels > 1 ? 2 : 1;
        const left = decoded.getChannelData(0);
        const right = channels === 2 ? decoded.getChannelData(1) : null;
        const encoder = new lame.Mp3Encoder(channels, decoded.sampleRate, 128);
        const chunks = [];
        const frame = 1152;

        for (let start = 0; start < decoded.length; start += frame) {
            const end = Math.min(start + frame, decoded.length);
            const leftChunk = toInt16(left, start, end);
            const bytes = channels === 2 ? encoder.encodeBuffer(leftChunk, toInt16(right, start, end)) : encoder.encodeBuffer(leftChunk);
            if (bytes.length) {
                chunks.push(bytes);
            }
        }

        const tail = encoder.flush();
        if (tail.length) {
            chunks.push(tail);
        }

        const blob = new Blob(chunks, { type: 'audio/mpeg' });
        const name = cleanMp3Name(file.name);
        return {
            file: new File([blob], name, { type: 'audio/mpeg', lastModified: Date.now() }),
            duration: decoded.duration,
        };
    } finally {
        await ctx.close?.();
    }
}
