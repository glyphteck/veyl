import { File } from 'expo-file-system';
import { fetch as nativeFetch } from 'expo/fetch';
import { ref } from 'firebase/storage';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { createVideoPlayer } from 'expo-video';
import { CHAT_FILE_SIZE_LIMIT_ENABLED, CHAT_MEDIA_TTL_MS, MAX_CHAT_FILE_BYTES } from '@glyphteck/shared/chat/filepayload';
import { getMediaFileId, mediaFilePath, readFile } from '@glyphteck/shared/files';
import { createFileKey, decodeFileKey, encodeFileKey, FILE_IV_BYTES, FILE_TAG_BYTES, getFileAadForPath } from '@glyphteck/shared/crypto/file';
import { cleanBytes, randomBytes, toBytes } from '@glyphteck/shared/crypto/core';
import { packRawData, unpackBodyData } from '@glyphteck/shared/crypto/pack';
import { makeAttachment } from '@glyphteck/shared/chat/messages';
import { pickAttachmentMeta } from '@glyphteck/shared/chat/media';
import { mark } from '@/lib/diagnostics';

export const MAX_CHAT_IMAGE_EDGE = 1600;
export const CHAT_IMAGE_COMPRESS = 0.82;
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
    const mimeType = String(asset?.mimeType || '').toLowerCase();
    if (mimeType.startsWith('image/')) {
        return true;
    }

    const name = String(asset?.fileName || asset?.name || '').toLowerCase();
    return /\.(avif|gif|heic|heif|jpe?g|png|webp)$/.test(name);
}

