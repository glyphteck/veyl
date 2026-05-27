import Constants from 'expo-constants';
import walletLogo from '@glyphteck/shared/logos/wallet.png';
import walletDevLogo from '@glyphteck/shared/logos/walletdev.png';
import walletTestLogo from '@glyphteck/shared/logos/wallettest.png';
import { normalizeVeylVariant } from '@glyphteck/shared/variant';

const variant = normalizeVeylVariant(Constants?.expoConfig?.extra?.variant, 'dev');
const logos = {
    dev: walletDevLogo,
    test: walletTestLogo,
    prod: walletLogo,
};

export const walletLogoSource = logos[variant] || walletDevLogo;
