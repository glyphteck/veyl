import { File } from 'expo-file-system';
import { fetch as nativeFetch } from 'expo/fetch';
import { ref } from 'firebase/storage';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { CHAT_IMAGE_COMPRESS, CHAT_MEDIA_TTL_MS, assertChatUploadByteSize, fitChatImageSize } from '@veyl/shared/chat/filepayload';
import { filenameWithExtension } from '@veyl/shared/utils/filename';
import { fileExtension, fileMime, isImageFile, isPngFile, isVideoFile } from '@veyl/shared/utils/filetype';
import { getMediaFileRef, mediaFilePath } from '@veyl/shared/files';
import { createFileKey, decodeFileKey, encodeFileKey, FILE_IV_BYTES, FILE_TAG_BYTES, getFileAadForPath } from '@veyl/shared/crypto/file';
import { cleanBytes, randomBytes, toBytes } from '@veyl/shared/crypto/core';
import { packRawData, unpackBodyData } from '@veyl/shared/crypto/pack';
import { makeAttachment } from '@veyl/shared/chat/messages';
import { pickAttachmentMeta } from '@veyl/shared/chat/media';
import { getCachedPair } from '@veyl/shared/chat/pairs';
import { positiveNumber } from '@veyl/shared/utils/number';
import { cleanText } from '@veyl/shared/utils/text';
import { mark } from '@/lib/diagnostics';

const STORAGE_HOST = 'firebasestorage.googleapis.com';

function storageOrigin(storage) {
    const host = String(storage?.host || storage?._host || STORAGE_HOST).replace(/^https?:\/\//, '');
    const protocol = storage?._protocol || (String(storage?.host || '').startsWith('http://') ? 'http' : 'https');
    return `${protocol}://${host}`;
}

function storageMetadataResource(path, metadata = {}) {
    const resource = { name: path };
    if (metadata?.cacheControl) resource.cacheControl = metadata.cacheControl;
    if (metadata?.contentDisposition) resource.contentDisposition = metadata.contentDisposition;
    if (metadata?.contentEncoding) resource.contentEncoding = metadata.contentEncoding;
    if (metadata?.contentLanguage) resource.contentLanguage = metadata.contentLanguage;
    if (metadata?.contentType) resource.contentType = metadata.contentType;
    if (metadata?.customMetadata && typeof metadata.customMetadata === 'object') {
        resource.metadata = metadata.customMetadata;
    }
    return resource;
}

async function storageAuthHeaders(storage) {
    const headers = {
        'X-Firebase-Storage-Version': `webjs/${storage?._firebaseVersion || 'AppManager'}`,
    };
    const appId = storage?.app?.options?.appId || storage?._appId || '';
    if (appId) {
        headers['X-Firebase-GMPID'] = appId;
    }
    const authToken = typeof storage?._getAuthToken === 'function' ? await storage._getAuthToken() : null;
    if (authToken) {
        headers.Authorization = `Firebase ${authToken}`;
    }
    const appCheckToken = typeof storage?._getAppCheckToken === 'function' ? await storage._getAppCheckToken() : null;
    if (appCheckToken) {
        headers['X-Firebase-AppCheck'] = appCheckToken;
    }
    return headers;
}

async function startStorageUploadSession(storage, path, bytes, metadata = {}) {
    const reference = ref(storage, path);
    const endpoint = `${storageOrigin(reference.storage)}/v0/b/${encodeURIComponent(reference.bucket)}/o?name=${encodeURIComponent(reference.fullPath)}`;
    const headers = {
        ...(await storageAuthHeaders(reference.storage)),
        'Content-Type': 'application/json; charset=utf-8',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(bytes.byteLength || 0),
        'X-Goog-Upload-Header-Content-Type': metadata?.contentType || 'application/octet-stream',
    };

    mark('chat.media.uploadBytes.session.start', { path, bytes: bytes.byteLength || 0 });
    const response = await nativeFetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(storageMetadataResource(reference.fullPath, metadata)),
    });
    const uploadUrl = response.headers?.get?.('X-Goog-Upload-URL') || response.headers?.get?.('x-goog-upload-url') || '';
    if (!response.ok || !uploadUrl) {
        const error = new Error(`upload session failed (${response.status || 0})`);
        error.status = response.status || 0;
        error.stage = 'upload-session';
        error.responseText = await response.text().catch(() => '');
        throw error;
    }
    mark('chat.media.uploadBytes.session.done', { path, status: response.status || 0 });
    return uploadUrl;
}

