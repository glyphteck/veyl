const appPackage = require('./package.json');
const { appLinkDomains, PASSKEY_DOMAIN } = require('./links.config.js');
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim() || process.env.EXPO_PROJECT_ID?.trim() || 'bec0c61a-adc9-4edd-ba25-b6a6d441fc67';
const associatedDomainsMode = process.env.VEYL_ASSOCIATED_DOMAINS_MODE?.trim().toLowerCase();
const associatedDomainsSuffix = associatedDomainsMode === 'developer' ? '?mode=developer' : '';
const associatedDomains = [`webcredentials:${PASSKEY_DOMAIN}${associatedDomainsSuffix}`, ...appLinkDomains.map((domain) => `applinks:${domain}${associatedDomainsSuffix}`)];
const easBuildProfile = process.env.EAS_BUILD_PROFILE?.trim().toLowerCase() || '';
const rawVariant = process.env.VEYL_IOS_VARIANT?.trim().toLowerCase() || (easBuildProfile === 'production' || easBuildProfile === 'prod' ? 'prod' : easBuildProfile) || 'dev';
const variantAliases = {
    development: 'dev',
    production: 'prod',
};
const variants = {
    dev: {
        name: 'dev.veyl',
        scheme: 'dev.veyl',
        bundleIdentifier: 'com.glyphteck.veyl.dev',
        icon: '../../../shared/logos/dev.icon',
        logo: '../../../shared/logos/walletdev.png',
        aps: 'development',
    },
    test: {
        name: 'test.veyl',
        scheme: 'test.veyl',
        bundleIdentifier: 'com.glyphteck.veyl.test',
        icon: '../../../shared/logos/test.icon',
        logo: '../../../shared/logos/wallettest.png',
        aps: 'production',
    },
    prod: {
        name: 'veyl',
        scheme: 'veyl',
        bundleIdentifier: 'com.glyphteck.veyl',
        icon: '../../../shared/logos/veyl.icon',
        logo: '../../../shared/logos/wallet.png',
        aps: 'production',
    },
};
const requestedVariant = variantAliases[rawVariant] || rawVariant;
const variant = variants[requestedVariant] ? requestedVariant : 'dev';
const appVariant = variants[variant];
const appleTeamId = 'HHTM355M49';
const isLocalIosBuild = process.env.VEYL_LOCAL_IOS_BUILD === '1';
const splashBackground = '#000000';

module.exports = {
    expo: {
        name: appVariant.name,
        slug: 'veyl',
        scheme: appVariant.scheme,
        version: appPackage.version,
        icon: appVariant.logo,
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
            ...(!isLocalIosBuild ? { appleTeamId } : {}),
            icon: appVariant.icon,
            supportsTablet: true,
            bundleIdentifier: appVariant.bundleIdentifier,
            entitlements: {
                'aps-environment': appVariant.aps,
            },
            associatedDomains,
            infoPlist: {
                NSPhotoLibraryUsageDescription: 'Allow veyl to access your photos to set your avatar.',
                NSPhotoLibraryAddUsageDescription: 'Allow veyl to save photos and videos you take and media from chats.',
                NSCameraUsageDescription: 'Allow veyl to access your camera to scan QR codes, take photos and videos, and set your avatar.',
                NSFaceIDUsageDescription: 'Allow veyl to use Face ID to unlock your vault.',
                UIWhitePointAdaptivityStyle: 'UIWhitePointAdaptivityStylePhoto',
            },
        },
        plugins: [
            'expo-router',
            'expo-notifications',
            'expo-asset',
            'expo-audio',
            'expo-font',
            'expo-image',
            'expo-secure-store',
            'expo-video',
            [
                'expo-splash-screen',
                {
                    ios: {
                        image: appVariant.logo,
                        imageWidth: 200,
                        resizeMode: 'contain',
                        backgroundColor: splashBackground,
                        dark: {
                            image: appVariant.logo,
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
                    savePhotosPermission: 'Allow veyl to save photos and videos you take and media from chats.',
                    granularPermissions: ['photo'],
                },
            ],
            [
                'expo-build-properties',
                {
                    ios: {
                        deploymentTarget: '26.5',
                    },
                },
            ],
            [
                './plugins/with-ios-pod-deployment-target',
                {
                    deploymentTarget: '26.5',
                },
            ],
            './plugins/with-ios-linker-unwind-flags',
        ],
    },
};
