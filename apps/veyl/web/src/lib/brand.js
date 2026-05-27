import walletLogo from '@glyphteck/shared/logos/wallet.png';
import walletDevLogo from '@glyphteck/shared/logos/walletdev.png';
import walletTestLogo from '@glyphteck/shared/logos/wallettest.png';
import { resolveVeylVariant } from '@glyphteck/shared/variant';

const variant = resolveVeylVariant({
    NEXT_PUBLIC_VEYL_VARIANT: process.env.NEXT_PUBLIC_VEYL_VARIANT,
    NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK,
});
const logos = {
    dev: walletDevLogo,
    test: walletTestLogo,
    prod: walletLogo,
};
const logo = logos[variant] || walletDevLogo;

export const walletLogoSrc = typeof logo === 'string' ? logo : logo.src;
