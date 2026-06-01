const appPackageInfo = require('./package.json');

const origins = [
    'https://*.googleapis.com',
    'https://firebasestorage.googleapis.com',
    'https://storage.googleapis.com',
    'https://*.firebasestorage.app',
    'https://*.firebaseio.com',
    'https://firestore.googleapis.com',
    'https://*.cloudfunctions.net',
    'https://buildonspark.com',
    'https://api.lightspark.com',
    'https://*.spark.lightspark.com',
    'https://*.spark.flashnet.xyz',
    'https://spark-operator.breez.technology',
    'https://*.sparkinfra.net',
    'https://fastly.jsdelivr.net',
    'wss://*.spark.lightspark.com',
    'wss://*.spark.flashnet.xyz',
];

const CSP_DIRECTIVES = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/${process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_NETWORK === 'REGTEST' ? " 'unsafe-eval'" : ''}`,
    `connect-src 'self' https://www.google.com/recaptcha/ ${origins.join(' ')}`,
    "img-src 'self' data: blob: https://firebasestorage.googleapis.com",
    "media-src 'self' data: blob:",
    "frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
];

const CSP = CSP_DIRECTIVES.join('; ');

module.exports = {
    transpilePackages: ['@buildonspark/spark-sdk', '@veyl/shared'],
    devIndicators: false,
    env: {
        APP_VERSION: appPackageInfo.version,
        APP_NAME: appPackageInfo.appName || appPackageInfo.name,
        BUILD_TIME: new Date().toISOString(),
    },
    turbopack: {
        resolveAlias: {
            'react-native': 'react-native-web',
            'nice-grpc': 'nice-grpc-web',
        },
    },
    async headers() {
        return [
            {
                source: '/.well-known/apple-app-site-association',
                headers: [
                    { key: 'Content-Type', value: 'application/json' },
                    { key: 'Cache-Control', value: 'no-store' },
                ],
            },
            {
                source: '/(.*)',
                headers: [
                    { key: 'Content-Security-Policy', value: CSP },
                    { key: 'X-Frame-Options', value: 'DENY' },
                ],
            },
        ];
    },
};
