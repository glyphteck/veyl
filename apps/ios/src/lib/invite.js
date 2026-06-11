import AsyncStorage from '@react-native-async-storage/async-storage';
import { readInviteOrQr } from '@veyl/shared/invite';

const PENDING_INVITE_KEY = 'veyl.pendingInvite';

export async function readPendingInvite() {
    try {
        return readInviteOrQr(JSON.parse(await AsyncStorage.getItem(PENDING_INVITE_KEY)));
    } catch {
        return null;
    }
}

export async function writePendingInvite(value) {
    const invite = readInviteOrQr(value);
    if (!invite) return null;

    try {
        await AsyncStorage.setItem(PENDING_INVITE_KEY, JSON.stringify(invite));
        return invite;
    } catch {
        return null;
    }
}

export async function dropPendingInvite() {
    try {
        await AsyncStorage.removeItem(PENDING_INVITE_KEY);
    } catch {}
}
