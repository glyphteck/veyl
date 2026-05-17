import { links } from '@glyphteck/shared/links';

export const LEGAL_EFFECTIVE_DATE = 'April 6, 2026';
export const COMPANY_NAME = 'Glyphteck Corp.';
export const COMPANY_SITE = links.root;
export const SUPPORT_EMAIL = links.contact.replace('mailto:', '');
const DEFAULT_LINKS = [
    { kind: 'email', label: SUPPORT_EMAIL, url: `mailto:${SUPPORT_EMAIL}` },
    { kind: 'site', label: 'glyphteck.com', url: COMPANY_SITE },
];

export const LEGAL_SECTIONS = {
    privacy: {
        key: 'privacy',
        title: 'privacy',
        intro:
            'veyl is designed to minimize what we can access. The product is built around passkeys, a locally unlocked encrypted vault, a non-custodial wallet, and end-to-end encrypted chat.',
        sections: [
            {
                title: 'Data veyl stores to operate the service',
                body: [
                    'veyl stores limited service data needed to run the app, including your username, avatar, wallet public key, chat public key, settings, push token, passkey credential records, and the encrypted seed blob tied to your account.',
                    'veyl also stores encrypted chat payloads and encrypted chat attachments so they can sync between participants. Those payloads are encrypted before storage.',
                ],
            },
            {
                title: 'Data veyl does not have',
                body: [
                    'veyl does not have your vault password, decrypted seed, private keys, or plaintext end-to-end encrypted chat messages during normal operation.',
                    'veyl cannot recover lost passwords, lost private keys, lost recovery material, or reverse blockchain transfers.',
                ],
            },
            {
                title: 'Public profile boundary',
                body: [
                    'Your username, avatar, wallet public key, chat public key, and presence status may be visible to other authenticated users so the product can resolve users, route payments, and open chats.',
                    'Your vault password, encrypted vault contents, and private keys are not public profile data.',
                ],
            },
            {
                title: 'How veyl uses data',
                body: [
                    'We use service data to authenticate you, route push notifications, sync your settings, deliver encrypted messages, publish public keys, and support wallet and chat features.',
                    'We may use limited operational metadata, abuse reports, and account-level signals to investigate fraud, spam, unlawful use, platform abuse, or Terms violations.',
                ],
            },
            {
                title: 'Third-party services',
                body: [
                    'veyl relies on third-party infrastructure and networks, including Firebase, Apple, Spark, and Bitcoin-related services and networks. Those services may process data needed to provide their part of the stack.',
                    'On-chain activity is public by nature and cannot be made private or deleted by us once broadcast to a blockchain network.',
                ],
            },
            {
                title: 'Safety, enforcement, and reports',
                body: [
                    'veyl does not support or condone unlawful content, unlawful transactions, harassment, abuse, scams, exploitation, or other harmful conduct.',
                    'Glyphteck Corp. may suspend, restrict, or terminate accounts or features, including chat, uploads, user discovery, and usernames, when we reasonably believe the service is being used in violation of law, policy, or these Terms.',
                ],
            },
            {
                title: 'Retention and deletion',
                body: [
                    'You can delete your account from within the app. Account deletion is intended to remove your service-side account records, profile records, encrypted seed record, push records, passkey records, usernames, chats, and chat media controlled by us.',
                    'We may retain limited records where reasonably necessary for security, abuse prevention, dispute handling, legal compliance, or to document enforcement actions.',
                ],
            },
            {
                title: 'Data sales and advertising',
                body: [
                    'veyl is not built as an advertising product. We will never sell your personal data. Selling personal data is against our values.',
                    'We do not disclose personal data for third-party advertising, behavioral ad targeting, or data brokerage. We disclose limited service data only when needed to operate veyl, follow the law, protect users or the service, or act on your request.',
                ],
            },
        ],
        links: DEFAULT_LINKS,
    },
    terms: {
        key: 'terms',
        title: 'terms',
        intro:
            'veyl is software for direct Bitcoin transactions and encrypted communication. It is not a bank, custodian, exchange, broker, escrow service, payment processor, or recovery service.',
        sections: [
            {
                title: 'Non-custodial service',
                body: [
                    'You control your password, encrypted vault, private keys, wallet actions, and interactions with other users. Glyphteck Corp. does not take custody of your funds or private keys.',
                    'Blockchain transfers are irreversible. We cannot cancel, reverse, modify, or recover a completed transfer.',
                ],
            },
            {
                title: 'Your responsibilities',
                body: [
                    'You are responsible for safeguarding your device, passkey access, password, recovery material, and transaction details.',
                    'You are responsible for compliance with the laws and regulations that apply to you, including sanctions, taxes, financial reporting, and restrictions on digital assets or communications.',
                ],
            },
            {
                title: 'Acceptable use',
                body: [
                    'You may not use veyl to engage in unlawful conduct, fraud, scams, harassment, threats, money laundering, sanctions evasion, child sexual abuse or exploitation, non-consensual sexual content, trafficking, terrorism, malware distribution, spam, or any other abusive or harmful behavior.',
                    'You may not use veyl to store, transmit, request, advertise, or facilitate illegal goods, illegal services, stolen property, or prohibited financial activity.',
                ],
            },
            {
                title: 'Content and communications',
                body: [
                    'You are solely responsible for the content, files, requests, addresses, identifiers, and other material you create, send, receive, upload, or reference through the service.',
                    'We do not endorse user content, counterparties, or transactions and may restrict access to features when reports or abuse signals indicate elevated risk.',
                ],
            },
            {
                title: 'Enforcement rights',
                body: [
                    'Glyphteck Corp. may investigate abuse reports and may suspend, limit, or terminate accounts, usernames, chats, uploads, or other features when reasonably necessary to protect users, the service, third parties, or to comply with law or platform rules.',
                    'We may disable chat functionality or other service features for accounts that repeatedly receive credible abuse reports or otherwise violate these Terms.',
                ],
            },
            {
                title: 'No warranty and limited liability',
                body: [
                    'The service is provided as is and as available without warranties of merchantability, fitness, availability, security, or uninterrupted operation.',
                    'To the maximum extent permitted by law, Glyphteck Corp. is not liable for loss of funds, loss of keys, loss of access, user error, third-party failures, blockchain failures, market loss, or indirect or consequential damages arising from use of the service.',
                ],
            },
        ],
        links: DEFAULT_LINKS,
    },
    support: {
        key: 'support',
        title: 'support',
        intro:
            'veyl support is limited by the product architecture. We can help with service issues, account records, and general product questions, but cannot recover secrets that only exist on your device.',
        sections: [
            {
                title: 'What support can help with',
                body: [
                    'General product questions, account deletion requests, app behavior, settings, passkey issues, and service-side availability issues.',
                    'Policy, safety, abuse, or legal concerns relating to usernames, profiles, uploads, or use of the service.',
                ],
            },
            {
                title: 'What support cannot do',
                body: [
                    'Support cannot recover your vault password, decrypted seed, private keys, or permanently lost wallet access.',
                    'Support cannot reverse or cancel blockchain transactions and cannot decrypt your private chats during normal operation.',
                ],
            },
            {
                title: 'Self-service controls',
                body: [
                    'You can manage permissions from Settings > Manage Permissions.',
                    'You can delete your account from Settings > Delete Account.',
                ],
            },
            {
                title: 'How to reach veyl',
                body: [
                    'Use the official Glyphteck channels below for product, policy, and support information.',
                    'If you are reporting a legal, safety, or abuse issue, include enough detail for us to identify the relevant account, username, or profile.',
                ],
            },
        ],
        links: DEFAULT_LINKS,
    },
};

export function getLegalSection(value) {
    const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return LEGAL_SECTIONS[key] || LEGAL_SECTIONS.privacy;
}
