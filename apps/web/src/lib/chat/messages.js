import { formatAttachmentSize, hasStoredFileRef, isGifMsg, isPngMsg } from '@veyl/shared/chat/messages';
import { cleanText } from '@veyl/shared/utils/text';
import { saveBytes, saveUrl } from '../download';

const HOVER_DOWNLOAD_MSG_TYPES = ['img', 'gif', 'm4a', 'mp4'];

export function bubbleBg(fromPeer = false) {
    return fromPeer ? 'bg-foreground/3' : 'bg-foreground/1';
}

export function stopClick(event) {
    event?.stopPropagation?.();
}

export function canDownloadMsgFile(msg, peerChatPK) {
    if (!HOVER_DOWNLOAD_MSG_TYPES.includes(msg?.t)) {
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
        case 'gif':
            return isGifMsg(msg) ? 'image.gif' : 'gif.gif';
        case 'm4a':
            return 'audio.m4a';
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
        case 'gif':
            return msg?.m || 'image/gif';
        case 'm4a':
            return msg?.m || 'audio/mp4';
        case 'mp4':
            return msg?.m || 'video/mp4';
        default:
            return msg?.m || 'application/octet-stream';
    }
}

export async function downloadMsgFile(readMessageFile, peerChatPK, msg) {
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
