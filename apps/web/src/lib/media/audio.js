'use client';

import { CHAT_AUDIO_TRANSCODE_BITRATE_BPS, assertChatMediaTranscodeWorthTrying, assertChatUploadByteSize } from '@veyl/shared/chat/filepayload';
import { filenameWithExtension } from '@veyl/shared/utils/filename';
import { fileExtension, isM4aFile, mimeExtension } from '@veyl/shared/utils/filetype';
import { nextFfmpegId, removeFfmpegFile, runFfmpegJob } from './ffmpeg';

function getAudioDurationFromElement(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const audio = new Audio();
        const done = (error) => {
            audio.removeAttribute('src');
            audio.load();
            URL.revokeObjectURL(url);
            if (error) {
                reject(error);
                return;
            }
            resolve(Number.isFinite(audio.duration) ? audio.duration : null);
        };
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => done(null);
        audio.onerror = () => done(new Error('audio unavailable'));
        audio.src = url;
    });
}

async function getDurationFromDecode(file) {
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

async function getDuration(file) {
    try {
        return await getAudioDurationFromElement(file);
    } catch {
        return getDurationFromDecode(file);
    }
}

function inputExtension(file) {
    return fileExtension(file) || mimeExtension(file, 'audio');
}

async function transcodeM4a(file) {
    const id = nextFfmpegId('audio');
    const inputName = `input-${id}.${inputExtension(file)}`;
    const outputName = `output-${id}.m4a`;
    const { fetchFile } = await import('@ffmpeg/util');

    return runFfmpegJob(async (ffmpeg) => {
        await ffmpeg.writeFile(inputName, await fetchFile(file));
        try {
            const code = await ffmpeg.exec([
                '-i',
                inputName,
                '-map',
                '0:a:0',
                '-vn',
                '-c:a',
                'aac',
                '-b:a',
                String(CHAT_AUDIO_TRANSCODE_BITRATE_BPS),
                '-movflags',
                '+faststart',
                outputName,
            ]);
            if (code !== 0) {
                throw new Error('m4a conversion failed');
            }
            const data = await ffmpeg.readFile(outputName);
            return new Blob([data], { type: 'audio/mp4' });
        } finally {
            await Promise.all([removeFfmpegFile(ffmpeg, inputName), removeFfmpegFile(ffmpeg, outputName)]);
        }
    });
}

export async function toM4a(file) {
    if (!file || typeof file.arrayBuffer !== 'function') {
        throw new Error('audio file required');
    }

    if (isM4aFile(file)) {
        try {
            assertChatUploadByteSize(file);
            return {
                file: file.type === 'audio/mp4' ? file : new File([file], filenameWithExtension(file.name, 'm4a', 'audio'), { type: 'audio/mp4', lastModified: file.lastModified || Date.now() }),
                duration: await getDuration(file),
            };
        } catch (error) {
            if (error?.code !== 'upload-too-large') {
                throw error;
            }
        }
    }

    const duration = await getDuration(file);
    assertChatMediaTranscodeWorthTrying('audio', duration);
    const blob = await transcodeM4a(file);
    assertChatUploadByteSize(blob);
    const nextFile = new File([blob], filenameWithExtension(file.name, 'm4a', 'audio'), { type: 'audio/mp4', lastModified: Date.now() });
    return {
        file: nextFile,
        duration: duration ?? (await getDuration(nextFile)),
    };
}
