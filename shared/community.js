import { links } from './links.js';

export const COMMUNITY_RULES_VERSION = '2026-05-11.1';
export const COMMUNITY_RULES_DATE = '2026-05-11';
export const COMMUNITY_RULES_EFFECTIVE = 'May 11, 2026';

export function hasCurrentCommunityRules(user) {
    return user?.communityRulesVersion === COMMUNITY_RULES_VERSION && !!user?.communityRulesAcceptedAt;
}

export const COMMUNITY_SECTIONS = [
    {
        title: 'Use veyl directly and lawfully',
        body: [
            'veyl is for direct Bitcoin payments and private communication between real users. You are responsible for what you say, send, request, upload, and pay for through the service.',
            'Use veyl only in ways that comply with applicable law and these rules.',
        ],
    },
    {
        title: 'Your funds, keys, and counterparties',
        body: [
            'veyl is not a bank, custodian, exchange, broker, escrow service, payment processor, financial adviser, legal adviser, tax adviser, or recovery service.',
            'You control your device, passkey access, vault password, encrypted vault, private keys, wallet actions, addresses, transaction details, and counterparties. We cannot cancel, reverse, modify, or recover completed blockchain transfers.',
        ],
    },
    {
        title: 'What is not allowed',
        body: [
            'Do not use veyl for unlawful conduct, fraud, scams, impersonation, harassment, threats, extortion, stalking, spam, doxxing, malware, phishing, infringement, or other abusive or harmful conduct.',
            'Do not use veyl to store, transmit, buy, sell, promote, request, advertise, or facilitate illegal goods, illegal services, stolen property, prohibited financial activity, sanctions evasion, money laundering, exploitation, trafficking, terrorism, child sexual abuse or exploitation, or non-consensual sexual content.',
        ],
    },
    {
        title: 'Your responsibility and our liability',
        body: [
            'You are solely responsible for your content, files, messages, requests, uploads, wallet actions, addresses, identifiers, counterparties, device security, legal compliance, sanctions compliance, taxes, financial reporting, and digital asset restrictions that apply to you.',
            'To the maximum extent permitted by law, Glyphteck Corp is not liable for loss of funds, loss of keys, loss of passwords, loss of access, user error, third-party failures, blockchain failures, market loss, malware or device compromise outside our direct control, or indirect or consequential damages arising from use of veyl.',
        ],
    },
    {
        title: 'Safety and enforcement',
        body: [
            'We may warn, restrict, suspend, or permanently disable chat, uploads, usernames, peer discovery, or full account access when abuse, unlawful use, or repeat credible reports indicate elevated risk.',
            'Repeated abuse reports may result in permanent loss of chat features even if wallet access remains separate.',
        ],
    },
    {
        title: 'Reporting and support',
        body: [
            `If someone is abusing veyl, contact us at ${links.contact.replace('mailto:', '')} and include the username, profile details, screenshots, or any evidence you choose to provide from your own device.`,
            'Because veyl uses end-to-end encryption, we may rely on reports, account-level signals, and evidence you submit when reviewing abuse.',
        ],
    },
];
