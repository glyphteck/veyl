import { cleanText } from '@veyl/shared/utils/text';
import { timestampMs } from '@veyl/shared/utils/time';
import { nonNegativeInt } from '@veyl/shared/utils/number';
import { reportAttachmentMime, reportAttachmentName } from '@veyl/shared/report';

function fallbackAttachment(type, path, name = '', mimeType = '') {
    if (!path) {
        return null;
    }

    return {
        path,
        kind: type || 'file',
        name: name || reportAttachmentName(type),
        mimeType: mimeType || reportAttachmentMime(type),
    };
}

export function reportCount(value) {
    return nonNegativeInt(value, 0);
}

export function sortOffenders(rows = []) {
    return [...rows].sort((a, b) => {
        const byCount = reportCount(b?.count) - reportCount(a?.count);
        if (byCount) {
            return byCount;
        }
        return timestampMs(b?.lastReportAt, 0, { parseString: true }) - timestampMs(a?.lastReportAt, 0, { parseString: true });
    });
}

export function parseReportEvidence(report = {}) {
    return {
        type: cleanText(report?.type),
        note: cleanText(report?.note),
        content: cleanText(report?.content),
        attachment: fallbackAttachment(cleanText(report?.type), cleanText(report?.path)),
    };
}
