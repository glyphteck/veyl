import { cleanText } from './utils/text.js';

export function reportAttachmentName(kind) {
    switch (kind) {
        case 'img':
            return 'image';
        case 'm4a':
            return 'audio';
        case 'mp4':
            return 'video';
        default:
            return 'attachment';
    }
}

export function reportAttachmentMime(kind) {
    switch (kind) {
        case 'img':
            return 'image/webp';
        case 'm4a':
            return 'audio/mp4';
        case 'mp4':
            return 'video/mp4';
        default:
            return 'application/octet-stream';
    }
}

export function getReportAttachmentMeta(msg) {
    const kind = cleanText(msg?.t);
    if (!['img', 'file', 'm4a', 'mp4'].includes(kind)) {
        return null;
    }

    return {
        kind,
        name: cleanText(msg?.n) || reportAttachmentName(kind),
        mimeType: cleanText(msg?.m) || reportAttachmentMime(kind),
    };
}

export function buildReportFields({ msg, note } = {}) {
    const type = cleanText(msg?.t);
    const content = type === 'txt' ? cleanText(msg?.c) : '';
    const cleanedNote = cleanText(note);
    const report = {};

    if (type) {
        report.type = type;
    }

    if (content) {
        report.content = content;
    }

    if (cleanedNote) {
        report.note = cleanedNote;
    }

    return report;
}
