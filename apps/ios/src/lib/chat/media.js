import { File } from 'expo-file-system';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { CHAT_IMAGE_COMPRESS, CHAT_MEDIA_TTL_MS, assertChatUploadByteSize, fitChatImageSize } from '@veyl/shared/chat/filepayload';
import { filenameWithExtension } from '@veyl/shared/utils/filename';
import { fileExtension, fileMime, isImageFile, isPngFile, isVideoFile } from '@veyl/shared/utils/filetype';
import { getMediaFileRef, makeChatMediaId, mediaFilePath } from '@veyl/shared/files';
import { createFileKey, decodeFileKey, encodeFileKey, FILE_IV_BYTES, FILE_TAG_BYTES, getFileAadForPath } from '@veyl/shared/crypto/file';
import { cleanBytes, randomBytes, toBytes } from '@veyl/shared/crypto/core';
import { packRawData, unpackBodyData } from '@veyl/shared/crypto/pack';
import { makeAttachment } from '@veyl/shared/chat/messages';
import { pickAttachmentMeta } from '@veyl/shared/chat/media';
import { getCachedPair } from '@veyl/shared/chat/pairs';
import { positiveNumber } from '@veyl/shared/utils/number';
import { cleanText } from '@veyl/shared/utils/text';
import { mark } from '@/lib/diagnostics';

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
    const mediaId = makeChatMediaId();
    const path = mediaFilePath(pair?.chatId, mediaId);
    const key = createFileKey();
    try {
        const uploadBytes = toBytes(data, 'upload bytes');
        assertChatUploadByteSize(uploadBytes);
        return {
            chatId: pair.chatId,
            mediaId,
            path,
            body: await sealChatFileNative(key, uploadBytes, path),
            metadata: {
                contentType: 'application/octet-stream',
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
