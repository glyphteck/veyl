'use client';

import { cloud } from '@/lib/cloud';
import { userAvatarCache } from '@/lib/user/avatarcache';

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

function processImageToSquare(imageDataUrl, size = 128) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();

        img.onload = () => {
            const minDimension = Math.min(img.width, img.height);
            const offsetX = (img.width - minDimension) / 2;
            const offsetY = (img.height - minDimension) / 2;
            canvas.width = size;
            canvas.height = size;
            ctx.drawImage(img, offsetX, offsetY, minDimension, minDimension, 0, 0, size, size);
            canvas.toBlob(resolve, 'image/webp', 0.85);
        };
        img.src = imageDataUrl;
    });
}

export async function uploadAvatar(imageData) {
    if (!imageData) return false;

    try {
        const blob = await processImageToSquare(imageData, 128);
        const uid = cloud.auth.user?.uid;
        if (!uid) throw new Error('User not authenticated');
        const result = await cloud.user.profile.avatar.upload(uid, blob, { contentType: 'image/webp' });
        await updateProfileAvatar(uid, readAvatarGeneration(result?.generation));
        return true;
    } catch (error) {
        console.error('Error uploading avatar:', error);
        return false;
    }
}

export async function skipAvatar() {
    try {
        const uid = cloud.auth.user?.uid;
        if (!uid) throw new Error('User not authenticated');
        await updateProfileAvatar(uid, null);
        return true;
    } catch (error) {
        console.error('Error skipping avatar:', error);
        return false;
    }
}

export async function deleteAvatar() {
    const uid = cloud.auth.user?.uid;
    try {
        if (!uid) throw new Error('User not authenticated');
        await cloud.user.profile.avatar.delete(uid);
        await updateProfileAvatar(uid, null);
        return true;
    } catch (error) {
        if (error?.code === 'storage/object-not-found' && uid) {
            try {
                await updateProfileAvatar(uid, null);
                return true;
            } catch (profileError) {
                console.error('Error clearing avatar profile state:', profileError);
            }
        }
        console.error('Error deleting avatar:', error);
        return false;
    }
}

async function saveRememberChoice(uid, remember, account = null) {
    if (!uid || remember == null) {
        return;
    }
    try {
        if (remember) {
            await userAvatarCache.remember?.(uid, account);
        } else {
            await userAvatarCache.forget?.(uid);
        }
    } catch (error) {
        console.warn('failed to update remembered account', error);
    }
}

export async function logout({ remember = null, account = null } = {}) {
    const uid = cloud.auth.user?.uid;
    await saveRememberChoice(uid, remember, account);
    await cloud.auth.logout();
    if (typeof window !== 'undefined') {
        window.location.replace('/');
    }
}

export async function logoutAllDevices() {
    await cloud.auth.logoutDevices();
    await logout({ remember: false });
}
