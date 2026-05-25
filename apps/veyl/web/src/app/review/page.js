import { links } from '@glyphteck/shared/links';

export const metadata = {
    title: 'veyl App Review',
    description: 'veyl review information for Apple App Review.',
};

const features = [
    'Passkey-first account creation and sign-in',
    'Public usernames and optional avatars',
    'Local vault password creation and unlock',
    'Non-custodial Spark wallet boot',
    'Bitcoin send, receive, withdrawal, and transfer history',
    'End-to-end encrypted one-to-one chat',
    'Text, encrypted attachments, replies, edits, deletes, reports, and payment requests in chat',
    'Search for people by username',
    'Camera scanning for payment requests and user QR codes',
    'Block, report, and account deletion controls',
    'Current community-rules acknowledgement in iOS and web onboarding',
    'Legal, privacy, support, and community-rules screens in the app',
    'Public legal and review pages on the web app',
    'Admin moderation surfaces for reports, bot state, and chat restrictions',
];

const steps = [
    'Create a new account in the iOS app with the device passkey.',
    'Pick a username, complete onboarding, create a vault password, and unlock the vault.',
    'Search for @review and open a chat.',
    'The easiest way to get funded is to create a payment request in a bot chat. In regtest, bots automatically fulfill requests when they have enough balance, then mirror that request back so you can send the money back and test both directions.',
    `You can also tap fund wallet in the app to get your Bitcoin funding address and paste it into the regtest faucet at ${links.regtestFaucet}.`,
    'Send messages, encrypted attachments, or payment requests in the @review chat.',
    'Try replying, editing, deleting, and reporting messages. You can also test block and report controls against bots or real users.',
    'Use the camera to scan QR codes for payment requests or usernames.',
    'To test withdrawals, use the funding address from one account as the withdrawal address for another account.',
    'Try the web app too and run a second testing account in parallel to exercise multi-account flows more directly.',
    'Delete the account in Settings when you are done if you do not want to leave history behind.',
];

const guidelineMap = [
    {
        title: 'full access',
        body: 'Reviewers can create a fresh passkey account, use the live review backend, use the web app, fund a regtest wallet, and message @review.',
    },
    {
        title: 'user content',
        body: 'Public UGC is limited to usernames and profile avatars. veyl filters those profile and discovery surfaces with strict username validation, avatar upload constraints, report controls, block controls, support contact information, manual report review, and admin restrictions.',
    },
    {
        title: 'private chat',
        body: 'Private one-to-one messages are end-to-end encrypted, so veyl does not inspect plaintext before delivery. Users can report harmful chat messages and choose to share message content or evidence with Glyphteck Corp for admin review.',
    },
    {
        title: 'privacy',
        body: 'Legal screens disclose stored service data, unavailable secrets, report handling, retention, deletion, and support contact information.',
    },
    {
        title: 'cryptocurrency',
        body: 'veyl is a non-custodial wallet and direct user-to-user payment app. It is not an exchange, mining product, ICO, investment product, or task-reward system.',
    },
];

