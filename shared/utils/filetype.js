import { lowerText } from './text.js';

const IMAGE_EXTENSION = /\.(avif|gif|heic|heif|jpe?g|png|webp)$/;
const VIDEO_EXTENSION = /\.(m4v|mov|mp4|webm)$/;
const MIME_EXTENSION = Object.freeze({
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'audio/aac': 'aac',
    'audio/m4a': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'text/plain': 'txt',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
});

export function fileMime(value) {
    return lowerText(value?.mimeType || value?.type);
}

export function fileName(value) {
    return lowerText(value?.fileName || value?.name);
}

export function fileExtension(value) {
    const match = fileName(value).match(/\.([a-z0-9]+)$/);
    return match?.[1] || '';
}

export function mimeExtension(value, fallback = 'bin') {
    const mime = lowerText(typeof value === 'string' ? value : value?.mimeType || value?.type);
    return MIME_EXTENSION[mime] || fallback;
}

export function isImageFile(value) {
    const mime = fileMime(value);
    return mime.startsWith('image/') || IMAGE_EXTENSION.test(fileName(value));
}

export function isVideoFile(value) {
    const mime = fileMime(value);
    return mime.startsWith('video/') || VIDEO_EXTENSION.test(fileName(value));
}

export function isPngFile(value) {
    return fileMime(value) === 'image/png' || fileExtension(value) === 'png';
}

export function isMp3File(value) {
    const mime = fileMime(value);
    return mime === 'audio/mpeg' || mime === 'audio/mp3' || fileExtension(value) === 'mp3';
}

export function isMp4File(value) {
    return fileMime(value) === 'video/mp4' || fileExtension(value) === 'mp4';
}
