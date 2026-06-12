'use client';

const FFMPEG_CORE_VERSION = '0.12.10';
const FFMPEG_CORE_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;
let ffmpegPromise = null;
let jobQueue = Promise.resolve();
let jobId = 0;

async function loadFfmpeg() {
    if (!ffmpegPromise) {
        ffmpegPromise = Promise.all([import('@ffmpeg/ffmpeg'), import('@ffmpeg/util')])
            .then(async ([{ FFmpeg }, { toBlobURL }]) => {
                const ffmpeg = new FFmpeg();
                await ffmpeg.load({
                    coreURL: await toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
                    wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
                });
                return ffmpeg;
            })
            .catch((error) => {
                ffmpegPromise = null;
                throw error;
            });
    }
    return ffmpegPromise;
}

export function nextFfmpegId(prefix = 'job') {
    jobId += 1;
    return `${prefix}-${jobId}`;
}

export async function removeFfmpegFile(ffmpeg, path) {
    try {
        await ffmpeg.deleteFile(path);
    } catch {
        // ffmpeg only creates some files after a successful command.
    }
}

export function runFfmpegJob(job) {
    const run = jobQueue.then(async () => job(await loadFfmpeg()));
    jobQueue = run.catch(() => {});
    return run;
}
