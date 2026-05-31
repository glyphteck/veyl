import { randomFilename } from '@veyl/shared/utils/filename';

function videoFileType(mimeType) {
    return String(mimeType || '').includes('mp4') ? 'video/mp4' : 'video/webm';
}

function videoFileName(mimeType) {
    const ext = videoFileType(mimeType) === 'video/mp4' ? 'mp4' : 'webm';
    return randomFilename(ext);
}

function mirrorPhotoDataUri(src) {
    return new Promise((resolve, reject) => {
        const BrowserImage = globalThis.Image;
        if (!BrowserImage) {
            reject(new Error('image unavailable'));
            return;
        }

        const img = new BrowserImage();
        img.onload = () => {
            const width = img.naturalWidth || img.width;
            const height = img.naturalHeight || img.height;
            if (!width || !height) {
                reject(new Error('photo unavailable'));
                return;
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('canvas unavailable'));
                return;
            }

            ctx.translate(width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.92));
        };
        img.onerror = reject;
        img.src = src;
    });
}

export async function stagePhotoCapture(src) {
    if (!src) return null;
    const name = randomFilename('jpg');
    try {
        return { kind: 'photo', uri: await mirrorPhotoDataUri(src), name };
    } catch (error) {
        console.error('photo mirror failed:', error);
        return { kind: 'photo', uri: src, name };
    }
}

export function stageVideoCapture(chunks, mimeType) {
    if (!chunks?.length) return null;

    const type = videoFileType(mimeType);
    const blob = new Blob(chunks, { type });
    if (!blob.size) return null;

    const file = new File([blob], videoFileName(type), { type, lastModified: Date.now() });
    return {
        kind: 'video',
        uri: URL.createObjectURL(blob),
        file,
        revokeUrl: true,
    };
}

export function downloadCapture(capture) {
    if (!capture) return;

    const a = document.createElement('a');
    a.href = capture.uri;
    a.download = capture.kind === 'video' ? capture.file?.name || videoFileName(capture.file?.type) : capture.name || randomFilename('jpg');
    a.click();
}
