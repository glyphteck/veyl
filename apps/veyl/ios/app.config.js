const appPackage = require('./package.json');
const { appLinkDomains, PASSKEY_DOMAIN } = require('./links.config.js');
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim() || process.env.EXPO_PROJECT_ID?.trim() || 'bec0c61a-adc9-4edd-ba25-b6a6d441fc67';
const associatedDomains = [`webcredentials:${PASSKEY_DOMAIN}`, ...appLinkDomains.map((domain) => `applinks:${domain}`)];
const variant = process.env.VEYL_IOS_VARIANT?.trim().toLowerCase() || 'dev';
const isLocal = variant === 'local';
const appleTeamId = 'HHTM355M49';
const lightSplashLogo = './assets/wallet.png';
const darkSplashLogo = './assets/wallet.png';
const splashBackground = '#000000';

module.exports = {
    expo: {
        name: isLocal ? 'veyl local' : 'veyl',
        slug: 'veyl',
        scheme: isLocal ? 'veyl-local' : 'veyl',
        version: appPackage.version,
        extra: {
            variant,
            eas: {
                projectId: easProjectId,
            },
        },
        orientation: 'portrait',
        userInterfaceStyle: 'automatic',
        newArchEnabled: true,
        ios: {
            appleTeamId,
            icon: {
                light: './assets/lighticon.png',
                dark: './assets/darkicon.png',
            },
            supportsTablet: true,
            bundleIdentifier: isLocal ? 'com.glyphteck.veyl.local' : 'com.glyphteck.veyl',
            entitlements: {
                'aps-environment': 'development',
            },
            associatedDomains,
            infoPlist: {
                NSPhotoLibraryUsageDescription: 'Allow veyl to access your photos to set your avatar.',
                NSPhotoLibraryAddUsageDescription: 'Allow veyl to save photos you take and images from chats.',
                NSCameraUsageDescription: 'Allow veyl to access your camera to scan QR codes, take photos, and set your avatar.',
                NSFaceIDUsageDescription: 'Allow veyl to use Face ID to unlock your vault.',
            },
        },
        plugins: [
            'expo-router',
            'expo-notifications',
            [
                'expo-splash-screen',
                {
                    ios: {
                        image: lightSplashLogo,
                        imageWidth: 200,
                        resizeMode: 'contain',
                        backgroundColor: splashBackground,
                        dark: {
                            image: darkSplashLogo,
                            backgroundColor: splashBackground,
                        },
                    },
                },
            ],
            [
                'expo-image-picker',
                {
                    photosPermission: 'Allow veyl to access your photos to set your avatar.',
                },
            ],
            [
                'expo-media-library',
                {
                    photosPermission: 'Allow veyl to access your photos when you choose media in veyl.',
                    savePhotosPermission: 'Allow veyl to save photos you take and images from chats.',
                    granularPermissions: ['photo'],
                },
            ],
            [
                'expo-build-properties',
                {
                    ios: {
                        deploymentTarget: '26.4.1',
                    },
                },
            ],
        ],
    },
};
