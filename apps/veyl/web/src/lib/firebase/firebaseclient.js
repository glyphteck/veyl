'use client';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getFunctions as getFirebaseFunctions } from 'firebase/functions';
import { getStorage as getFirebaseStorage } from 'firebase/storage';
import { firebaseConfig } from '@veyl/shared/firebaseconfig';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
let functions;
let storage;

export function getFunctions() {
    functions ||= getFirebaseFunctions(app);
    return functions;
}

export function getStorage() {
    storage ||= getFirebaseStorage(app);
    return storage;
}

export { app, auth, db };
