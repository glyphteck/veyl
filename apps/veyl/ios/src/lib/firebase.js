import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import Constants from 'expo-constants';
import { iosFirebaseConfigs } from '@glyphteck/shared/firebaseconfig';

const variantAliases = {
    development: 'dev',
    production: 'prod',
};
const rawVariant = String(Constants?.expoConfig?.extra?.variant || 'dev').trim().toLowerCase();
const variant = variantAliases[rawVariant] || rawVariant;
const firebaseConfig = iosFirebaseConfigs[variant] || iosFirebaseConfigs.dev;
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
let auth;

function tryGetAsyncStorage() {
    try {
        const mod = require('@react-native-async-storage/async-storage');
        return mod?.default ?? mod;
    } catch {
        return null;
    }
}

try {
    const asyncStorage = tryGetAsyncStorage();
    if (asyncStorage) {
        auth = initializeAuth(app, {
            persistence: getReactNativePersistence(asyncStorage),
        });
    } else {
        auth = getAuth(app);
    }
} catch (err) {
    // If auth was already initialized elsewhere (e.g. fast refresh), reuse it.
    auth = getAuth(app);
}
const functions = getFunctions(app);
const storage = getStorage(app);

export { auth, db, functions, storage };
