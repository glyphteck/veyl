import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { randomBytes, toHex } from '@veyl/shared/crypto/core';
import { normalizeVariant } from '@veyl/shared/variant';
import { cloud } from '@/lib/cloud';

const DID_KEY = 'push.did';
const SYNC_KEY = 'push.sync';
const INFO_KEY = 'push.info';
const SYNC_VERSION = 'v2';
const inflightSync = new Set();
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
    return toHex(randomBytes(16));
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
    const appVariant = normalizeVariant(Constants?.expoConfig?.extra?.variant, 'dev');
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

async function getCurrentNativeToken() {
    try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') {
            return null;
        }
        return getTokenData(await getDeviceToken());
    } catch {
        return null;
    }
}

function getSyncKey(uid, did, token, meta, nativeToken) {
    const deliveryToken = nativeToken || token;
    return uid && did && deliveryToken ? `${SYNC_VERSION}:${uid}:${did}:ios:apns:${meta.apnsTopic}:${meta.apnsEnvironment}:${deliveryToken}` : '';
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

async function getSavedPushInfo() {
    try {
        const raw = await AsyncStorage.getItem(INFO_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

async function setSavedPushInfo(info) {
    try {
        if (info) {
            await AsyncStorage.setItem(INFO_KEY, JSON.stringify(info));
            return;
        }
        await AsyncStorage.removeItem(INFO_KEY);
    } catch {}
}

async function saveSync(key, info = null) {
    await Promise.all([setSavedSyncKey(key), setSavedPushInfo(key ? info : null)]);
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

export async function setPush(token, uid = cloud.auth.user?.uid, meta = getPushMeta(), nativeToken = null) {
    const did = await getDid();
    const key = getSyncKey(uid, did, token, meta, nativeToken);
    if (!key) {
        return false;
    }

    if (inflightSync.has(key)) {
        return false;
    }

    const [savedKey, saved] = await Promise.all([getSavedSyncKey(), getSavedPushInfo()]);
    if (savedKey === key && saved?.uid === uid && saved?.did === did) {
        return false;
    }

    inflightSync.add(key);
    try {
        await cloud.user.push.add({
            did,
            token: token || null,
            nativeToken: nativeToken || null,
            appVariant: meta.appVariant,
            apnsTopic: meta.apnsTopic,
            apnsEnvironment: meta.apnsEnvironment,
        });
        await saveSync(key, { uid, did, token: token || null, nativeToken: nativeToken || null, meta });
        return true;
    } finally {
        inflightSync.delete(key);
    }
}

export async function dropPush({ uid = cloud.auth.user?.uid } = {}) {
    const saved = await getSavedPushInfo();
    const did = saved?.uid === uid && saved?.did ? saved.did : await getDid();
    if (!uid || !did) {
        return false;
    }

    await cloud.user.push.drop({
        did,
        token: saved?.uid === uid ? saved.token || null : null,
        nativeToken: saved?.uid === uid ? saved.nativeToken || null : await getCurrentNativeToken(),
    });
    await saveSync('');
    return true;
}
