import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { cloud } from '@/lib/cloud';

function readAvatarGeneration(value) {
    const version = Number(value);
    if (!Number.isSafeInteger(version) || version <= 0) {
        throw new Error('Avatar upload did not return a valid generation.');
    }
    return version;
}

async function updateProfileAvatar(uid, avatar) {
    await cloud.user.profile.avatar.write(uid, avatar);
}

async function prepareAvatarBlob(uri) {
    let context = null;
    let source = null;
    let rendered = null;
    let savedUri = '';

    try {
        source = await ImageManipulator.manipulate(uri).renderAsync();
        const side = Math.max(1, Math.min(source.width || 1, source.height || 1));
        const originX = Math.max(0, Math.floor(((source.width || side) - side) / 2));
        const originY = Math.max(0, Math.floor(((source.height || side) - side) / 2));
        context = ImageManipulator.manipulate(uri).crop({ originX, originY, width: side, height: side }).resize({ width: 128, height: 128 });
        rendered = await context.renderAsync();
        const saved = await rendered.saveAsync({
            compress: 0.85,
            format: SaveFormat.WEBP,
        });
        savedUri = saved?.uri || '';
        const response = await fetch(savedUri);
        return response.blob();
    } finally {
        await FileSystem.deleteAsync(savedUri, { idempotent: true }).catch(() => {});
        rendered?.release?.();
        source?.release?.();
        context?.release?.();
    }
}

export async function uploadAvatar({ uid, uri }) {
    if (!uid) {
        throw new Error('uid is required');
    }

    const blob = await prepareAvatarBlob(uri);
    const result = await cloud.user.profile.avatar.upload(uid, blob, { contentType: 'image/webp' });
    await updateProfileAvatar(uid, readAvatarGeneration(result?.generation));
    return result?.url || null;
}

export async function skipAvatar({ uid }) {
    if (!uid) {
        throw new Error('uid is required');
    }

    await updateProfileAvatar(uid, null);
}

export async function deleteAvatar({ uid }) {
    if (!uid) {
        throw new Error('uid is required');
    }

    try {
        await cloud.user.profile.avatar.delete(uid);
    } catch (error) {
        if (error?.code !== 'storage/object-not-found') {
            throw error;
        }
    }
    await updateProfileAvatar(uid, null);
}
