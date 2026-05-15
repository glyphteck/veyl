import admin from 'firebase-admin';

function readFirebaseConfig() {
    try {
        return process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : null;
    } catch {
        return null;
    }
}

function readServiceAccount() {
    try {
        return process.env.GOOGLE_SERVICE_ACCOUNT ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT) : null;
    } catch {
        return null;
    }
}

function initAdmin() {
    const firebaseConfig = readFirebaseConfig();
    const serviceAccount = readServiceAccount();
    const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || firebaseConfig?.projectId || 'glyphteck';
    const storageBucket = firebaseConfig?.storageBucket || 'glyphteck.firebasestorage.app';
    const options = { projectId, storageBucket };

    // Local ADC user creds can fail against Firebase Auth without a quota project.
    process.env.GOOGLE_CLOUD_QUOTA_PROJECT ||= projectId;

    if (serviceAccount) {
        options.credential = admin.credential.cert(serviceAccount);
    }

    admin.initializeApp(options);
}

// Initialize Firebase Admin
if (!admin.apps.length) initAdmin();

export const db = admin.firestore();
export const Timestamp = admin.firestore.Timestamp;
export const FieldValue = admin.firestore.FieldValue;
export const projectId = admin.app().options.projectId || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'glyphteck';

export const OK = { success: true };

// Export admin as default
export default admin;
