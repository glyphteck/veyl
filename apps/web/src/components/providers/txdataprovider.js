'use client';

import { createTxDataProvider } from '@veyl/shared/providers/txdataprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useUser } from '@/components/providers/userprovider';
import { mark } from '@/lib/diagnostics';

const { TxDataProvider, useTxData } = createTxDataProvider({ useWallet, useUser, diag: mark });

export { TxDataProvider, useTxData };
