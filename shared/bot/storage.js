import { decodeFileKey, openFileForPath } from '../crypto/file.js';
import { getMediaFileId, makeChatFileUploadPayload } from '../chat/filepayload.js';
import { pickAttachmentMeta } from '../chat/media.js';

function buildAttachmentMessage(type, file, meta = {}) {
    return {
        t: typeof type === 'string' && type ? type : 'file',
        p: file.p,
        k: file.k,
        ...(Number.isFinite(file?.x) ? { x: file.x } : {}),
        ...(typeof file?.stay === 'string' && file.stay ? { stay: file.stay } : {}),
        ...pickAttachmentMeta(meta),
    };
}

export async function putBotAttachment(bucket, pair, cid, type, data, meta = {}) {
    if (!bucket) {
        throw new Error('storage bucket required');
    }

    const upload = await makeChatFileUploadPayload(pair, cid, data, {
        contentType: meta?.mimeType || 'application/octet-stream',
        stay: typeof meta?.stay === 'string' ? meta.stay : '',
    });

    const file = bucket.file(upload.path);
    await file.save(Buffer.from(upload.body), {
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
    getMediaFileId(msg?.p);
    return openFileForPath(decodeFileKey(msg?.k), new Uint8Array(body), msg?.p);
}
