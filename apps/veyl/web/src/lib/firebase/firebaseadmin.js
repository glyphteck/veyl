import admin from 'firebase-admin';
import { ExternalAccountClient } from 'google-auth-library';
import { getVercelOidcToken } from '@vercel/oidc';

const projectId = 'glyphteck';
const storageBucket = 'glyphteck.firebasestorage.app';

function requiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing ${name}`);
    }
    return value;
}

function hasVercelOidcConfig() {
    return !!(
        process.env.GCP_PROJECT_NUMBER &&
        process.env.GCP_SERVICE_ACCOUNT_EMAIL &&
        process.env.GCP_WORKLOAD_IDENTITY_POOL_ID &&
        process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID
    );
}

function createVercelOidcCredential() {
    const projectNumber = requiredEnv('GCP_PROJECT_NUMBER');
    const serviceAccountEmail = requiredEnv('GCP_SERVICE_ACCOUNT_EMAIL');
    const poolId = requiredEnv('GCP_WORKLOAD_IDENTITY_POOL_ID');
    const providerId = requiredEnv('GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID');
    const authClient = ExternalAccountClient.fromJSON({
        type: 'external_account',
        audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        token_url: 'https://sts.googleapis.com/v1/token',
        service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
        subject_token_supplier: {
            getSubjectToken: getVercelOidcToken,
        },
    });

    if (!authClient) {
        throw new Error('Could not initialize Vercel GCP OIDC client');
    }

    return {
        getAccessToken: async () => {
            const result = await authClient.getAccessToken();
            const accessToken = typeof result === 'string' ? result : result?.token || result?.access_token;
            if (!accessToken) {
                throw new Error('Could not mint GCP access token from Vercel OIDC');
            }

            const expiryDate = authClient.credentials?.expiry_date;
            const expiresIn = expiryDate ? Math.max(0, Math.floor((expiryDate - Date.now()) / 1000)) : 3600;
            return {
                access_token: accessToken,
                expires_in: expiresIn,
            };
        },
    };
}

function resolveCredential() {
    if (hasVercelOidcConfig() && (process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN)) {
        return createVercelOidcCredential();
    }

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
