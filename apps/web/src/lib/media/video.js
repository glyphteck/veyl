'use client';

import {
    CHAT_VIDEO_TRANSCODE_AUDIO_BITRATE_BPS,
    CHAT_VIDEO_TRANSCODE_MAX_EDGE,
    CHAT_VIDEO_TRANSCODE_VIDEO_BITRATE_BPS,
    assertChatMediaTranscodeWorthTrying,
    assertChatUploadByteSize,
} from '@veyl/shared/chat/filepayload';
import { filenameWithExtension } from '@veyl/shared/utils/filename';
import { fileExtension, mimeExtension } from '@veyl/shared/utils/filetype';
import { nextFfmpegId, removeFfmpegFile, runFfmpegJob } from './ffmpeg';

function loadVideo(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;
        video.onloadedmetadata = () => resolve({ video, url });
        video.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('video unavailable'));
        };
        video.src = url;
    });
}

async function getMeta(file) {
    const { video, url } = await loadVideo(file);
    const meta = {
        duration: Number.isFinite(video.duration) ? video.duration : null,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
    };
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
    return meta;
}

function inputExtension(file) {
    return fileExtension(file) || mimeExtension(file, 'video');
}

function videoFilter() {
    return `scale=${CHAT_VIDEO_TRANSCODE_MAX_EDGE}:${CHAT_VIDEO_TRANSCODE_MAX_EDGE}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`;
}

async function transcodeMp4(file) {
    const id = nextFfmpegId('video');
    const inputName = `input-${id}.${inputExtension(file)}`;
    const outputName = `output-${id}.mp4`;
    const { fetchFile } = await import('@ffmpeg/util');

    return runFfmpegJob(async (ffmpeg) => {
        await ffmpeg.writeFile(inputName, await fetchFile(file));
        try {
            const code = await ffmpeg.exec([
                '-i',
                inputName,
                '-map',
                '0:v:0',
                '-map',
                '0:a:0?',
                '-vf',
                videoFilter(),
                '-c:v',
                'libx264',
                '-preset',
                'veryfast',
                '-b:v',
                String(CHAT_VIDEO_TRANSCODE_VIDEO_BITRATE_BPS),
                '-maxrate',
                String(Math.round(CHAT_VIDEO_TRANSCODE_VIDEO_BITRATE_BPS * 1.5)),
                '-bufsize',
                String(Math.round(CHAT_VIDEO_TRANSCODE_VIDEO_BITRATE_BPS * 3)),
                '-c:a',
                'aac',
                '-b:a',
                String(CHAT_VIDEO_TRANSCODE_AUDIO_BITRATE_BPS),
                '-movflags',
                '+faststart',
                outputName,
            ]);
            if (code !== 0) {
                throw new Error('mp4 conversion failed');
            }
            const data = await ffmpeg.readFile(outputName);
            return new Blob([data], { type: 'video/mp4' });
        } finally {
            await Promise.all([removeFfmpegFile(ffmpeg, inputName), removeFfmpegFile(ffmpeg, outputName)]);
        }
    });
}

export async function toMp4(file) {
    if (!file || typeof file.arrayBuffer !== 'function') {
        throw new Error('video file required');
    }

    const meta = await getMeta(file);
    assertChatMediaTranscodeWorthTrying('video', meta.duration);
    const blob = await transcodeMp4(file);
    assertChatUploadByteSize(blob);
    const nextFile = new File([blob], filenameWithExtension(file.name, 'mp4', 'video'), { type: 'video/mp4', lastModified: Date.now() });
    return {
        file: nextFile,
        ...(await getMeta(nextFile)),
    };
}
