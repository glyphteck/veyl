'use client';

import { createBitcoinProvider } from '@veyl/shared/providers/bitcoinprovider';
import { db } from '@/lib/firebase/firebaseclient';

const { BitcoinProvider, useBitcoin } = createBitcoinProvider({ db });

export { BitcoinProvider, useBitcoin };

