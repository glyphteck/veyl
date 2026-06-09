import { renderMoney } from '../../money.js';

function requestActor(fromPeer, peerDisplayName) {
    if (!fromPeer) {
        return 'You';
    }
    return peerDisplayName || 'They';
}

function paymentActor(fromPeer, peerDisplayName) {
    if (fromPeer) {
        return 'You';
    }
    return peerDisplayName || 'They';
}

export function getRequestContext(msg, { fromPeer = false, peerDisplayName = '', moneyFormat = 'btc', btcPrice, getTxById } = {}) {
    const tx = msg?.tx ? getTxById?.(msg.tx) : null;
    const displayAmount = tx ? Math.abs(Number(tx.amount)) : Number(msg?.a || 0);
    const amount = renderMoney(Number.isFinite(displayAmount) ? displayAmount : 0, moneyFormat, btcPrice);
    const actor = msg?.tx ? paymentActor(fromPeer, peerDisplayName) : requestActor(fromPeer, peerDisplayName);
    const verb = msg?.tx ? 'sent' : 'requested';
    const label = `${actor} ${verb}`;

    return {
        amount,
        label,
        text: `${label} ${amount}`,
        tx,
    };
}
