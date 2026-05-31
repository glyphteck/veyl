import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { SymbolView } from 'expo-symbols';

const FACE_ID_SERVICE = 'veyl.faceid';

const storeKey = (uid) => `veyl_vault_password_${uid}`;
const stagedKey = (uid) => `veyl_faceid_staged_${uid}`;

const STORE_OPTS = {
    keychainService: FACE_ID_SERVICE,
    requireAuthentication: true,
    authenticationPrompt: 'Unlock with Face ID',
    keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
};

const READ_OPTS = {
    keychainService: FACE_ID_SERVICE,
    requireAuthentication: true,
    authenticationPrompt: 'Unlock with Face ID',
};

async function setStaged(uid, staged) {
    if (!uid) return;
    if (staged) {
        await AsyncStorage.setItem(stagedKey(uid), '1');
    } else {
        await AsyncStorage.removeItem(stagedKey(uid));
    }
}

export function FaceIdIcon({ size = 24, color = 'currentColor', weight = 'regular', pointerEvents, style }) {
    return <SymbolView name="faceid" size={size} tintColor={color} weight={weight} pointerEvents={pointerEvents} style={style} />;
}

export async function shouldStageFaceIdPassword(uid, enabled) {
    if (!uid) return false;
    if (enabled === false) return false;
    if (!SecureStore.canUseBiometricAuthentication()) return false;
    if (enabled === true) return true;
    return (await AsyncStorage.getItem(stagedKey(uid))) !== '1';
}

export async function stageFaceIdPassword(password, uid) {
    try {
        if (!uid) return false;
        if (!SecureStore.canUseBiometricAuthentication()) return false;
        if (typeof password !== 'string' || password.length === 0) return false;

        await SecureStore.deleteItemAsync(storeKey(uid), { keychainService: FACE_ID_SERVICE }).catch(() => {});
        await SecureStore.setItemAsync(storeKey(uid), password, STORE_OPTS);
        await setStaged(uid, true);
        return true;
    } catch {
        await setStaged(uid, false).catch(() => {});
        return false;
    }
}

export async function getFaceIdPassword(uid) {
    if (!uid) return null;
    if (!SecureStore.canUseBiometricAuthentication()) return null;

    try {
        const password = await SecureStore.getItemAsync(storeKey(uid), READ_OPTS);
        if (!password) {
            await setStaged(uid, false);
            return null;
        }
        return password;
    } catch {
        await setStaged(uid, false).catch(() => {});
        return null;
    }
}

export async function clearFaceIdPassword(uid) {
    if (!uid) return false;

    const results = await Promise.allSettled([
        SecureStore.deleteItemAsync(storeKey(uid), { keychainService: FACE_ID_SERVICE }),
        AsyncStorage.removeItem(stagedKey(uid)),
    ]);

    return results.every((result) => result.status === 'fulfilled');
}
