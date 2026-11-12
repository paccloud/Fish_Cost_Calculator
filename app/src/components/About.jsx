import React from 'react';
import { Coffee, ExternalLink, Github } from 'lucide-react';

const HEADING = 'font-display text-xl font-semibold text-text-primary';
const NEW_TAB = <span className="sr-only"> (opens in a new tab)</span>;

const About = () => {
    return (
        <div className="mx-auto max-w-2xl">
            <header className="mb-8">
                <h1 className="font-display text-3xl font-semibold text-text-primary">
                    About Local Catch
                </h1>
                <p className="mt-2 text-base text-text-secondary">
                    A community-driven fish cost calculator for sustainable seafood
                </p>
            </header>

            <div className="space-y-6">
                {/* Origin Story */}
                <section className="card p-5 sm:p-6" aria-labelledby="about-origin">
                    <h2 id="about-origin" className={HEADING}>The origin story</h2>

                    <div className="mt-3 max-w-prose space-y-4 text-base text-text-secondary">
                        <p>
                            This project started years ago as a simple tool to help calculate the true cost of fish
                            products after processing yields and various fees. What began as a personal spreadsheet
                            evolved into something the community could benefit from.
                        </p>
                        <p>
                            After some time away from active development, the project was{' '}
                            <strong className="font-semibold text-text-primary">reinvigorated
                            by a conversation on the listserv of the Local Catch network</strong>. The discussions about
                            pricing transparency and the challenges fishers face when calculating fair prices for
                            their catch reminded me why this tool matters.
                        </p>
                        <p>
                            The Catch network communities work tirelessly to support sustainable, community-based
                            fisheries. Their dedication to connecting fishers with consumers while promoting
                            transparency inspired me to dust off this project and make it available to everyone.
                        </p>
                    </div>

                    <h3 className="mt-6 text-lg font-semibold text-text-primary">Learn about Catch</h3>
                    <p className="mt-1 max-w-prose text-base text-text-secondary">
                        The Catch network supports community-supported fisheries and sustainable seafood initiatives.
                    </p>
                    <a
                        href="https://localcatch.org"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secondary mt-4"
                    >
                        Visit Local Catch Network
                        <ExternalLink size={20} aria-hidden="true" />
                        {NEW_TAB}
                    </a>
                </section>

                {/* Open Source */}
                <section className="card p-5 sm:p-6" aria-labelledby="about-open-source">
                    <h2 id="about-open-source" className={HEADING}>Open source and free forever</h2>

                    <p className="mt-3 max-w-prose text-base text-text-secondary">
                        This calculator is and will always be{' '}
                        <strong className="font-semibold text-text-primary">free and open source</strong>.
                        It&apos;s built for and by the fishing community. Whether you&apos;re a small-scale fisher calculating
                        prices for direct sales, or a processor working with multiple species, this tool is here to help.
                    </p>

                    <a
                        href="https://github.com/paccloud/Fish_Cost_Calculator"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secondary mt-4"
                    >
                        <Github size={20} aria-hidden="true" />
                        View on GitHub
                        {NEW_TAB}
                    </a>
                </section>

                {/* Support */}
                <section className="card p-5 sm:p-6" aria-labelledby="about-support">
                    <h2 id="about-support" className={HEADING}>Support future updates</h2>

                    <p className="mt-3 max-w-prose text-base text-text-secondary">
                        If you find this tool useful and want to support continued development, consider buying me a coffee.
                        Your support helps fund new features, better data, and keeping this tool free for everyone.
                    </p>

                    <a
                        href="https://buymeacoffee.com/pcswny"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-4 inline-flex min-h-[3rem] items-center justify-center gap-2 rounded-lg bg-brand-cta px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-brand-cta-hover"
                    >
                        <Coffee size={20} aria-hidden="true" />
                        Buy me a coffee
                        {NEW_TAB}
                    </a>
                </section>

                <p className="text-sm text-text-secondary">
                    Built with care for the fishing community
                </p>
            </div>
        </div>
    );
};

export default About;
