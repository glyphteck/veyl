import { decodeFileKey, openFileForChat } from '../crypto/file.js';
import { getChatFileChatId, makeChatFileUploadPayload } from '../chat/filepayload.js';
import { pickAttachmentMeta } from '../chat/media.js';

function buildAttachmentMessage(type, file, meta = {}) {
    return {
        t: typeof type === 'string' && type ? type : 'file',
        p: file.p,
        k: file.k,
        ...pickAttachmentMeta(meta),
    };
}

export async function putBotAttachment(bucket, pair, cid, type, data, meta = {}) {
    if (!bucket) {
        throw new Error('storage bucket required');
    }

    const upload = await makeChatFileUploadPayload(pair, cid, data, {
        contentType: meta?.mimeType || 'application/octet-stream',
    });

    await bucket.file(upload.path).save(Buffer.from(upload.body), {
        resumable: false,
        validation: false,
        metadata: upload.metadata,
    });

    return buildAttachmentMessage(type, upload.file, meta);
}

export async function readBotAttachment(bucket, msg) {
    if (!bucket) {
        throw new Error('storage bucket required');
    }

    const [body] = await bucket.file(msg?.p).download();
    return openFileForChat(getChatFileChatId(msg?.p), decodeFileKey(msg?.k), new Uint8Array(body), msg?.p);
}
