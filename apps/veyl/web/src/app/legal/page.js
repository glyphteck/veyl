import { links } from '@glyphteck/shared/links';

export const metadata = {
    title: 'veyl Legal',
    description: 'Privacy, terms, safety, and support information for veyl.',
};

const updated = 'April 25, 2026';
const contact = links.contact.replace('mailto:', '');

const privacy = [
    {
        title: 'What veyl stores',
        body: [
            'veyl stores limited service data needed to run the app, including account identifiers, passkey credential records, username, avatar, wallet public key, chat public key, presence state, user settings, push tokens, encrypted seed blobs, encrypted chat payloads, encrypted attachments, and message metadata needed for delivery and sync.',
            'Some profile information, including username, avatar, wallet public key, chat public key, and presence state, may be visible to other authenticated users so veyl can resolve people, route payments, and open chats.',
        ],
    },
    {
        title: 'What veyl does not have',
        body: [
            'Glyphteck Corp does not have your vault password, decrypted seed, wallet private keys, chat private keys, or plaintext end-to-end encrypted chat messages during normal operation.',
            'Glyphteck Corp cannot recover lost passwords, recover lost private keys, reconstruct secrets that were never uploaded, or reverse completed blockchain transactions.',
        ],
    },
    {
        title: 'How data is used',
        body: [
            'Glyphteck Corp uses service data to authenticate users, route encrypted messages, route push notifications, publish and resolve public keys, sync settings and profiles, operate wallet features, prevent abuse, investigate bugs, maintain uptime, and comply with applicable law and platform rules.',
            'veyl may use account-level, network-level, and report-based signals to restrict spam, fraud, unlawful use, harassment, scams, or platform abuse.',
        ],
    },
    {
        title: 'Reports and encrypted content',
        body: [
            'veyl is designed around end-to-end encrypted chat. Glyphteck Corp may be unable to review private message content unless a user chooses to submit reported content or evidence from their own device.',
            'Glyphteck Corp may still act on account-level abuse signals, repeated reports, public profile information, spam patterns, upload behavior, and other non-content indicators available to the service.',
        ],
    },
    {
        title: 'Retention and deletion',
        body: [
            'You can delete your account in the app. Account deletion is intended to remove service-side records controlled by Glyphteck Corp, including account records, profile records, encrypted seed records, usernames, passkey records, push records, chats, and chat media, subject to technical and legal limits.',
            'Blockchain activity is public by nature and cannot be deleted or made private by Glyphteck Corp after it has been broadcast.',
        ],
    },
];

const terms = [
    {
        title: 'Nature of the service',
        body: [
            'veyl is software provided by Glyphteck Corp for direct Bitcoin activity and encrypted communication.',
            'veyl is not a bank, custodian, exchange, broker, escrow provider, financial adviser, tax adviser, legal adviser, or recovery service.',
        ],
    },
    {
        title: 'Non-custodial wallet',
        body: [
            'You control your device, passkey access, vault password, encrypted vault, private keys, wallet actions, transaction details, and counterparties.',
            'Glyphteck Corp does not custody your funds or private keys, does not guarantee transaction completion, pricing, fees, speed, or counterparties, and cannot reverse, modify, or recover completed transactions.',
        ],
    },
    {
        title: 'Your responsibilities',
        body: [
            'You are solely responsible for all content, files, messages, requests, wallet actions, addresses, identifiers, and counterparties associated with your use of veyl.',
            'You are responsible for safeguarding your device, passkeys, passwords, recovery material, and for complying with all laws, sanctions regimes, tax rules, financial reporting duties, and digital asset restrictions that apply to you.',
        ],
    },
    {
        title: 'Acceptable use',
        body: [
            'You may not use veyl to violate law, facilitate illegal transactions or illegal goods, engage in fraud, scams, impersonation, deception, harassment, threats, extortion, stalking, malware, phishing, spam, money laundering, sanctions evasion, exploitation, or infringement of others rights.',
            'You may not interfere with the security, integrity, or availability of the service.',
        ],
    },
    {
        title: 'Enforcement',
        body: [
            'Glyphteck Corp may investigate misuse and may warn, restrict, suspend, or terminate accounts or features, including chat, uploads, usernames, user discovery, or full account access, when needed to protect users, the service, third parties, or to comply with law or platform rules.',
            'Repeated credible abuse reports, unlawful activity, or serious policy violations may result in permanent loss of chat features or permanent loss of service access.',
        ],
    },
    {
        title: 'No warranty and limited liability',
        body: [
            'The service is provided as is and as available without warranties of merchantability, fitness, availability, security, accuracy, or uninterrupted operation.',
            'To the maximum extent permitted by law, Glyphteck Corp is not liable for loss of funds, loss of keys, loss of passwords, loss of access, blockchain failures, third-party service failures, user mistakes, market losses, malware or device compromise outside Glyphteck Corp direct control, or indirect, incidental, consequential, special, exemplary, or punitive damages.',
        ],
    },
];

