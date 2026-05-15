import admin from 'firebase-admin';

const projectId = 'glyphteck';
const storageBucket = 'glyphteck.firebasestorage.app';

function readServiceAccount() {
    try {
        return process.env.GOOGLE_SERVICE_ACCOUNT ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT) : null;
    } catch {
        return null;
    }
}

function resolveCredential() {
    const serviceAccount = readServiceAccount();
    if (serviceAccount) {
        return admin.credential.cert(serviceAccount);
    }

    process.env.GOOGLE_CLOUD_QUOTA_PROJECT ||= projectId;
    return admin.credential.applicationDefault();
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: resolveCredential(),
        projectId,
        storageBucket,
    });
}

export default admin;

export async function verifySession(cookie) {
    try {
        const decoded = await admin.auth().verifySessionCookie(cookie, true);
        return decoded.uid;
    } catch {
        return null;
    }
}
