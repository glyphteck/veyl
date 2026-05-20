export const webFirebaseConfig = {
    apiKey: 'AIzaSyCivl3bRJ3C6UNj7sfz5OIwEX3Zy7NfKZM',
    authDomain: 'glyphteck.firebaseapp.com',
    projectId: 'glyphteck',
    storageBucket: 'glyphteck.firebasestorage.app',
    messagingSenderId: '289409633674',
    appId: '1:289409633674:web:a71b0411f3ac818fd74c73',
};

const baseIosFirebaseConfig = {
    apiKey: 'AIzaSyCAn24ik_J6iTzQZBfuICSx1Yy5qZwjffg',
    authDomain: 'glyphteck.firebaseapp.com',
    projectId: 'glyphteck',
    storageBucket: 'glyphteck.firebasestorage.app',
    messagingSenderId: '289409633674',
};

export const iosFirebaseConfigs = {
    dev: {
        ...baseIosFirebaseConfig,
        appId: '1:289409633674:ios:721722f11c347a55d74c73',
    },
    test: {
        ...baseIosFirebaseConfig,
        appId: '1:289409633674:ios:1b579ec906834a9fd74c73',
    },
    prod: {
        ...baseIosFirebaseConfig,
        appId: '1:289409633674:ios:7402ae142e675778d74c73',
    },
};
