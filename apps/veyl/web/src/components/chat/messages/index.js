'use client';

import TextMessage from './text';
import ReplyMessage from './reply';
import RequestMessage from './request';
import ImageMessage from './image';
import AudioMessage from './audio';
import VideoMessage from './video';
import AttachmentMessage from './attachment';
import UnsupportedMessage from './unsupported';
import ReactionTray from './reactiontray';

export function ChatMessageType({ msg, fromPeer = false, peerChatPK, peerDisplayName, onPay, isPaying = false, reply, replyFromPeer = false, onReplyPress, reactions = [], reactionUsers, actionSlot }) {
    let body;

    switch (msg?.t) {
        case 'txt':
            body = msg?.r && reply ? (
                <ReplyMessage msg={msg} fromPeer={fromPeer} reply={reply} replyFromPeer={replyFromPeer} peerChatPK={peerChatPK} peerDisplayName={peerDisplayName} onReplyPress={onReplyPress} />
            ) : (
                <TextMessage msg={msg} fromPeer={fromPeer} />
            );
            break;
        case 'req':
            body = <RequestMessage msg={msg} fromPeer={fromPeer} peerDisplayName={peerDisplayName} onPay={onPay} isPaying={isPaying} />;
            break;
        case 'img':
            body = <ImageMessage msg={msg} peerChatPK={peerChatPK} />;
            break;
        case 'mp3':
            body = <AudioMessage msg={msg} peerChatPK={peerChatPK} fromPeer={fromPeer} />;
            break;
        case 'mp4':
            body = <VideoMessage msg={msg} peerChatPK={peerChatPK} fromPeer={fromPeer} />;
            break;
        case 'file':
            body = <AttachmentMessage msg={msg} peerChatPK={peerChatPK} fromPeer={fromPeer} />;
            break;
        default:
            body = <UnsupportedMessage msg={msg} />;
    }

    return (
        <ReactionTray reactions={reactions} users={reactionUsers} fromPeer={fromPeer} actionSlot={actionSlot}>
            {body}
        </ReactionTray>
    );
}
