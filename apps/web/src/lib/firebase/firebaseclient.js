'use client';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getFunctions as getFirebaseFunctions } from 'firebase/functions';
import { getStorage as getFirebaseStorage } from 'firebase/storage';
import { firebaseConfig, firebaseWebAppCheckConfig } from '@veyl/shared/firebaseconfig';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
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
