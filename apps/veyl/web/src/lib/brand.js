import walletLogo from '@veyl/shared/logos/wallet.png';
import walletDevLogo from '@veyl/shared/logos/walletdev.png';
import walletTestLogo from '@veyl/shared/logos/wallettest.png';
import { resolveVeylVariant } from '@veyl/shared/variant';

const variant = resolveVeylVariant({
    NEXT_PUBLIC_VEYL_VARIANT: process.env.NEXT_PUBLIC_VEYL_VARIANT,
});
const logos = {
    dev: walletDevLogo,
    test: walletTestLogo,
    prod: walletLogo,
};
const logo = logos[variant] || walletDevLogo;

export const walletLogoSrc = typeof logo === 'string' ? logo : logo.src;
