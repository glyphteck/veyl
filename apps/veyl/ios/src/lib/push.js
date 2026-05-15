import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

const DID_KEY = 'push.did';
const SYNC_KEY = 'push.sync';
const TOKEN_RE = /^(Expo|Exponent)PushToken\[[^\]]+\]$/;
const inflightSync = new Set();

function makeId() {
    try {
        const bytes = new Uint8Array(16);
        globalThis.crypto?.getRandomValues?.(bytes);
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch {}

    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 18)}`;
}

export async function getDid() {
    let did = null;

    try {
        did = await AsyncStorage.getItem(DID_KEY);
    } catch {}

    if (did) {
        return did;
    }

    did = makeId();

    try {
        await AsyncStorage.setItem(DID_KEY, did);
    } catch {}

    return did;
}

function getProjectId() {
    return Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId ?? null;
}

function getSyncKey(uid, did, token) {
    return uid && did && token ? `${uid}:${did}:ios:${token}` : '';
}

async function getSavedSyncKey() {
    try {
        return (await AsyncStorage.getItem(SYNC_KEY)) || '';
    } catch {
        return '';
    }
}

async function setSavedSyncKey(key) {
    try {
        if (key) {
            await AsyncStorage.setItem(SYNC_KEY, key);
            return;
        }
        await AsyncStorage.removeItem(SYNC_KEY);
    } catch {}
}

async function getPushPermissionStatus() {
    const { status: current } = await Notifications.getPermissionsAsync();
    if (current === 'granted') {
        return current;
    }

    const res = await Notifications.requestPermissionsAsync({
        ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
        },
    });

    return res.status;
}

export async function getPushState(devicePushToken) {
    if (!Device.isDevice) {
        console.debug?.('push registration skipped on simulator');
        return { status: 'unavailable', token: null };
    }

    const status = await getPushPermissionStatus();
    if (status !== 'granted') {
        return { status: 'disabled', token: null };
    }

    const projectId = getProjectId();
    if (!projectId) {
        console.warn('push registration skipped: missing Expo project id');
        return { status: 'unavailable', token: null };
    }

    const token = (
        await Notifications.getExpoPushTokenAsync({
            projectId,
            ...(devicePushToken ? { devicePushToken } : {}),
        })
    ).data;
    return TOKEN_RE.test(token) ? { status: 'ready', token } : { status: 'unavailable', token: null };
}

export async function setPush(token, uid = auth.currentUser?.uid) {
    const did = await getDid();
    const key = getSyncKey(uid, did, token);
    if (!key) {
        return false;
    }

    if (inflightSync.has(key)) {
        return false;
    }

    const savedKey = await getSavedSyncKey();
    if (savedKey === key) {
        return false;
    }

    inflightSync.add(key);
    try {
        await setDoc(doc(db, 'users', uid, 'push', did), {
            did,
            token,
            platform: 'ios',
            enabled: true,
            updatedAt: serverTimestamp(),
        });
        await setSavedSyncKey(key);
        return true;
    } finally {
        inflightSync.delete(key);
    }
}

export async function dropPush() {
    const uid = auth.currentUser?.uid;
    const did = await getDid();
    if (!uid || !did) {
        return false;
    }

    await deleteDoc(doc(db, 'users', uid, 'push', did));
    await setSavedSyncKey('');
    return true;
}
