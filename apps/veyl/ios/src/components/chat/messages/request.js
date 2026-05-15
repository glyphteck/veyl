import { ActivityIndicator, Text, View } from 'react-native';
import { ArrowUpRight } from 'lucide-react-native';
import { useTheme } from '@/providers/themeprovider';
import { useTxData } from '@/providers/txdataprovider';
import { useUser } from '@/providers/userprovider';
import { useWallet } from '@/providers/walletprovider';
import { bubbleTint } from '@/lib/messages';
import { renderMoney } from '@glyphteck/shared/utils';
import GlassIcon from '@/components/glass/glassicon';
import GlassView from '@/components/glass/glassview';
import Menu from '@/components/menu';
import ReactionTray from './reactiontray';

const CARD = { borderRadius: 22, paddingTop: 12, paddingBottom: 6, paddingHorizontal: 16 };
const LABEL = { fontSize: 16, fontWeight: '600' };
const AMOUNT = { fontSize: 38, fontWeight: '900' };
const ROW = { flexDirection: 'row', alignItems: 'center', gap: 22 };
const LABEL_ROW = { flexDirection: 'row', alignItems: 'center', gap: 6 };
function RequestCard({ fromPeer = false, formattedAmount, label, amountColor, isPaying = false, theme }) {
    if (fromPeer) {
        return (
            <GlassView glassEffectStyle="clear" tintColor={bubbleTint(theme, fromPeer)} style={CARD}>
                <View style={LABEL_ROW}>
                    <Text style={[LABEL, { color: theme.muted }]}>{label}</Text>
                    {isPaying ? <ActivityIndicator color={theme.muted} size="small" /> : null}
                </View>
                <Text style={[AMOUNT, { color: amountColor }]}>{formattedAmount}</Text>
            </GlassView>
        );
    }

    return (
        <GlassView glassEffectStyle="clear" tintColor={bubbleTint(theme, fromPeer)} style={[CARD, { alignItems: 'flex-end' }]}>
            <Text style={[LABEL, { color: theme.muted }]}>{label}</Text>
            <Text style={[AMOUNT, { color: amountColor }]}>{formattedAmount}</Text>
        </GlassView>
    );
}

function RequestBubble({ card, menuId, menuItems, onHold, reaction, reactionActive = false, reactionPreviewInset = 0 }) {
    return (
        <Menu id={menuId} items={menuItems} onHold={onHold} previewBottomInset={reactionPreviewInset}>
            <ReactionTray reaction={reaction} active={reactionActive}>
                <RequestCard {...card} />
            </ReactionTray>
        </Menu>
    );
}

export default function RequestMessage({ msg, fromPeer = false, peerDisplayName, onPay, isPaying = false, menuId, menuItems, onHold, reaction, reactionActive = false, reactionPreviewInset = 0 }) {
    const { theme } = useTheme();
    const { settings } = useUser();
    const { bitcoin, balance } = useWallet();
    const { getTxById } = useTxData();
    const msgTx = msg.tx ? getTxById?.(msg.tx) : null;
    const displayAmount = msgTx ? Math.abs(Number(msgTx.amount)) : Number(msg.a);
    const formattedAmount = renderMoney(displayAmount, settings?.moneyFormat, bitcoin?.price);
    const isTransactionPending = msg.tx && (!msgTx || msgTx.pending !== false);
    const label = fromPeer ? (isPaying ? 'sending' : msg.tx ? 'You sent' : `${peerDisplayName} requested`) : msg.tx ? 'You received' : 'You requested';
    const amountColor = !msg.tx ? theme.foreground : fromPeer ? (isTransactionPending ? `${theme.outflow}80` : theme.outflow) : isTransactionPending ? `${theme.inflow}80` : theme.inflow;
    const card = { fromPeer, formattedAmount, label, amountColor, isPaying, theme };

    if (fromPeer) {
        const canAfford = balance != null && Number(msg.a) <= balance;

        return (
            <View style={ROW}>
                <RequestBubble card={card} menuId={menuId} menuItems={menuItems} onHold={onHold} reaction={reaction} reactionActive={reactionActive} reactionPreviewInset={reactionPreviewInset} />
                {!msg.tx && !isPaying ? <GlassIcon accent icon={ArrowUpRight} onPress={onPay} disabled={!canAfford} iconSize={32} /> : null}
            </View>
        );
    }

    return <RequestBubble card={card} menuId={menuId} menuItems={menuItems} onHold={onHold} reaction={reaction} reactionActive={reactionActive} reactionPreviewInset={reactionPreviewInset} />;
}
