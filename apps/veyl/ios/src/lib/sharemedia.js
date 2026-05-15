import { canShareAttachmentMsg, makeSharedAttachment } from '@glyphteck/shared/chat/messages';

let staged = null;
let nextId = 0;

export function stageShareMedia(msg) {
    if (!canShareAttachmentMsg(msg)) {
        return null;
    }

    nextId += 1;
    const id = `share-${Date.now().toString(36)}-${nextId}`;
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
