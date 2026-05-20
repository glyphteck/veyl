import { getApp, getApps, initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import { firebaseConfig } from '@glyphteck/shared/firebaseconfig';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
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
