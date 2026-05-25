import { canShareAttachmentMsg, makeSharedAttachment } from '@glyphteck/shared/chat/messages';
import { randomBytes, toHex } from '@glyphteck/shared/crypto/core';

let staged = null;

export function stageShareMedia(msg) {
    if (!canShareAttachmentMsg(msg)) {
        return null;
    }

    const id = `share-${toHex(randomBytes(16))}`;
    staged = {
        id,
        msg: makeSharedAttachment(msg),
    };
    return { id };
}

export function readShareMedia(id) {
    const key = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';
    return key && staged?.id === key ? staged.msg : null;
}

export function clearShareMedia(id) {
    const key = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';
    if (!key || staged?.id === key) {
        staged = null;
    }
}
