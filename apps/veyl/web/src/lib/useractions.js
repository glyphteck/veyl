'use client';

import { signOut } from 'firebase/auth';
import { auth, getStorage } from '@/lib/firebase/firebaseclient';
import { dropAvatar, putAvatar } from '@glyphteck/shared/files';

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
        const uid = auth.currentUser?.uid;
        if (!uid) throw new Error('User not authenticated');
        const storage = getStorage();
        await putAvatar(storage, uid, blob, 'image/webp');
        return true;
    } catch (error) {
        console.error('Error uploading avatar:', error);
        return false;
    }
}

export async function deleteAvatar() {
    try {
        const uid = auth.currentUser?.uid;
        if (!uid) throw new Error('User not authenticated');
        const storage = getStorage();
        await dropAvatar(storage, uid);
        return true;
    } catch (error) {
        console.error('Error deleting avatar:', error);
        return false;
    }
}

export async function logout() {
    await Promise.allSettled([fetch('/api/session', { method: 'DELETE' }), signOut(auth)]);
    if (typeof window !== 'undefined') {
        window.location.replace('/login');
    }
}
