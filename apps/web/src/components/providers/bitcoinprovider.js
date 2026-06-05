'use client';

import { createBitcoinProvider } from '@veyl/shared/providers/bitcoinprovider';
import { cloud } from '@/lib/cloud';

const { BitcoinProvider, useBitcoin } = createBitcoinProvider({ cloud });

export { BitcoinProvider, useBitcoin };
