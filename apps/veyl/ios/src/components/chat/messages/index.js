import TextMessage, { TextBubble } from './text';
import ReplyMessage from './reply';
import RequestMessage from './request';
import ImageMessage from './image';
import AudioMessage from './audio';
import VideoMessage from './video';
import AttachmentMessage from './attachment';
import UnsupportedMessage from './unsupported';

export { TextBubble };

export function ChatMessageType({
    msg,
    fromPeer = false,
    menuId,
    menuItems,
    onRequestHold,
    peerDisplayName,
    onPay,
    isPaying = false,
    peerChatPK,
    reply,
    replyFromPeer = false,
    onReplyPress,
    onLike,
    reactions = [],
    reactionUsers,
    reactionPreviewInset = 0,
}) {
    switch (msg?.t) {
        case 'txt':
            return msg?.r ? (
                <ReplyMessage
                    msg={msg}
                    fromPeer={fromPeer}
                    menuItems={menuItems}
                    menuId={menuId}
                    reply={reply}
                    replyFromPeer={replyFromPeer}
                    peerChatPK={peerChatPK}
                    peerDisplayName={peerDisplayName}
                    onReplyPress={onReplyPress}
                    reactions={reactions}
                    reactionUsers={reactionUsers}
                    reactionPreviewInset={reactionPreviewInset}
                />
            ) : (
                <TextMessage msg={msg} fromPeer={fromPeer} menuItems={menuItems} menuId={menuId} reactions={reactions} reactionUsers={reactionUsers} reactionPreviewInset={reactionPreviewInset} />
            );
        case 'req':
            return <RequestMessage msg={msg} fromPeer={fromPeer} peerDisplayName={peerDisplayName} onPay={onPay} isPaying={isPaying} menuId={menuId} menuItems={menuItems} onHold={onRequestHold} reactions={reactions} reactionUsers={reactionUsers} reactionPreviewInset={reactionPreviewInset} />;
        case 'img':
            return <ImageMessage msg={msg} peerChatPK={peerChatPK} fromPeer={fromPeer} menuItems={menuItems} menuId={menuId} onLike={onLike} reactions={reactions} reactionUsers={reactionUsers} reactionPreviewInset={reactionPreviewInset} />;
        case 'mp3':
            return <AudioMessage msg={msg} peerChatPK={peerChatPK} fromPeer={fromPeer} menuItems={menuItems} menuId={menuId} reactions={reactions} reactionUsers={reactionUsers} reactionPreviewInset={reactionPreviewInset} />;
        case 'mp4':
            return <VideoMessage msg={msg} peerChatPK={peerChatPK} fromPeer={fromPeer} menuItems={menuItems} menuId={menuId} onLike={onLike} reactions={reactions} reactionUsers={reactionUsers} reactionPreviewInset={reactionPreviewInset} />;
        case 'file':
            return <AttachmentMessage msg={msg} peerChatPK={peerChatPK} fromPeer={fromPeer} menuItems={menuItems} menuId={menuId} reactions={reactions} reactionUsers={reactionUsers} reactionPreviewInset={reactionPreviewInset} />;
        default:
            return <UnsupportedMessage msg={msg} fromPeer={fromPeer} menuItems={menuItems} menuId={menuId} reactions={reactions} reactionUsers={reactionUsers} reactionPreviewInset={reactionPreviewInset} />;
    }
}
