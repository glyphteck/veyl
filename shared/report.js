function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function fallbackAttachmentName(kind) {
    switch (kind) {
        case 'img':
            return 'image';
        case 'mp3':
            return 'audio';
        case 'mp4':
            return 'video';
        default:
            return 'attachment';
    }
}

export function getReportAttachmentMeta(msg) {
    const kind = cleanText(msg?.t);
    if (!['img', 'file', 'mp3', 'mp4'].includes(kind)) {
        return null;
    }

    return {
        kind,
        name: cleanText(msg?.n) || fallbackAttachmentName(kind),
        mimeType: cleanText(msg?.m) || (kind === 'img' ? 'image/webp' : kind === 'mp3' ? 'audio/mpeg' : kind === 'mp4' ? 'video/mp4' : 'application/octet-stream'),
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