export default function ReviewPage() {
    return (
        <div className="h-screen overflow-y-auto select-text px-5 py-8 sm:px-8">
            <div className="mx-auto grid w-full max-w-4xl gap-10">
                <div className="grid gap-3 border-b pb-6">
                    <div className="text-sm font-black uppercase text-muted">Apple App Review</div>
                    <div className="text-4xl font-black leading-tight sm:text-5xl">veyl review guide</div>
                    <div className="max-w-2xl text-base leading-7">
                        veyl is a non-custodial Bitcoin and encrypted chat app operated by Glyphteck Corp. Use this page with the iOS app submission and the dedicated review bot.
                    </div>
                </div>

                <div className="grid gap-4">
                    <div className="text-2xl font-black">Review access</div>
                    <div className="grid gap-2 text-sm leading-6 sm:grid-cols-[10rem_1fr]">
                        <div className="text-muted">Review bot</div>
                        <div>@review</div>
                        <div className="text-muted">Live help</div>
                        <div>@zxrl if online</div>
                        <div className="text-muted">Web app</div>
                        <div>
                            <a className="underline" href={links.veylTest}>
                                {links.veylTest}
                            </a>
                        </div>
                        <div className="text-muted">Faucet</div>
                        <div>
                            <a className="underline" href={links.regtestFaucet}>
                                {links.regtestFaucet}
                            </a>
                        </div>
                        <div className="text-muted">Reviewer note</div>
                        <div>Create a fresh account, then search for @review.</div>
                        <div className="text-muted">Support</div>
                        <div>
                            <a className="underline" href={links.contact}>
                                {links.contact.replace('mailto:', '')}
                            </a>
                        </div>
                    </div>
                    <div className="max-w-2xl text-sm leading-6">
                        veyl uses passkeys instead of shared passwords. Reviewers can create a fresh account on their device, then message @review to exercise chat and payment flows. Reviewers may also
                        message @zxrl for live help if that account is online, but the review flow does not depend on a human response.
                    </div>
                    <div className="max-w-3xl text-sm leading-6">
                        App Review is testing veyl on Spark&apos;s regtest environment. The live production app uses Spark mainnet with real bitcoin.
                    </div>
                </div>

                <div className="grid gap-4">
                    <div className="text-2xl font-black">Funding</div>
                    <div className="grid gap-3 text-sm leading-6">
                        <div>
                            The easiest way to get funded is by requesting money from a bot. In the regtest environment, bots automatically fulfill requests if they have enough money to pay them.
                        </div>
                        <div>After a request is fulfilled, the bot automatically mirrors that request back so the reviewer can send the money back and test outgoing payments too.</div>
                        <div>
                            Reviewers can also fund their wallet directly from the Lightspark regtest faucet at{' '}
                            <a className="underline" href={links.regtestFaucet}>
                                {links.regtestFaucet}
                            </a>
                            . Tap fund wallet in the app to reveal the Bitcoin funding address, then paste that address into the faucet.
                        </div>
                        <div>The easiest way to test withdrawals is to use the funding address from one veyl account as the withdrawal address for another veyl account.</div>
                    </div>
                </div>

                <div className="grid gap-4">
                    <div className="text-2xl font-black">Chat and Camera</div>
                    <div className="grid gap-3 text-sm leading-6">
                        <div>Reviewers can try text, payment requests, replies, edits, deletes, reports, and encrypted attachments in chat.</div>
                        <div>Reviewers can also reply to messages, edit messages, delete messages, and report messages.</div>
                        <div>The camera can scan QR codes for payment requests and usernames.</div>
                    </div>
                </div>

                <div className="grid gap-4">
                    <div className="text-2xl font-black">Other Things To Try</div>
                    <div className="grid gap-3 text-sm leading-6">
                        <div>Reviewers can report or block other users. This can be tested against any bot or any real user account.</div>
                        <div>Reviewers are encouraged to also use the web app and run a second testing account in parallel to test person-to-person flows more directly.</div>
                        <div>When testing is complete, reviewers can delete their account from Settings if they do not want to leave history behind.</div>
                    </div>
                </div>

                <div className="grid gap-4">
                    <div className="text-2xl font-black">Suggested path</div>
                    <ol className="grid list-decimal gap-2 pl-5 text-sm leading-6">
                        {steps.map((step) => (
                            <li key={step}>{step}</li>
                        ))}
                    </ol>
                </div>

                <div className="grid gap-4">
                    <div className="text-2xl font-black">Feature list</div>
                    <ul className="grid gap-2 text-sm leading-6 sm:grid-cols-2">
                        {features.map((feature) => (
                            <li key={feature} className="border-b pb-2">
                                {feature}
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="grid gap-4">
                    <div className="text-2xl font-black">Safety and legal posture</div>
                    <div className="grid gap-3 text-sm leading-6">
                        <div>
                            veyl includes user-generated one-to-one chat, encrypted attachments, and payment-request content. Users can block accounts, report users or messages, and delete their account from
                            Settings.
                        </div>
                        <div>iOS and web require acknowledgement of the latest community rules before vault/app access.</div>
                        <div>
                            Glyphteck Corp reviews reports through internal admin tooling and can restrict accounts, chat, usernames, uploads, user discovery, or bot behavior when needed for safety or
                            policy enforcement.
                        </div>
                        <div>
                            veyl is not a bank, custodian, exchange, broker, escrow service, payment processor, or recovery service. Glyphteck Corp does not have the user's vault password, decrypted
                            seed, private keys, or plaintext encrypted chat messages during normal operation.
                        </div>
                        <div>veyl does not mine cryptocurrency, operate an exchange, offer ICOs or investment products, or reward users with cryptocurrency for completing tasks.</div>
                    </div>
                </div>

                <div className="grid gap-4">
                    <div className="text-2xl font-black">Guideline mapping</div>
                    <div className="grid gap-3 text-sm leading-6 sm:grid-cols-2">
                        {guidelineMap.map((item) => (
                            <div key={item.title} className="grid gap-1 border-b pb-3">
                                <div className="font-black">{item.title}</div>
                                <div>{item.body}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
