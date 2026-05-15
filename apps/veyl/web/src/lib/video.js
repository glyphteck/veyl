'use client';

function cleanMp4Name(name) {
    const base = String(name || 'video')
        .trim()
        .replace(/\.[^.]*$/, '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
        .trim();
    return `${base || 'video'}.mp4`;
}

function isMp4(file) {
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    return type === 'video/mp4' || name.endsWith('.mp4');
}

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

function getMp4RecorderType() {
    const types = ['video/mp4;codecs=h264,aac', 'video/mp4'];
    return types.find((type) => MediaRecorder?.isTypeSupported?.(type)) || '';
}

async function recordMp4(file, mimeType) {
    const { video, url } = await loadVideo(file);
    const stream = video.captureStream?.();
    if (!stream) {
        URL.revokeObjectURL(url);
        throw new Error('mp4 conversion unavailable');
    }

    return new Promise((resolve, reject) => {
        const chunks = [];
        const recorder = new MediaRecorder(stream, { mimeType });
        recorder.ondataavailable = (event) => {
            if (event.data?.size) chunks.push(event.data);
        };
        recorder.onerror = () => reject(recorder.error || new Error('mp4 conversion failed'));
        recorder.onstop = () => {
            video.removeAttribute('src');
            video.load();
            URL.revokeObjectURL(url);
            resolve(new Blob(chunks, { type: 'video/mp4' }));
        };
        video.onended = () => recorder.stop();
        recorder.start();
        video.play().catch((error) => {
            recorder.stop();
            reject(error);
        });
    });
}

export async function toMp4(file) {
    if (!file || typeof file.arrayBuffer !== 'function') {
        throw new Error('video file required');
    }

    if (isMp4(file)) {
        return {
            file: file.type === 'video/mp4' ? file : new File([file], cleanMp4Name(file.name), { type: 'video/mp4', lastModified: file.lastModified || Date.now() }),
            ...(await getMeta(file)),
        };
    }

    const mimeType = typeof MediaRecorder !== 'undefined' ? getMp4RecorderType() : '';
    if (!mimeType) {
        throw new Error('mp4 conversion unavailable');
    }

    const blob = await recordMp4(file, mimeType);
    const nextFile = new File([blob], cleanMp4Name(file.name), { type: 'video/mp4', lastModified: Date.now() });
    return {
        file: nextFile,
        ...(await getMeta(nextFile)),
    };
}
