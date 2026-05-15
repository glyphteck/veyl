import { putAvatar } from '@glyphteck/shared/files';
import { storage } from './firebase';

export async function uploadAvatar({ uid, uri, mimeType }) {
    if (!uid) {
        throw new Error('uid is required');
    }
    if (!storage) {
        throw new Error('storage unavailable');
    }

    const response = await fetch(uri);
    const blob = await response.blob();

    return putAvatar(storage, uid, blob, mimeType || 'image/jpeg');
}
