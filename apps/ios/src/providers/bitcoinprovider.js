import { createBitcoinProvider } from '@veyl/shared/providers/bitcoinprovider';
import { db } from '@/lib/firebase';

const { BitcoinProvider, useBitcoin } = createBitcoinProvider({ db });

export { BitcoinProvider, useBitcoin };

