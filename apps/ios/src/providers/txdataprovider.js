import { createTxDataProvider } from '@veyl/shared/providers/txdataprovider';
import { useWallet } from '@/providers/walletprovider';
import { useUser } from '@/providers/userprovider';
import { mark } from '@/lib/diagnostics';

const { TxDataProvider, useTxData } = createTxDataProvider({ useWallet, useUser, diag: mark });

export { TxDataProvider, useTxData };
