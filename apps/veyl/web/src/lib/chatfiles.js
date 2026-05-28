'use client';

import { CHAT_FILE_SIZE_LIMIT_ENABLED, MAX_CHAT_FILE_BYTES, MAX_CHAT_UPLOAD_FILES } from '@glyphteck/shared/chat/filepayload';
import { toMp3 } from './audio';
import { toMp4 } from './video';

const MAX_CHAT_IMAGE_EDGE = 1600;
const CHAT_IMAGE_QUALITY = 0.82;

function plural(count, one, many = `${one}s`) {
    return count === 1 ? one : many;
}

export function formatMaxChatFileSize(bytes = MAX_CHAT_FILE_BYTES) {
    const mb = bytes / (1024 * 1024);
    return Number.isInteger(mb) ? `${mb}MB` : `${mb.toFixed(1)}MB`;
}

export function formatMaxChatUploadFiles(maxFiles = MAX_CHAT_UPLOAD_FILES) {
    return `${maxFiles} ${plural(maxFiles, 'file')}`;
}

function makeTooManyFilesError(count) {
    const error = new Error('too many files');
    error.code = 'too-many-files';
    error.maxFiles = MAX_CHAT_UPLOAD_FILES;
    error.count = count;
    return error;
}

function makeFileTooLargeError(size) {
    const error = new Error('file too large');
    error.code = 'file-too-large';
    error.maxBytes = MAX_CHAT_FILE_BYTES;
    error.size = size;
    return error;
}

function checkRawFileSize(file) {
    if (CHAT_FILE_SIZE_LIMIT_ENABLED && Number.isFinite(file?.size) && file.size > MAX_CHAT_FILE_BYTES) {
        throw makeFileTooLargeError(file.size);
    }
}

export function getChatUploadFiles(files) {
    const list = Array.from(files || []).filter(Boolean);
    if (list.length > MAX_CHAT_UPLOAD_FILES) {
        throw makeTooManyFilesError(list.length);
    }
    for (const file of list) {
        checkRawFileSize(file);
    }
    return list;
}

export function chatUploadErrorMessage(error, fallback = 'failed to send attachment') {
    if (error?.code === 'too-many-files') {
        return `choose up to ${formatMaxChatUploadFiles(error.maxFiles || MAX_CHAT_UPLOAD_FILES)}`;
    }
    if (error?.code === 'file-too-large') {
        return `attachment too large (max ${formatMaxChatFileSize(error.maxBytes || MAX_CHAT_FILE_BYTES)})`;
    }
    return error?.message || fallback;
}

function readPreview(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(reader.error || new Error('preview failed'));
        reader.readAsDataURL(file);
    });
}

function isImage(file) {
    const type = String(file?.type || '').toLowerCase();
    if (type.startsWith('image/')) {
        return true;
    }

    const name = String(file?.name || '').toLowerCase();
    return /\.(avif|gif|heic|heif|jpe?g|png|webp)$/.test(name);
}

function isPng(file) {
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    return type === 'image/png' || /\.png$/.test(name);
}

function jpgName(file) {
    const raw = String(file?.name || 'image').trim();
    const base = raw.replace(/\.[^.]+$/, '') || 'image';
    return `${base}.jpg`;
}

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        const done = (error) => {
            URL.revokeObjectURL(url);
            if (error) {
                reject(error);
                return;
            }
            resolve(img);
        };
        img.onload = () => done(null);
        img.onerror = () => done(new Error('image decode failed'));
        img.src = url;
    });
}

function fitSize(width, height) {
    const currentMax = Math.max(width, height);
    if (!currentMax || currentMax <= MAX_CHAT_IMAGE_EDGE) {
        return { width, height };
    }

    const scale = MAX_CHAT_IMAGE_EDGE / currentMax;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

function canvasBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
                return;
            }
            reject(new Error('image conversion failed'));
        }, type, quality);
    });
}

async function toJpeg(file, img) {
    const naturalWidth = img.naturalWidth || img.width;
    const naturalHeight = img.naturalHeight || img.height;
    const size = fitSize(naturalWidth, naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('image conversion unavailable');
    }

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(img, 0, 0, size.width, size.height);

    const blob = await canvasBlob(canvas, 'image/jpeg', CHAT_IMAGE_QUALITY);
    return {
        file: new File([blob], jpgName(file), { type: 'image/jpeg', lastModified: Date.now() }),
        width: size.width,
        height: size.height,
    };
}

async function prepareImage(file) {
    const img = await loadImage(file);
    const naturalWidth = img.naturalWidth || img.width;
    const naturalHeight = img.naturalHeight || img.height;
    if (!isPng(file)) {
        return toJpeg(file, img);
    }

    return {
        file,
        width: naturalWidth,
        height: naturalHeight,
    };
}

export async function prepareChatFile(file) {
    const type = typeof file?.type === 'string' ? file.type : '';
    const name = String(file?.name || '').toLowerCase();
    const image = isImage(file) ? await prepareImage(file) : null;
    const isAudio = type.startsWith('audio/');
    const isVideo = type.startsWith('video/') || /\.(m4v|mov|mp4|webm)$/.test(name);
    const upload = image ? { file: image.file, width: image.width, height: image.height, duration: null } : isAudio ? await toMp3(file) : isVideo ? await toMp4(file) : { file, duration: null };
    const nextFile = upload.file;
    const imageUpload = typeof nextFile?.type === 'string' && nextFile.type.startsWith('image/');
    const previewUri = imageUpload ? await readPreview(nextFile) : isAudio || isVideo ? URL.createObjectURL(nextFile) : null;

    return {
        data: nextFile,
        mimeType: nextFile.type || 'application/octet-stream',
        size: nextFile.size,
        name: nextFile.name,
        ...(Number.isFinite(upload.duration) ? { duration: upload.duration } : {}),
        ...(Number.isFinite(upload.width) ? { width: upload.width } : {}),
        ...(Number.isFinite(upload.height) ? { height: upload.height } : {}),
        ...(previewUri ? { previewUri } : {}),
    };
}

export async function queueChatFileMessages(files, sendAttachment) {
    const selectedFiles = getChatUploadFiles(files);
    const jobs = [];
    const errors = [];

    for (const file of selectedFiles) {
        try {
            const attachment = await prepareChatFile(file);
            jobs.push(Promise.resolve(sendAttachment(attachment)));
        } catch (error) {
            errors.push(error);
        }
    }

    const results = await Promise.allSettled(jobs);
    for (const result of results) {
        if (result.status === 'rejected') {
            errors.push(result.reason);
        }
    }

    if (errors.length) {
        throw errors[0];
    }

    return {
        total: selectedFiles.length,
        sent: results.length,
    };
}
