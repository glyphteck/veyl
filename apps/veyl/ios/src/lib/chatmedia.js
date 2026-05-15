import { Buffer } from 'buffer';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { ref, uploadBytes } from 'firebase/storage';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { createVideoPlayer } from 'expo-video';
import { closeChatPair, openChatPair } from '@glyphteck/shared/crypto/chat';
import { CHAT_FILE_SIZE_LIMIT_ENABLED, MAX_CHAT_FILE_BYTES } from '@glyphteck/shared/chat/filepayload';
import { chatFilePath, getChatFileChatId, readFile } from '@glyphteck/shared/files';
import { createFileKey, decodeFileKey, encodeFileKey, FILE_IV_BYTES, FILE_TAG_BYTES, getFileAadForChat } from '@glyphteck/shared/crypto/file';
import { cleanBytes, randomBytes, toBytes } from '@glyphteck/shared/crypto/core';
import { packRawData, unpackBodyData } from '@glyphteck/shared/crypto/pack';
import { makeAttachment } from '@glyphteck/shared/chat/messages';
import { pickAttachmentMeta } from '@glyphteck/shared/chat/media';

export const MAX_CHAT_IMAGE_EDGE = 1600;
export const CHAT_IMAGE_COMPRESS = 0.82;

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

function toBase64(bytes) {
    return Buffer.from(bytes).toString('base64');
}

async function readUriBytes(uri) {
    if (!uri) {
        throw new Error('asset uri required');
    }

    const base64 = await LegacyFileSystem.readAsStringAsync(uri, {
        encoding: LegacyFileSystem.EncodingType.Base64,
    });
    return new Uint8Array(Buffer.from(base64, 'base64'));
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
            finish(null, {
                duration,
                width: event?.videoTrack?.size?.width,
                height: event?.videoTrack?.size?.height,
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

export async function uploadStorageBytesNative(storage, path, data, metadata = {}) {
    if (!storage) {
        throw new Error('storage required');
    }
    if (!path) {
        throw new Error('storage path required');
    }

    const body = toBytes(data, 'upload bytes');
    const cacheDir = LegacyFileSystem.cacheDirectory;
    if (!cacheDir) {
        throw new Error('cache directory unavailable');
    }

    const tempUri = `${cacheDir}chatupload-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`;

    try {
        await LegacyFileSystem.writeAsStringAsync(tempUri, toBase64(body), {
            encoding: LegacyFileSystem.EncodingType.Base64,
        });
        const response = await fetch(tempUri);
        const blob = await response.blob();
        await uploadBytes(ref(storage, path), blob, metadata);
        return path;
    } finally {
        await LegacyFileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
    }
}

async function sealChatFileNative(pair, key, bytes, path) {
    const fileKey = new Uint8Array(decodeFileKey(key));
    try {
        const aesKey = await AESEncryptionKey.import(fileKey);
        const sealed = await aesEncryptAsync(bytes, aesKey, {
            nonce: { bytes: randomBytes(FILE_IV_BYTES) },
            additionalData: getFileAadForChat(pair?.chatId, path),
        });
        const nonce = new Uint8Array(await sealed.iv());
        const ciphertext = new Uint8Array(await sealed.ciphertext({ includeTag: true }));
        return packRawData(nonce, ciphertext);
    } finally {
        cleanBytes(fileKey);
    }
}

async function openChatFileNative(chatId, key, body, path) {
    const fileKey = new Uint8Array(decodeFileKey(key));
    try {
        const aesKey = await AESEncryptionKey.import(fileKey);
        const { nonce, ct } = unpackBodyData(body, FILE_IV_BYTES);
        const sealed = AESSealedData.fromParts(nonce, ct, FILE_TAG_BYTES);
        return new Uint8Array(
            await aesDecryptAsync(sealed, aesKey, {
                additionalData: getFileAadForChat(chatId, path),
            })
        );
    } finally {
        cleanBytes(fileKey);
    }
}

async function makeChatFileUploadNative(pair, cid, data, meta = {}) {
    const path = chatFilePath(pair?.chatId, cid);
    const key = createFileKey();
    try {
        const uploadBytes = toBytes(data, 'upload bytes');
        assertChatFileSize(uploadBytes);
        return {
            path,
            body: await sealChatFileNative(pair, key, uploadBytes, path),
            metadata: {
                contentType: meta?.contentType || 'application/octet-stream',
                cacheControl: meta?.cacheControl || 'private, max-age=0, no-transform',
                customMetadata: {
                    chatId: pair.chatId,
                    cid,
                    slot: 'main',
                },
            },
            file: {
                p: path,
                k: encodeFileKey(key),
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
    if (isImageAsset(asset)) {
        const normalized = await ImageManipulator.manipulate(asset.uri).renderAsync();
        const resize = getResizedImageSize(normalized.width, normalized.height);
        const result = resize ? await ImageManipulator.manipulate(normalized).resize(resize).renderAsync() : normalized;
        const png = isPngAsset(asset);
        const saved = await result.saveAsync({
            compress: png ? 1 : CHAT_IMAGE_COMPRESS,
            format: png ? SaveFormat.PNG : SaveFormat.JPEG,
        });
        const data = await readUriBytes(saved.uri);
        return {
            data,
            mimeType: png ? 'image/png' : 'image/jpeg',
            size: Number.isFinite(data?.byteLength) ? data.byteLength : (asset?.fileSize ?? asset?.size),
            width: saved.width,
            height: saved.height,
            name: getAssetName(asset, png ? 'png' : 'jpg'),
            previewUri: saved.uri,
        };
    }

    if (isVideoAsset(asset)) {
        const videoMeta = await readVideoMeta(asset.uri);
        const data = await readUriBytes(asset.uri);
        assertReadableVideoBytes(data);
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

export async function uploadAttachmentMsgNative(storage, senderPubkey, senderPrivkey, receiverChatPK, attachment = {}) {
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
    const pair = await openChatPair(senderPubkey, senderPrivkey, receiverChatPK);
    let upload = null;

    try {
        upload = await makeChatFileUploadNative(pair, nextCid, data, meta);
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
    } finally {
        closeChatPair(pair);
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
        const chatId = getChatFileChatId(msg.p);
        const body = await readFile(storage, msg.p);
        return await openChatFileNative(chatId, msg.k, body, msg.p);
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