async function uploadStorageBody(uploadUrl, body, contentType) {
    const response = await nativeFetch(uploadUrl, {
        method: 'POST',
        headers: {
            'Content-Type': contentType || 'application/octet-stream',
            'X-Goog-Upload-Command': 'upload, finalize',
            'X-Goog-Upload-Offset': '0',
        },
        body,
    });
    if (!response.ok) {
        const error = new Error(`upload failed (${response.status || 0})`);
        error.status = response.status || 0;
        error.stage = 'upload';
        error.responseText = await response.text().catch(() => '');
        throw error;
    }
    mark('chat.media.uploadBytes.body.done', { status: response.status || 0 });
    return response;
}

function isImageAsset(asset) {
    if (asset?.type === 'image' || asset?.type === 'livePhoto') {
        return true;
    }

    return isImageFile(asset);
}

function isVideoAsset(asset) {
    if (asset?.type === 'video' || asset?.type === 'pairedVideo') {
        return true;
    }

    return isVideoFile(asset);
}

async function readUriBytes(uri) {
    if (!uri) {
        throw new Error('asset uri required');
    }
    try {
        mark('chat.media.readFile.start', { uri });
        return await new File(uri).bytes();
    } catch (error) {
        mark('chat.media.readFile.fallback', { uri, message: error?.message || String(error) });
        const response = await fetch(uri);
        if (!response.ok && response.status !== 0) {
            throw error;
        }
        return new Uint8Array(await response.arrayBuffer());
    }
}

function assertReadableVideoBytes(bytes) {
    if (!Number.isFinite(bytes?.byteLength) || bytes.byteLength <= 0) {
        const error = new Error('video unavailable');
        error.code = 'video-unavailable';
        throw error;
    }
}

export async function uploadStorageBytesNative(storage, path, data, metadata = {}) {
    if (!storage) {
        throw new Error('storage required');
    }
    if (!path) {
        throw new Error('storage path required');
    }

    const body = toBytes(data, 'upload bytes');

    mark('chat.media.uploadBytes.start', { path, bytes: body.byteLength || 0, contentType: metadata?.contentType || '' });
    const uploadUrl = await startStorageUploadSession(storage, path, body, metadata);
    mark('chat.media.uploadBytes.body.start', { path, bytes: body.byteLength || 0 });
    await uploadStorageBody(uploadUrl, body, metadata?.contentType);
    mark('chat.media.uploadBytes.done', { path });
    return path;
}

export async function uploadSignedStorageBytesNative(url, data, options = {}) {
    if (!url) {
        throw new Error('signed upload url required');
    }
    const body = toBytes(data, 'upload bytes');
    const path = cleanText(options?.path);
    const headers = options?.headers || {
        'Content-Type': options?.metadata?.contentType || 'application/octet-stream',
    };
    mark('chat.media.signedUpload.start', { path, bytes: body.byteLength || 0, contentType: headers['Content-Type'] || headers['content-type'] || '' });
    const response = await nativeFetch(url, {
        method: options?.method || 'PUT',
        headers,
        body,
    });
    if (!response.ok) {
        const error = new Error(`signed upload failed (${response.status || 0})`);
        error.status = response.status || 0;
        error.stage = 'upload';
        error.responseText = await response.text().catch(() => '');
        throw error;
    }
    mark('chat.media.signedUpload.done', { path, status: response.status || 0 });
    return true;
}

async function sealChatFileNative(key, bytes, path) {
    const fileKey = new Uint8Array(decodeFileKey(key));
    try {
        mark('chat.media.encrypt.start', { path, bytes: bytes?.byteLength || 0 });
        const aesKey = await AESEncryptionKey.import(fileKey);
        const sealed = await aesEncryptAsync(bytes, aesKey, {
            nonce: { bytes: randomBytes(FILE_IV_BYTES) },
            additionalData: getFileAadForPath(path),
        });
        const nonce = new Uint8Array(await sealed.iv());
        const ciphertext = new Uint8Array(await sealed.ciphertext({ includeTag: true }));
        mark('chat.media.encrypt.done', { path, bytes: ciphertext.byteLength || 0 });
        return packRawData(nonce, ciphertext);
    } finally {
        cleanBytes(fileKey);
    }
}

async function openChatFileNative(key, body, path) {
    const fileKey = new Uint8Array(decodeFileKey(key));
    try {
        const aesKey = await AESEncryptionKey.import(fileKey);
        const { nonce, ct } = unpackBodyData(body, FILE_IV_BYTES);
        const sealed = AESSealedData.fromParts(nonce, ct, FILE_TAG_BYTES);
        return new Uint8Array(
            await aesDecryptAsync(sealed, aesKey, {
                additionalData: getFileAadForPath(path),
            })
        );
    } finally {
        cleanBytes(fileKey);
    }
}

