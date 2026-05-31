import { formatAttachmentSize, hasStoredFileRef, isPngMsg } from '@veyl/shared/chat/messages';
import { cleanText } from '@veyl/shared/utils/text';
import { saveBytes, saveUrl } from './download';

const HOVER_SAVE_MSG_TYPES = ['img', 'mp3', 'mp4'];

export function bubbleBg(fromPeer = false) {
    return fromPeer ? 'bg-foreground/3' : 'bg-foreground/1';
}

export function stopClick(event) {
    event?.stopPropagation?.();
}

export function canSaveMsgFile(msg, peerChatPK) {
    if (!HOVER_SAVE_MSG_TYPES.includes(msg?.t)) {
        return false;
    }
    if (cleanText(msg?.localUri)) {
        return true;
    }
    return !!peerChatPK && hasStoredFileRef(msg);
}

export function msgFileName(msg, fallback = 'attachment') {
    const name = cleanText(msg?.n);
    if (name) {
        return name;
    }

    switch (msg?.t) {
        case 'img':
            return isPngMsg(msg) ? 'image.png' : 'image.jpg';
        case 'mp3':
            return 'audio.mp3';
        case 'mp4':
            return 'video.mp4';
        default:
            return fallback;
    }
}

export function msgMime(msg) {
    switch (msg?.t) {
        case 'img':
            return msg?.m || 'image/jpeg';
        case 'mp3':
            return msg?.m || 'audio/mpeg';
        case 'mp4':
            return msg?.m || 'video/mp4';
        default:
            return msg?.m || 'application/octet-stream';
    }
}

export async function saveMsgFile(readMessageFile, peerChatPK, msg) {
    const localUri = cleanText(msg?.localUri);
    if (localUri) {
        saveUrl(localUri, msgFileName(msg));
        return;
    }

    if (!peerChatPK || !hasStoredFileRef(msg)) {
        throw new Error('file unavailable');
    }

    const bytes = await readMessageFile(peerChatPK, msg);
    saveBytes(bytes, { name: msgFileName(msg), type: msgMime(msg) });
}

export function imageWidth(aspect) {
    return Math.round(Math.max(260, Math.min(560, aspect * 380)));
}

export function attachmentMeta(msg, loading, error) {
    if (loading) {
        return 'downloading...';
    }
    if (error) {
        return error;
    }

    const parts = [];
    const size = formatAttachmentSize(Number(msg?.z));
    if (size) {
        parts.push(size);
    }
    if (msg?.pending) {
        parts.push('sending');
    } else if (msg?.failed) {
        parts.push('failed');
    } else if (hasStoredFileRef(msg)) {
        parts.push('download');
    }

    return parts.join(' · ') || 'attachment';
}
