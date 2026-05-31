import { canShareAttachmentMsg, makeSharedAttachment } from '@veyl/shared/chat/messages';
import { randomBytes, toHex } from '@veyl/shared/crypto/core';
import { textRouteParam } from '@veyl/shared/navigation/params';

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
    const key = textRouteParam(id);
    return key && staged?.id === key ? staged.msg : null;
}

export function clearShareMedia(id) {
    const key = textRouteParam(id);
    if (!key || staged?.id === key) {
        staged = null;
    }
}
