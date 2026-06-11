const appPackageInfo = require('./package.json');

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
                    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'X-Frame-Options', value: 'DENY' },
                ],
            },
        ];
    },
};
