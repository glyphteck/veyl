'use client';

import { createTxDataProvider } from '@veyl/shared/providers/txdataprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useUser } from '@/components/providers/userprovider';

const { TxDataProvider, useTxData } = createTxDataProvider({ useWallet, useUser });

export { TxDataProvider, useTxData };
