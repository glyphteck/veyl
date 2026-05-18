import Constants from 'expo-constants';
import walletLogo from '@glyphteck/shared/logos/wallet.png';
import walletDevLogo from '@glyphteck/shared/logos/walletdev.png';

const variantAliases = {
    production: 'prod',
};

const rawVariant = String(Constants?.expoConfig?.extra?.variant || 'dev').trim().toLowerCase();
const variant = variantAliases[rawVariant] || rawVariant;

export const walletLogoSource = variant === 'prod' ? walletLogo : walletDevLogo;
