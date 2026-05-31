import Constants from 'expo-constants';
import walletLogo from '@veyl/shared/logos/wallet.png';
import walletDevLogo from '@veyl/shared/logos/walletdev.png';
import walletTestLogo from '@veyl/shared/logos/wallettest.png';
import { normalizeVeylVariant } from '@veyl/shared/variant';

const variant = normalizeVeylVariant(Constants?.expoConfig?.extra?.variant, 'dev');
const logos = {
    dev: walletDevLogo,
    test: walletTestLogo,
    prod: walletLogo,
};

export const walletLogoSource = logos[variant] || walletDevLogo;
