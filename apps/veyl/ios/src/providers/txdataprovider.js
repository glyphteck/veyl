import { createTxDataProvider } from '@glyphteck/shared/providers/txdataprovider';
import { useWallet } from '@/providers/walletprovider';
import { useUser } from '@/providers/userprovider';

const { TxDataProvider, useTxData } = createTxDataProvider({ useWallet, useUser });

export { TxDataProvider, useTxData };
