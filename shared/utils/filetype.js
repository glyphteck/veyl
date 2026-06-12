import { lowerText } from './text.js';

const IMAGE_EXTENSION = /\.(avif|gif|heic|heif|jpe?g|png|svg|webp)$/;
const AUDIO_EXTENSION = /\.(aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|weba|wma)$/;
const VIDEO_EXTENSION = /\.(3g2|3gp|asf|avi|divx|flv|m2ts|m4v|mkv|mov|mp4|mpe?g|mts|ogm|ogv|qt|webm|wmv)$/;
const MIME_EXTENSION = Object.freeze({
    'audio/aac': 'aac',
    'audio/aiff': 'aiff',
    'audio/flac': 'flac',
    'audio/m4a': 'm4a',
    'audio/mp3': 'mp3',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/wav': 'wav',
    'audio/webm': 'weba',
    'audio/x-aiff': 'aiff',
    'audio/x-flac': 'flac',
    'audio/x-m4a': 'm4a',
    'audio/x-ms-wma': 'wma',
    'audio/x-wav': 'wav',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
    'text/plain': 'txt',
    'video/3gpp': '3gp',
    'video/3gpp2': '3g2',
    'video/mp2t': 'ts',
    'video/mp4': 'mp4',
    'video/mpeg': 'mpg',
    'video/ogg': 'ogv',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/x-flv': 'flv',
    'video/x-m4v': 'm4v',
    'video/x-matroska': 'mkv',
    'video/x-ms-wmv': 'wmv',
    'video/x-msvideo': 'avi',
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

export function isGifFile(value) {
    return fileMime(value) === 'image/gif' || fileExtension(value) === 'gif';
}

export function isAudioFile(value) {
    const mime = fileMime(value);
    return mime.startsWith('audio/') || AUDIO_EXTENSION.test(fileName(value));
}

export function isVideoFile(value) {
    const mime = fileMime(value);
    return mime.startsWith('video/') || VIDEO_EXTENSION.test(fileName(value));
}

export function isPngFile(value) {
    return fileMime(value) === 'image/png' || fileExtension(value) === 'png';
}

export function isM4aFile(value) {
    const mime = fileMime(value);
    return mime === 'audio/mp4' || mime === 'audio/m4a' || mime === 'audio/x-m4a' || fileExtension(value) === 'm4a';
}

export function isMp4File(value) {
    return fileMime(value) === 'video/mp4' || fileExtension(value) === 'mp4';
}
