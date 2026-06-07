import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
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

async function prepareAvatarBytes(uri) {
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
        const base64 = await FileSystem.readAsStringAsync(savedUri, {
            encoding: FileSystem.EncodingType.Base64,
        });
        return new Uint8Array(Buffer.from(base64, 'base64'));
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

    const bytes = await prepareAvatarBytes(uri);
    const result = await cloud.user.profile.avatar.upload(uid, bytes, { contentType: 'image/webp' });
    const version = readAvatarGeneration(result?.generation);
    await updateProfileAvatar(uid, version);
    return { url: result?.url || null, version };
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