async function makeChatFileUploadNative(pair, cid, data, meta = {}) {
    const path = mediaFilePath(pair?.chatId, cid);
    const key = createFileKey();
    try {
        const uploadBytes = toBytes(data, 'upload bytes');
        assertChatUploadByteSize(uploadBytes);
        return {
            chatId: pair.chatId,
            messageKey: cleanText(cid),
            path,
            body: await sealChatFileNative(key, uploadBytes, path),
            metadata: {
                contentType: meta?.contentType || 'application/octet-stream',
                cacheControl: meta?.cacheControl || 'private, max-age=0, no-transform',
            },
            file: {
                p: path,
                k: encodeFileKey(key),
                x: Date.now() + CHAT_MEDIA_TTL_MS,
            },
        };
    } finally {
        cleanBytes(key);
    }
}

function getAssetName(asset, ext = 'jpg') {
    return filenameWithExtension(asset?.fileName || asset?.name, ext, 'image');
}

function getVideoMimeType(asset) {
    const mimeType = fileMime(asset);
    return mimeType.startsWith('video/') ? mimeType : 'video/mp4';
}

function getVideoExtension(asset) {
    const ext = fileExtension(asset);
    if (/^(m4v|mov|mp4|webm)$/.test(ext)) {
        return ext;
    }

    const mimeType = getVideoMimeType(asset);
    if (mimeType === 'video/quicktime') {
        return 'mov';
    }
    if (mimeType === 'video/webm') {
        return 'webm';
    }
    if (mimeType === 'video/x-m4v') {
        return 'm4v';
    }
    return 'mp4';
}

function getVideoDurationSeconds(asset) {
    const durationMs = positiveNumber(asset?.duration, null);
    return durationMs ? durationMs / 1000 : null;
}

function isPngAsset(asset) {
    return isPngFile(asset);
}

export async function prepareAssetForChatUpload(asset) {
    if (!asset?.uri) {
        throw new Error('asset uri required');
    }

    const mimeType = fileMime(asset);
    mark('chat.media.prepare.start', { uri: asset.uri, mimeType, width: asset?.width || 0, height: asset?.height || 0, fileSize: asset?.fileSize || asset?.size || 0 });
    if (isImageAsset(asset)) {
        if (asset?.preserveImage === true) {
            mark('chat.media.prepare.image.preserve', {});
            const data = await readUriBytes(asset.uri);
            const png = isPngAsset(asset);
            const width = Number(asset?.width);
            const height = Number(asset?.height);
            return {
                data,
                mimeType: asset?.mimeType || (png ? 'image/png' : 'image/jpeg'),
                size: Number.isFinite(data?.byteLength) ? data.byteLength : (asset?.fileSize ?? asset?.size),
                ...(Number.isFinite(width) && width > 0 ? { width } : {}),
                ...(Number.isFinite(height) && height > 0 ? { height } : {}),
                name: getAssetName(asset, png ? 'png' : 'jpg'),
                previewUri: asset.uri,
            };
        }

        const sourceWidth = Number(asset?.width);
        const sourceHeight = Number(asset?.height);
        const fitted = fitChatImageSize(sourceWidth, sourceHeight);
        const resize = fitted && (fitted.width !== sourceWidth || fitted.height !== sourceHeight) ? fitted : null;
        const png = isPngAsset(asset);
        let context = null;
        let rendered = null;
        try {
            context = ImageManipulator.manipulate(asset.uri);
            mark('chat.media.prepare.image.resize.start', { resize: !!resize, width: resize?.width || sourceWidth || 0, height: resize?.height || sourceHeight || 0 });
            if (resize) {
                context.resize(resize);
            }
            mark('chat.media.prepare.image.resize.done', { resize: !!resize });
            mark('chat.media.prepare.image.render.start', { resize: !!resize, width: resize?.width || sourceWidth || 0, height: resize?.height || sourceHeight || 0 });
            rendered = await context.renderAsync();
            mark('chat.media.prepare.image.render.done', { width: rendered.width || 0, height: rendered.height || 0 });
            mark('chat.media.prepare.image.save.start', { png });
            const saved = await rendered.saveAsync({
                compress: png ? 1 : CHAT_IMAGE_COMPRESS,
                format: png ? SaveFormat.PNG : SaveFormat.JPEG,
            });
            mark('chat.media.prepare.image.save.done', { uri: saved.uri, width: saved.width || 0, height: saved.height || 0 });
            const data = await readUriBytes(saved.uri);
            mark('chat.media.prepare.image.done', { bytes: data?.byteLength || 0 });
            return {
                data,
                mimeType: png ? 'image/png' : 'image/jpeg',
                size: Number.isFinite(data?.byteLength) ? data.byteLength : (asset?.fileSize ?? asset?.size),
                width: saved.width,
                height: saved.height,
                name: getAssetName(asset, png ? 'png' : 'jpg'),
                previewUri: saved.uri,
            };
        } finally {
            rendered?.release?.();
            context?.release?.();
        }
    }

    if (isVideoAsset(asset)) {
        mark('chat.media.prepare.video.start', {});
        const data = await readUriBytes(asset.uri);
        assertReadableVideoBytes(data);
        assertChatUploadByteSize(data);
        const width = positiveNumber(asset?.width);
        const height = positiveNumber(asset?.height);
        const duration = getVideoDurationSeconds(asset);
        mark('chat.media.prepare.video.done', { bytes: data?.byteLength || 0, duration: duration || 0 });
        return {
            data,
            mimeType: getVideoMimeType(asset),
            size: Number.isFinite(data?.byteLength) ? data.byteLength : (asset?.fileSize ?? asset?.size),
            ...(width ? { width } : {}),
            ...(height ? { height } : {}),
            ...(duration ? { duration } : {}),
            name: getAssetName(asset, getVideoExtension(asset)),
            previewUri: asset.uri,
        };
    }

    const data = await readUriBytes(asset.uri);
    mark('chat.media.prepare.file.done', { bytes: data?.byteLength || 0, mimeType });
    return {
        data,
        mimeType: asset?.mimeType || 'application/octet-stream',
        size: Number.isFinite(data?.byteLength) ? data.byteLength : (asset?.fileSize ?? asset?.size),
        width: asset?.width,
        height: asset?.height,
        name: asset?.fileName || asset?.name,
        ...(mimeType.startsWith('image/') ? { previewUri: asset.uri } : {}),
        ...(mimeType.startsWith('audio/') ? { localUri: asset.uri } : {}),
    };
}

