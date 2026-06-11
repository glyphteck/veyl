import { COMPANY_NAME, LEGAL_EFFECTIVE_DATE, LEGAL_NOTICES, LEGAL_SECTION_ORDER, LEGAL_SECTIONS } from '@veyl/shared/legal';

export const metadata = {
    title: 'veyl Legal',
    description: 'Privacy, terms, safety, and support information for veyl.',
    alternates: {
        canonical: '/legal',
    },
};

function TextBlock({ lines }) {
    return lines.map((line) => (
        <p key={line} className="text-[15px] leading-[23px] text-foreground">
            {line}
        </p>
    ));
}

function LinkList({ links }) {
    return (
        <div className="flex flex-wrap gap-2 pt-1">
            {links.map((item) => (
                <a key={item.url} href={item.url} className="rounded-full bg-foreground px-3 py-1.5 text-xs font-black text-background">
                    {item.label}
                </a>
            ))}
        </div>
    );
}

function LegalGroup({ content }) {
    return (
        <section className="grid gap-4">
            <div className="grid gap-2.5 rounded-round bg-background/70 px-4.5 py-4.5 shadow backdrop-blur-sm">
                <h2 className="text-2xl font-black">{content.title}</h2>
                <p className="text-[15px] leading-[23px] text-foreground">{content.intro}</p>
                <LinkList links={content.links} />
            </div>

            {content.sections.map((section) => (
                <section key={section.title} className="grid gap-2.5 rounded-round bg-background/70 px-4.5 py-4.5 shadow backdrop-blur-sm">
                    <h3 className="text-xl font-black">{section.title}</h3>
                    <TextBlock lines={section.body} />
                </section>
            ))}
        </section>
    );
}

export default function LegalPage() {
    return (
        <main className="absolute inset-0 overflow-hidden">
            <div className="h-full overflow-y-auto px-4 pt-24 pb-10 select-text">
                <article className="mx-auto grid w-full max-w-3xl gap-5">
                    {LEGAL_SECTION_ORDER.map((key) => (
                        <LegalGroup key={key} content={LEGAL_SECTIONS[key]} />
                    ))}

                    <section className="grid gap-4">
                        <div className="grid gap-2.5 rounded-round bg-background/70 px-4.5 py-4.5 shadow backdrop-blur-sm">
                            <h2 className="text-2xl font-black">third-party notices</h2>
                        </div>
                        {LEGAL_NOTICES.map((notice) => (
                            <section key={notice.title} className="grid gap-2.5 rounded-round bg-background/70 px-4.5 py-4.5 shadow backdrop-blur-sm">
                                <h3 className="text-xl font-black">{notice.title}</h3>
                                <TextBlock lines={notice.body} />
                            </section>
                        ))}
                    </section>
                </article>
            </div>

            <header className="pointer-events-none absolute inset-x-0 top-0 bg-background/70 shadow backdrop-blur-sm">
                <div className="grid min-h-16 w-full grid-cols-[56px_minmax(0,1fr)_56px] items-center px-4">
                    <div />
                    <div className="min-w-0 text-center">
                        <h1 className="text-2xl font-extrabold leading-tight">legal</h1>
                        <div className="text-xs font-bold text-muted">
                            effective {LEGAL_EFFECTIVE_DATE} - {COMPANY_NAME}
                        </div>
                    </div>
                    <div />
                </div>
            </header>
        </main>
    );
}