const community = [
    'Use veyl only in ways that comply with applicable law and these terms.',
    'Do not use veyl for fraud, scams, impersonation, harassment, threats, extortion, spam, doxxing, malware, unlawful goods or services, sanctions evasion, money laundering, exploitation, or non-consensual sexual content.',
    `If someone is abusing veyl, use the in-app report controls or contact Glyphteck Corp at ${contact} with enough detail to identify the relevant account, username, profile, or message.`,
    'You can block accounts in the app. Blocked accounts are filtered from relevant surfaces and cannot continue normal chat contact with you.',
];

const notices = ['veyl depends on third-party services and networks including Apple, Firebase, Spark, storage providers, notification providers, Bitcoin infrastructure, and public blockchain networks.', 'This product includes icons from the Lucide project, licensed under the ISC License.'];

function SectionList({ items }) {
    return (
        <div className="grid gap-7">
            {items.map((section) => (
                <section key={section.title} className="grid gap-2">
                    <h3 className="text-xl font-black">{section.title}</h3>
                    {section.body.map((line) => (
                        <p key={line} className="max-w-3xl text-sm leading-6 text-muted">
                            {line}
                        </p>
                    ))}
                </section>
            ))}
        </div>
    );
}

export default function LegalPage() {
    return (
        <main className="h-screen overflow-y-auto select-text px-5 py-8 sm:px-8">
            <article className="mx-auto grid w-full max-w-4xl gap-12">
                <header className="grid gap-3 border-b pb-6">
                    <p className="text-sm font-black uppercase text-muted">Glyphteck Corp</p>
                    <h1 className="text-4xl font-black leading-tight sm:text-5xl">veyl legal</h1>
                    <p className="max-w-3xl text-base leading-7 text-muted">
                        veyl is a direct-transaction Bitcoin and encrypted chat product operated by Glyphteck Corp. This page summarizes the privacy, terms, safety, and support terms for veyl.
                    </p>
                    <dl className="grid gap-1 text-sm leading-6 sm:grid-cols-[8rem_1fr]">
                        <dt className="text-muted">Effective</dt>
                        <dd>{updated}</dd>
                        <dt className="text-muted">Contact</dt>
                        <dd>
                            <a className="underline" href={`mailto:${contact}`}>
                                {contact}
                            </a>
                        </dd>
                    </dl>
                </header>

                <section className="grid gap-5">
                    <h2 className="text-2xl font-black">Privacy Policy</h2>
                    <SectionList items={privacy} />
                </section>

                <section className="grid gap-5">
                    <h2 className="text-2xl font-black">Terms of Service</h2>
                    <SectionList items={terms} />
                </section>

                <section className="grid gap-4">
                    <h2 className="text-2xl font-black">Community Rules</h2>
                    <ul className="grid gap-2 text-sm leading-6 text-muted">
                        {community.map((line) => (
                            <li key={line} className="border-b pb-2">
                                {line}
                            </li>
                        ))}
                    </ul>
                </section>

                <section className="grid gap-4">
                    <h2 className="text-2xl font-black">Third-Party Notices</h2>
                    <ul className="grid gap-2 text-sm leading-6 text-muted">
                        {notices.map((line) => (
                            <li key={line} className="border-b pb-2">
                                {line}
                            </li>
                        ))}
                    </ul>
                </section>
            </article>
        </main>
    );
}
