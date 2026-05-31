'use client';

import { chatUploadErrorMessage, formatMaxChatFileSize, formatMaxChatUploadFiles } from '@veyl/shared/chat/attachments';
import { CHAT_IMAGE_COMPRESS, fitChatImageSize, getChatUploadFileList } from '@veyl/shared/chat/filepayload';
import { filenameWithExtension } from '@veyl/shared/utils/filename';
import { fileMime, isImageFile, isPngFile, isVideoFile } from '@veyl/shared/utils/filetype';
import { toMp3 } from '../media/audio';
import { toMp4 } from '../media/video';

export { chatUploadErrorMessage, formatMaxChatFileSize, formatMaxChatUploadFiles };

export function getUploadFiles(files) {
    return getChatUploadFileList(files);
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
    return isImageFile(file);
}

function isPng(file) {
    return isPngFile(file);
}

function jpgName(file) {
    return filenameWithExtension(file?.name, 'jpg', 'image');
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
    return fitChatImageSize(width, height) || { width, height };
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

    const blob = await canvasBlob(canvas, 'image/jpeg', CHAT_IMAGE_COMPRESS);
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

export async function prepareFile(file) {
    const type = fileMime(file);
    const image = isImage(file) ? await prepareImage(file) : null;
    const isAudio = type.startsWith('audio/');
    const isVideo = isVideoFile(file);
    const upload = image ? { file: image.file, width: image.width, height: image.height, duration: null } : isAudio ? await toMp3(file) : isVideo ? await toMp4(file) : { file, duration: null };
    const nextFile = upload.file;
    const imageUpload = fileMime(nextFile).startsWith('image/');
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

export async function queueMessages(files, sendAttachment) {
    const selectedFiles = getUploadFiles(files);
    const jobs = [];
    const errors = [];

    for (const file of selectedFiles) {
        try {
            const attachment = await prepareFile(file);
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
