import { fetch as nativeFetch } from 'expo/fetch';
import { ref } from 'firebase/storage';
import { toBytes } from '@veyl/shared/crypto/core';
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

    mark('cloud.storage.uploadBytes.session.start', { path, bytes: bytes.byteLength || 0 });
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
    mark('cloud.storage.uploadBytes.session.done', { path, status: response.status || 0 });
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
    mark('cloud.storage.uploadBytes.body.done', { status: response.status || 0 });
    return response;
}

export async function uploadStorageBytesNative(storage, path, data, metadata = {}) {
    if (!storage) {
        throw new Error('storage required');
    }
    if (!path) {
        throw new Error('storage path required');
    }

    const body = toBytes(data, 'upload bytes');

    mark('cloud.storage.uploadBytes.start', { path, bytes: body.byteLength || 0, contentType: metadata?.contentType || '' });
    const uploadUrl = await startStorageUploadSession(storage, path, body, metadata);
    mark('cloud.storage.uploadBytes.body.start', { path, bytes: body.byteLength || 0 });
    await uploadStorageBody(uploadUrl, body, metadata?.contentType);
    mark('cloud.storage.uploadBytes.done', { path });
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
    mark('cloud.storage.signedUpload.start', { path, bytes: body.byteLength || 0, contentType: headers['Content-Type'] || headers['content-type'] || '' });
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
    mark('cloud.storage.signedUpload.done', { path, status: response.status || 0 });
    return true;
}