export async function uploadAttachmentMsgNative(senderPubkey, senderPrivkey, receiverChatPK, attachment = {}) {
    if (!senderPrivkey || !senderPubkey) {
        throw new Error('vault locked');
    }

    const nextCid = cleanText(attachment?.cid);
    if (!nextCid) {
        throw new Error('message cid required');
    }

    const type = typeof attachment?.type === 'string' && attachment.type ? attachment.type : 'file';
    const data = attachment?.data;
    const meta = attachment?.meta || {};
    let upload = null;

    try {
        const chatId = cleanText(attachment?.chatId || meta?.chatId);
        if (!chatId) {
            throw new Error('chat id required');
        }
        const pair = await getCachedPair(senderPubkey, senderPrivkey, receiverChatPK, { chatId });
        upload = await makeChatFileUploadNative(pair, nextCid, data, meta);
        if (typeof meta?.uploadChatMedia !== 'function') {
            throw new Error('chat media upload required');
        }
        await meta.uploadChatMedia(upload);
        return makeAttachment(type, {
            ...upload.file,
            ...pickAttachmentMeta(meta),
        });
    } catch (error) {
        if (error && typeof error === 'object') {
            error.stage = error?.stage || 'upload';
            error.path = error?.path || upload?.path || null;
        }
        throw error;
    }
}

export async function readMessageFileNative(readChatMedia, userChatPK, userPrivKey, peerChatPK, msg) {
    if (typeof readChatMedia !== 'function') {
        throw new Error('chat media read required');
    }
    if (!userChatPK || !userPrivKey || !peerChatPK || !msg?.p || !msg?.k) {
        throw new Error('file unavailable');
    }

    try {
        getMediaFileRef(msg.p);
        const body = await readChatMedia(msg.p);
        return await openChatFileNative(msg.k, body, msg.p);
    } catch (error) {
        if (error && typeof error === 'object') {
            error.path = error?.path || msg?.p || null;
            error.stage = error?.stage || 'decrypt';
        }
        throw error;
    }
}

export async function uploadImgMsgNative(senderPubkey, senderPrivkey, receiverChatPK, cid, data, meta = {}) {
    return uploadAttachmentMsgNative(senderPubkey, senderPrivkey, receiverChatPK, {
        cid,
        type: 'img',
        data,
        meta,
    });
}
