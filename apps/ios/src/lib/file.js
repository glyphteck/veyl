import * as FileSystem from 'expo-file-system/legacy';
import { cleanText } from '@veyl/shared/utils/text';

const FILE_URI_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function fileUri(value, fallback = '') {
    const uri = cleanText(value);
    if (!uri) {
        return fallback;
    }
    return FILE_URI_SCHEME.test(uri) ? uri : `file://${uri}`;
}

export async function ensureDirectory(path, { quiet = false } = {}) {
    if (!path) {
        return false;
    }
    await FileSystem.makeDirectoryAsync(path, { intermediates: true }).catch((error) => {
        if (!quiet && !/already exists/i.test(String(error?.message || error))) {
            throw error;
        }
    });
    return true;
}
