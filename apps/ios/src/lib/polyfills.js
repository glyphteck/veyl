// iOS-only runtime polyfills for React Native
// Import once at app root before any SDKs load
import 'react-native-get-random-values';
import '@azure/core-asynciterator-polyfill';
import { Buffer } from 'buffer';
import { NativeModules } from 'react-native';

// Setup globals for Firebase, Spark SDK, and crypto libs
global.Buffer = Buffer;

// Some browser-first libs expect `self`.
if (!global.self) {
    global.self = global;
}

// Spark SDK (and some other RN libs) currently read from `NativeModules`.
// In some New Architecture runtimes, the module may be available via TurboModules
// but not present on `NativeModules`. Bridge it if needed.
try {
    if (!NativeModules?.SparkFrostModule) {
        const turboProxy = global.__turboModuleProxy;
        const sparkTurbo = typeof turboProxy === 'function' ? turboProxy('SparkFrostModule') : null;
        if (sparkTurbo) {
            NativeModules.SparkFrostModule = sparkTurbo;
        }
    }
} catch {}
