'use client';

import { getApp, getApps, initializeApp, setLogLevel as setFirebaseLogLevel } from 'firebase/app';
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getFirestore, setLogLevel as setFirestoreLogLevel } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getFunctions as getFirebaseFunctions } from 'firebase/functions';
import { getStorage as getFirebaseStorage } from 'firebase/storage';
import { firebaseConfig, firebaseWebAppCheckConfig } from '@veyl/shared/firebaseconfig';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const verbose = process.env.NEXT_PUBLIC_VEYL_VERBOSE === '1';

if (verbose) {
    setFirebaseLogLevel('debug');
    setFirestoreLogLevel('debug');
    console.log('[firebase] verbose client logs enabled');
}

let appCheck;

function initializeWebAppCheck() {
    if (typeof window === 'undefined') return null;

    appCheck ||= initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(firebaseWebAppCheckConfig.siteKey),
        isTokenAutoRefreshEnabled: true,
    });

    return appCheck;
}

const webAppCheck = initializeWebAppCheck();
const db = getFirestore(app);
const auth = getAuth(app);
let functions;
let storage;

export async function getAppCheckToken(forceRefresh = false) {
    const instance = initializeWebAppCheck();
    if (!instance) return null;
    return getToken(instance, forceRefresh);
}

export function getFunctions() {
    functions ||= getFirebaseFunctions(app);
    return functions;
}

export function getStorage() {
    storage ||= getFirebaseStorage(app);
    return storage;
}

export { app, auth, db, webAppCheck };
