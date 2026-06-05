import { canShareAttachmentMsg, makeSharedAttachment } from '@veyl/shared/chat/messages';
import { attachmentBytes } from '@veyl/shared/chat/attachments';
import { randomBytes, toHex } from '@veyl/shared/crypto/core';
import { textRouteParam } from '@veyl/shared/navigation/params';
import { cleanText } from '@veyl/shared/utils/text';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import { getCachedMessageFileUri } from './downloads';

let staged = null;

export function stageShareMedia(msg, options = {}) {
    if (!canShareAttachmentMsg(msg)) {
        return null;
    }

    const id = `share-${toHex(randomBytes(16))}`;
    staged = {
        id,
        msg: {
            ...makeSharedAttachment(msg),
            ...(cleanText(options?.sourcePeerChatPK) ? { peerChatPK: cleanText(options.sourcePeerChatPK) } : {}),
            ...(options?.data ? { localData: options.data } : {}),
        },
    };
    return { id };
}

export function readShareMedia(id) {
    const key = textRouteParam(id);
    return key && staged?.id === key ? staged.msg : null;
}

export async function readShareMediaBytes(msg) {
    const localBytes = await attachmentBytes(msg?.localData).catch(() => null);
    if (localBytes?.byteLength) {
        return localBytes;
    }

    const uri = getCachedMessageFileUri(msg, msg?.peerChatPK);
    if (!uri) {
        return null;
    }

    const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
    });
    return new Uint8Array(Buffer.from(base64, 'base64'));
}

export function clearShareMedia(id) {
    const key = textRouteParam(id);
    if (!key || staged?.id === key) {
        staged = null;
    }
}
