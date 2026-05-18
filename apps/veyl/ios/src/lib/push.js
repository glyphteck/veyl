import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

const DID_KEY = 'push.did';
const SYNC_KEY = 'push.sync';
const inflightSync = new Set();
const variantAliases = {
    development: 'dev',
    production: 'prod',
};
const pushVariants = {
    dev: {
        appVariant: 'dev',
        apnsTopic: 'com.glyphteck.veyl.dev',
        apnsEnvironment: 'development',
    },
    test: {
        appVariant: 'test',
        apnsTopic: 'com.glyphteck.veyl.test',
        apnsEnvironment: 'production',
    },
    prod: {
        appVariant: 'prod',
        apnsTopic: 'com.glyphteck.veyl',
        apnsEnvironment: 'production',
    },
};

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

function getPushMeta() {
    const rawVariant = String(Constants?.expoConfig?.extra?.variant || 'dev').trim().toLowerCase();
    const appVariant = variantAliases[rawVariant] || rawVariant;
    return pushVariants[appVariant] || pushVariants.dev;
}

function getTokenData(token) {
    return typeof token?.data === 'string' && token.data ? token.data : null;
}

async function getDeviceToken(devicePushToken) {
    if (getTokenData(devicePushToken)) {
        return devicePushToken;
    }

    return Notifications.getDevicePushTokenAsync();
}

function getSyncKey(uid, did, token, meta, nativeToken) {
    const deliveryToken = nativeToken || token;
    return uid && did && deliveryToken ? `${uid}:${did}:ios:apns:${meta.apnsTopic}:${meta.apnsEnvironment}:${deliveryToken}` : '';
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

    let nativeDeviceToken = null;
    try {
        nativeDeviceToken = await getDeviceToken(devicePushToken);
    } catch (error) {
        console.warn('native push token unavailable', error);
    }

    const nativeToken = getTokenData(nativeDeviceToken);
    return nativeToken ? { status: 'ready', token: null, nativeToken, meta: getPushMeta() } : { status: 'unavailable', token: null };
}

export async function setPush(token, uid = auth.currentUser?.uid, meta = getPushMeta(), nativeToken = null) {
    const did = await getDid();
    const key = getSyncKey(uid, did, token, meta, nativeToken);
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
            nativeToken: nativeToken || null,
            platform: 'ios',
            provider: nativeToken ? 'apns' : 'expo',
            appVariant: meta.appVariant,
            apnsTopic: meta.apnsTopic,
            apnsEnvironment: meta.apnsEnvironment,
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
