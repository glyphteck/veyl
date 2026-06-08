import * as MediaLibrary from 'expo-media-library';

export async function saveMediaToLibrary(uri) {
    const existing = await MediaLibrary.getPermissionsAsync(false);
    const perm = existing.granted && existing.accessPrivileges === 'all'
        ? existing
        : await MediaLibrary.requestPermissionsAsync(false);

    if (!perm.granted || perm.accessPrivileges !== 'all') {
        throw new Error('Please allow full photo access to save media.');
    }

    await MediaLibrary.Asset.create(uri);
}