function isVideoAsset(asset) {
    const mimeType = String(asset?.mimeType || '').toLowerCase();
    if (mimeType.startsWith('video/')) {
        return true;
    }

    const name = String(asset?.fileName || asset?.name || '').toLowerCase();
    return /\.(m4v|mov|mp4|webm)$/.test(name);
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

function assertChatFileSize(bytes) {
    if (!Number.isFinite(bytes?.byteLength)) {
        throw new Error('upload bytes required');
    }
    if (CHAT_FILE_SIZE_LIMIT_ENABLED && bytes.byteLength > MAX_CHAT_FILE_BYTES) {
        const error = new Error('file too large');
        error.code = 'file-too-large';
        error.maxBytes = MAX_CHAT_FILE_BYTES;
        error.size = bytes.byteLength;
        throw error;
    }
}

function assertReadableVideoBytes(bytes) {
    if (!Number.isFinite(bytes?.byteLength) || bytes.byteLength <= 0) {
        const error = new Error('video unavailable');
        error.code = 'video-unavailable';
        throw error;
    }
}

function readVideoMeta(uri) {
    return new Promise((resolve, reject) => {
        if (!uri) {
            reject(new Error('video unavailable'));
            return;
        }

        let done = false;
        let sourceSub = null;
        let statusSub = null;
        let timeout = null;
        const player = createVideoPlayer(null);
        const finish = (error, meta = null) => {
            if (done) {
                return;
            }
            done = true;
            clearTimeout(timeout);
            sourceSub?.remove?.();
            statusSub?.remove?.();
            player.release?.();
            if (error) {
                error.code = error.code || 'video-unavailable';
                reject(error);
                return;
            }
            resolve(meta);
        };
        timeout = setTimeout(() => finish(new Error('video unavailable')), 5000);
        sourceSub = player.addListener('sourceLoad', (event) => {
            const duration = Number(event?.duration);
            if (!Number.isFinite(duration) || duration <= 0) {
                finish(new Error('video unavailable'));
                return;
            }
            readVideoDisplaySize(player, duration, event?.videoTrack?.size)
                .then((size) => {
                    finish(null, {
                        duration,
                        ...size,
                    });
                })
                .catch(() => {
                    finish(null, {
                        duration,
                        width: event?.videoTrack?.size?.width,
                        height: event?.videoTrack?.size?.height,
                    });
                });
        });
        statusSub = player.addListener('statusChange', (event) => {
            if (event?.status === 'error') {
                finish(new Error(event?.error?.message || 'video unavailable'));
            }
        });
        Promise.resolve(player.replaceAsync({ uri })).catch((error) => finish(error || new Error('video unavailable')));
    });
}

function normalizeVideoSize(trackSize, displaySize) {
    const trackWidth = Number(trackSize?.width);
    const trackHeight = Number(trackSize?.height);
    const displayWidth = Number(displaySize?.width);
    const displayHeight = Number(displaySize?.height);

    if (trackWidth > 0 && trackHeight > 0 && displayWidth > 0 && displayHeight > 0) {
        const wide = displayWidth >= displayHeight;
        const long = Math.round(Math.max(trackWidth, trackHeight));
        const short = Math.round(Math.min(trackWidth, trackHeight));
        return wide ? { width: long, height: short } : { width: short, height: long };
    }

    if (trackWidth > 0 && trackHeight > 0) {
        return { width: Math.round(trackWidth), height: Math.round(trackHeight) };
    }

    if (displayWidth > 0 && displayHeight > 0) {
        return { width: Math.round(displayWidth), height: Math.round(displayHeight) };
    }

    return {};
}

async function readVideoDisplaySize(player, duration, trackSize) {
    void player;
    void duration;
    // Thumbnail probing is disabled until the Expo video path is stable on iOS.
    return normalizeVideoSize(trackSize, null);
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

async function makeChatFileUploadNative(_cid, data, meta = {}) {
    const stayId = typeof meta?.stay === 'string' ? meta.stay.trim() : '';
    const path = mediaFilePath();
    const key = createFileKey();
    try {
        const uploadBytes = toBytes(data, 'upload bytes');
        assertChatFileSize(uploadBytes);
        return {
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
                ...(stayId ? { stay: stayId } : {}),
            },
        };
    } finally {
        cleanBytes(key);
    }
}

function getResizedImageSize(width, height, maxEdge = MAX_CHAT_IMAGE_EDGE) {
    const nextWidth = Number(width) || 0;
    const nextHeight = Number(height) || 0;
    if (!nextWidth || !nextHeight) {
        return null;
    }

    const currentMax = Math.max(nextWidth, nextHeight);
    if (currentMax <= maxEdge) {
        return null;
    }

    const scale = maxEdge / currentMax;
    return {
        width: Math.max(1, Math.round(nextWidth * scale)),
        height: Math.max(1, Math.round(nextHeight * scale)),
    };
}

function getAssetName(asset, ext = 'jpg') {
    const raw = String(asset?.fileName || asset?.name || 'image').trim();
    const base = raw.replace(/\.[^.]+$/, '') || 'image';
    return `${base}.${ext}`;
}

function isPngAsset(asset) {
    const mimeType = String(asset?.mimeType || '').toLowerCase();
    const name = String(asset?.fileName || asset?.name || '').toLowerCase();
    return mimeType === 'image/png' || /\.png$/.test(name);
}

export async function prepareAssetForChatUpload(asset) {
    if (!asset?.uri) {
        throw new Error('asset uri required');
    }

    const mimeType = String(asset?.mimeType || '').toLowerCase();
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
        const resize = getResizedImageSize(sourceWidth, sourceHeight);
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
        const videoMeta = await readVideoMeta(asset.uri);
        const data = await readUriBytes(asset.uri);
        assertReadableVideoBytes(data);
        mark('chat.media.prepare.video.done', { bytes: data?.byteLength || 0, duration: videoMeta?.duration || 0 });
        return {
            data,
            mimeType: 'video/mp4',
            size: Number.isFinite(data?.byteLength) ? data.byteLength : (asset?.fileSize ?? asset?.size),
            width: Number.isFinite(videoMeta?.width) ? videoMeta.width : asset?.width,
            height: Number.isFinite(videoMeta?.height) ? videoMeta.height : asset?.height,
            duration: videoMeta.duration,
            name: getAssetName(asset, 'mp4'),
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

export async function uploadAttachmentMsgNative(storage, senderPubkey, senderPrivkey, _receiverChatPK, attachment = {}) {
    if (!storage) {
        throw new Error('storage required');
    }
    if (!senderPrivkey || !senderPubkey) {
        throw new Error('vault locked');
    }

    const nextCid = typeof attachment?.cid === 'string' ? attachment.cid.trim() : '';
    if (!nextCid) {
        throw new Error('message cid required');
    }

    const type = typeof attachment?.type === 'string' && attachment.type ? attachment.type : 'file';
    const data = attachment?.data;
    const meta = attachment?.meta || {};
    let upload = null;

    try {
        upload = await makeChatFileUploadNative(nextCid, data, meta);
        await uploadStorageBytesNative(storage, upload.path, upload.body, upload.metadata);
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

export async function readMessageFileNative(storage, userChatPK, userPrivKey, peerChatPK, msg) {
    if (!storage) {
        throw new Error('storage required');
    }
    if (!userChatPK || !userPrivKey || !peerChatPK || !msg?.p || !msg?.k) {
        throw new Error('file unavailable');
    }

    try {
        getMediaFileId(msg.p);
        const body = await readFile(storage, msg.p);
        return await openChatFileNative(msg.k, body, msg.p);
    } catch (error) {
        if (error && typeof error === 'object') {
            error.path = error?.path || msg?.p || null;
            error.stage = error?.stage || 'decrypt';
        }
        throw error;
    }
}

export async function uploadImgMsgNative(storage, senderPubkey, senderPrivkey, receiverChatPK, cid, data, meta = {}) {
    return uploadAttachmentMsgNative(storage, senderPubkey, senderPrivkey, receiverChatPK, {
        cid,
        type: 'img',
        data,
        meta,
    });
}
