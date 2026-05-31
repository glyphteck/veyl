import { links } from './links.js';
import { lowerText } from './utils/text.js';

export const LEGAL_EFFECTIVE_DATE = 'April 25, 2026';
export const COMPANY_NAME = 'Glyphteck Corp';
export const PRODUCT_NAME = 'veyl';
export const SUPPORT_EMAIL = links.contact.replace('mailto:', '');
export const LEGAL_SECTION_ORDER = ['privacy', 'terms', 'support'];

export const LEGAL_LINKS = [
    { kind: 'email', label: SUPPORT_EMAIL, url: `mailto:${SUPPORT_EMAIL}` },
    { kind: 'site', label: 'glyphteck.com', url: links.root },
];

export const LEGAL_SECTIONS = {
    privacy: {
        key: 'privacy',
        title: 'privacy policy',
        intro:
            'veyl is designed to minimize what Glyphteck Corp can access. The product combines passkey authentication, a locally unlocked encrypted vault, a non-custodial wallet, and end-to-end encrypted chat.',
        sections: [
            {
                title: 'Scope',
                body: [
                    'This Privacy Policy describes how Glyphteck Corp handles information in connection with veyl, including the iOS app, related web properties, and supporting infrastructure.',
                    'It applies to service data that Glyphteck Corp processes to operate veyl. It does not change the public nature of blockchain data or the policies of third-party providers and platforms that veyl depends on.',
                ],
            },
            {
                title: 'Core design principle',
                body: [
                    'Glyphteck Corp does not know your vault password, does not control your private keys, does not custody your funds, and does not normally possess plaintext end-to-end encrypted chat messages.',
                    'Glyphteck Corp does not have a technical recovery path for lost wallet secrets that only exist on your device. If you lose device-controlled secrets, support may be unable to recover them.',
                ],
            },
            {
                title: 'Information Glyphteck Corp processes',
                body: [
                    'Glyphteck Corp may process account identifiers, passkey-related credential records, username, avatar, wallet public key, chat public key, presence state, user settings, push tokens, and service identifiers needed for notifications or sync.',
                    'Glyphteck Corp may store encrypted seed blobs, encrypted chat payloads, encrypted attachment payloads, and encrypted or packed message metadata needed for delivery and sync. These records may be stored on service infrastructure, but that does not mean Glyphteck Corp can read them in plaintext.',
                    'Depending on which features you choose, veyl may request camera access, photo library access, notification permissions, or local biometric unlock features. Apple and your device operating system handle passkeys and biometric templates; Glyphteck Corp does not receive your raw biometric template.',
                ],
            },
            {
                title: 'Public and counterparty-visible information',
                body: [
                    'Your username, avatar, wallet public key, chat public key, and online or active state may be visible to other authenticated users or counterparties.',
                    'This public or counterparty-visible information is part of how veyl resolves users, routes payments, and opens chats.',
                ],
            },
            {
                title: 'Blockchain and network data',
                body: [
                    'When you use wallet functionality, veyl necessarily interacts with Bitcoin-related services and public blockchain data.',
                    'On-chain information is public by nature, may be permanently visible to others, and cannot be deleted or made private by Glyphteck Corp after broadcast.',
                ],
            },
            {
                title: 'Information Glyphteck Corp does not normally have',
                body: [
                    'During normal operation, Glyphteck Corp does not have your vault password, decrypted seed, wallet private keys, chat private keys, or plaintext end-to-end encrypted message content.',
                    'Glyphteck Corp cannot reverse completed blockchain transactions, recover lost private keys, recover lost passwords that only exist on your device, or reconstruct secrets that veyl intentionally never uploads in recoverable form.',
                ],
            },
            {
                title: 'How information is used',
                body: [
                    'Glyphteck Corp uses service data to authenticate users, route and deliver encrypted messages, route push notifications, publish and resolve public keys, sync settings and profile state, operate non-custodial wallet features, prevent abuse, investigate bugs and security issues, maintain uptime, and comply with applicable law, platform rules, and legal process.',
                    'Glyphteck Corp may use account-level, network-level, and report-based signals to restrict or disable abusive users and abusive features.',
                ],
            },
            {
                title: 'End-to-end encryption and reports',
                body: [
                    'Because veyl is designed around end-to-end encrypted private chat content, Glyphteck Corp may be unable to review private message content unless a user chooses to provide evidence from their own device or a user-controlled report flow shares such evidence.',
                    'Glyphteck Corp may still act on account-level abuse signals, repeated reports, metadata it lawfully possesses, public profile information, spam patterns, upload behavior, and other non-content indicators.',
                ],
            },
            {
                title: 'Sharing information',
                body: [
                    'Glyphteck Corp may share information with infrastructure providers and processors needed to operate the service, with blockchain, wallet, storage, authentication, and notification providers involved in product operation, when required by law or legal process, to protect users or third parties from fraud, abuse, or security harm, or in connection with a merger, financing, acquisition, or transfer of assets.',
                    'Glyphteck Corp does not sell user private message content or wallet secrets because veyl is not built to have that content or those secrets in plaintext during normal operation.',
                ],
            },
            {
                title: 'Data sales and advertising',
                body: [
                    'veyl is not built as an advertising product. Glyphteck Corp will not sell your personal data and does not disclose personal data for third-party advertising, behavioral ad targeting, or data brokerage.',
                    'Glyphteck Corp discloses limited service data only when needed to operate veyl, follow the law, protect users or the service, or act on your request.',
                ],
            },
            {
                title: 'Safety, abuse, and unlawful use',
                body: [
                    'Glyphteck Corp does not support or condone illegal transactions, fraud, scams, harassment, threats, money laundering, sanctions evasion, child sexual abuse material or exploitation, non-consensual sexual content, trafficking, violent extremist activity, malware distribution, spam, platform abuse, or unlawful goods or services.',
                    'Glyphteck Corp may investigate abuse reports and may suspend, limit, disable, or terminate accounts or features when it reasonably believes a user has violated law, platform rules, or these Terms.',
                ],
            },
            {
                title: 'Retention and deletion',
                body: [
                    'Glyphteck Corp retains data only as long as reasonably necessary for operating the service, maintaining security and abuse defenses, handling disputes and investigations, meeting legal obligations, and documenting enforcement actions.',
                    'When you delete your account through the product, veyl is intended to remove service-side records controlled by Glyphteck Corp, including account records, profile records, encrypted seed records, usernames, passkey records, push records, chats, and chat media stored by the service, subject to technical and legal limitations.',
                    'Glyphteck Corp may keep limited residual records where reasonably necessary for security, abuse prevention, legal compliance, dispute resolution, or auditability.',
                ],
            },
            {
                title: 'Your choices',
                body: [
                    'You may manage app permissions on your device, disable notifications or camera and photo access from your device settings, delete your account in-app, stop using the service at any time, control what public profile information you publish, and contact Glyphteck Corp regarding support, privacy, or account deletion questions.',
                    'Because blockchains are public and immutable, deleting your veyl account does not erase historical on-chain data already published to a blockchain network.',
                ],
            },
            {
                title: 'Security, children, international processing, and changes',
                body: [
                    'Glyphteck Corp uses technical and organizational measures intended to protect service data, but no system can be guaranteed secure or available at all times. You remain responsible for device security, password security, passkey security, recovery material, and address verification before sending funds.',
                    'veyl may not be used to create, share, request, or facilitate content or transactions involving child exploitation or abuse of any kind. If Glyphteck Corp becomes aware of such activity, it may take immediate enforcement action and may preserve or disclose limited information as required by law.',
                    'Service infrastructure, processors, and counterparties may operate in multiple jurisdictions. Glyphteck Corp may update this Privacy Policy from time to time, and continued use after changes become effective constitutes acceptance of the updated policy to the extent permitted by law.',
                ],
            },
        ],
        links: LEGAL_LINKS,
    },
    terms: {
        key: 'terms',
        title: 'terms of service',
        intro:
            'veyl is software for direct Bitcoin-related activity and encrypted communication. It is not a bank, custodian, exchange, broker, escrow provider, financial adviser, tax adviser, legal adviser, or recovery service.',
        sections: [
            {
                title: 'Acceptance and nature of the service',
                body: [
                    'By using veyl, you agree to be bound by these Terms of Service. If you do not agree, do not use the service.',
                    'veyl is intended to be a non-custodial software interface for direct Bitcoin-related activity and encrypted communication.',
                ],
            },
            {
                title: 'Non-custodial wallet terms',
                body: [
                    'You acknowledge that Glyphteck Corp does not custody your funds or private keys, does not guarantee transaction completion, pricing, fees, speed, or counterparties, and cannot reverse, modify, or recover completed transactions.',
                    'Blockchain transactions are irreversible. Loss of keys, passwords, or device-controlled recovery material may result in permanent loss.',
                ],
            },
            {
                title: 'End-to-end encryption terms',
                body: [
                    'Private chat content is intended to be end-to-end encrypted. Glyphteck Corp may be unable to decrypt or recover content that only exists in encrypted form.',
                    'Glyphteck Corp may be unable to restore lost chats, passwords, or secrets that were never available to Glyphteck Corp in plaintext.',
                ],
            },
            {
                title: 'User responsibilities',
                body: [
                    'You are solely responsible for all content, files, messages, requests, wallet actions, and counterparties associated with your use of veyl.',
                    'You are responsible for verifying payment addresses, transaction amounts, and other transfer details before confirming, complying with laws, regulations, sanctions regimes, tax rules, and reporting duties that apply to you, and safeguarding your device, passkeys, passwords, and recovery material.',
                ],
            },
            {
                title: 'Prohibited conduct',
                body: [
                    'You may not use veyl to violate law, facilitate illegal transactions or illegal goods, engage in fraud, scams, impersonation, deception, harassment, threats, extortion, stalking, abuse, malware, phishing, spam, exploitation of minors, exploitative sexual content, money laundering, sanctions evasion, infringement of others rights, or interference with the security, integrity, or availability of the service.',
                    'Glyphteck Corp does not support or condone illegal or abusive use of the product in any form.',
                ],
            },
            {
                title: 'Enforcement',
                body: [
                    'Glyphteck Corp may investigate misuse and may issue warnings, restrict features, suspend chat, restrict uploads, remove usernames, suspend accounts, terminate accounts, or refer matters to legal process where required by law.',
                    'Repeated credible abuse reports, unlawful activity, or serious policy violations may result in permanent loss of chat features or permanent loss of access to the service.',
                ],
            },
            {
                title: 'Third-party services and advice',
                body: [
                    'veyl depends on third-party services and networks, including Apple, Firebase, Spark, storage providers, notification providers, Bitcoin infrastructure, and public blockchain networks. Glyphteck Corp does not control those services and does not warrant their performance, security, legality, or availability.',
                    'Glyphteck Corp does not provide financial advice, legal advice, investment advice, accounting advice, or tax advice. You are solely responsible for obtaining advice appropriate to your circumstances.',
                ],
            },
            {
                title: 'Disclaimers',
                body: [
                    'The service is provided as is and as available without warranties of any kind, whether express, implied, or statutory, including warranties of merchantability, fitness for a particular purpose, title, non-infringement, security, accuracy, or uninterrupted availability.',
                    'Glyphteck Corp does not warrant that the service will always be available, that chats, uploads, or wallet actions will always succeed, that counterparties are legitimate, that blockchains or third-party services will function correctly, or that any data or funds can be recovered after loss.',
                ],
            },
            {
                title: 'Limitation of liability',
                body: [
                    'To the maximum extent permitted by law, Glyphteck Corp shall not be liable for indirect, incidental, consequential, special, exemplary, or punitive damages, including loss of profits, data, access, or digital assets.',
                    'To the maximum extent permitted by law, Glyphteck Corp shall not be liable for loss of funds, loss of keys, loss of passwords, loss of access, blockchain failures, third-party service failures, user mistakes, market losses, or malware or device compromise outside Glyphteck Corp direct control.',
                    'If liability is imposed notwithstanding the above, Glyphteck Corp total liability shall be limited to the greater of $100 USD or the amount you paid directly to Glyphteck Corp for the service, if any.',
                ],
            },
            {
                title: 'Indemnification',
                body: [
                    'You agree to indemnify and hold harmless Glyphteck Corp, its affiliates, and its personnel from claims, losses, damages, liabilities, and expenses arising from your use of the service, your transactions, your content, your unlawful conduct, or your violation of these Terms.',
                ],
            },
            {
                title: 'Governing law and dispute resolution',
                body: [
                    'These Terms are governed by the laws of the State of Delaware, United States, without regard to conflict-of-law principles.',
                    'Any dispute arising out of or relating to the service or these Terms shall be resolved by binding arbitration under the American Arbitration Association Commercial Arbitration Rules, except where prohibited by law. You waive any right to participate in a class action or class-wide arbitration to the maximum extent permitted by law.',
                ],
            },
            {
                title: 'Severability, entire agreement, and updates',
                body: [
                    'If any provision of this document is held invalid or unenforceable, the remaining provisions remain in effect.',
                    'This document constitutes the entire agreement between you and Glyphteck Corp regarding the service, except where additional product-specific terms expressly apply.',
                    'Glyphteck Corp may update these Terms from time to time. Continued use of the service after an update becomes effective constitutes acceptance of the updated Terms to the extent permitted by law.',
                ],
            },
        ],
        links: LEGAL_LINKS,
    },
    support: {
        key: 'support',
        title: 'support',
        intro:
            'veyl support is limited by the product architecture. Glyphteck Corp can help with service issues, account records, and general product questions, but cannot recover secrets that only exist on your device.',
        sections: [
            {
                title: 'What support can help with',
                body: [
                    'Support can help with general product questions, account deletion requests, app behavior, settings, passkey issues, service-side availability issues, and policy, safety, abuse, or legal concerns relating to usernames, profiles, uploads, or use of the service.',
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
                    'You can block accounts in the app. Blocked accounts are filtered from relevant surfaces and cannot continue normal chat contact with you.',
                ],
            },
            {
                title: 'How to reach veyl',
                body: [
                    'Use the official Glyphteck channels below for product, policy, and support information.',
                    'If you are reporting a legal, safety, or abuse issue, include enough detail for Glyphteck Corp to identify the relevant account, username, profile, or message.',
                ],
            },
        ],
        links: LEGAL_LINKS,
    },
};

export const LEGAL_NOTICES = [
    {
        title: 'Lucide icons',
        body: [
            'This product includes icons from the Lucide project.',
            'ISC License. Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). Copyright (c) 2022-present Lucide Contributors.',
            'Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the copyright notice and permission notice appear in all copies.',
            'The software is provided as is and the author disclaims all warranties with regard to this software including all implied warranties of merchantability and fitness.',
        ],
    },
];

export function getLegalSection(value) {
    const key = lowerText(value);
    return LEGAL_SECTIONS[key] || LEGAL_SECTIONS.privacy;
}
