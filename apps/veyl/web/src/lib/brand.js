import walletLogo from '@glyphteck/shared/logos/wallet.png';
import walletDevLogo from '@glyphteck/shared/logos/walletdev.png';
import { isMainnet, resolveNetwork } from '@glyphteck/shared/network';

const network = resolveNetwork({ NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK });
const logo = isMainnet(network) ? walletLogo : walletDevLogo;

export const walletLogoSrc = typeof logo === 'string' ? logo : logo.src;
