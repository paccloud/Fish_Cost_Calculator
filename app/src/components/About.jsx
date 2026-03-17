import React from 'react';
import { Coffee, Heart, ExternalLink, Fish, Anchor, Github } from 'lucide-react';

const About = () => {
    return (
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
            {/* Header */}
            <div className="text-center mb-10">
                <div className="inline-flex items-center justify-center mb-4">
                    <div className="bg-brand-teal p-4 rounded-lg">
                        <Fish className="h-10 w-10 text-white" />
                    </div>
                </div>
                <h1 className="text-3xl font-bold text-brand-teal dark:text-[#e8ddd4] mb-3">
                    About Local Catch
                </h1>
                <p className="text-[#4a6572] dark:text-[#8fa8b2] max-w-xl mx-auto">
                    A community-driven fish cost calculator for sustainable seafood
                </p>
            </div>

            {/* Origin Story */}
            <div className="bg-white dark:bg-white/5 border border-[#d6ccc4] dark:border-white/10 rounded-lg p-8 shadow-sm">
                <div className="flex items-center gap-3 mb-5">
                    <Anchor className="h-5 w-5 text-brand-terracotta" />
                    <h2 className="text-xl font-semibold text-brand-teal dark:text-[#e8ddd4]">The Origin Story</h2>
                </div>

                <div className="space-y-4 text-[#4a6572] dark:text-[#8fa8b2] leading-relaxed text-sm">
                    <p>
                        This project started years ago as a simple tool to help calculate the true cost of fish
                        products after processing yields and various fees. What began as a personal spreadsheet
                        evolved into something the community could benefit from.
                    </p>
                    <p>
                        After some time away from active development, the project was{' '}
                        <span className="text-brand-terracotta font-medium">reinvigorated
                        by a conversation on the listserv of the Local Catch network</span>. The discussions about
                        pricing transparency and the challenges fishers face when calculating fair prices for
                        their catch reminded me why this tool matters.
                    </p>
                    <p>
                        The Catch network communities work tirelessly to support sustainable, community-based
                        fisheries. Their dedication to connecting fishers with consumers while promoting
                        transparency inspired me to dust off this project and make it available to everyone.
                    </p>
                </div>

                <div className="mt-6 p-4 bg-[#f0ebe4] dark:bg-white/5 rounded border border-[#d6ccc4] dark:border-white/10">
                    <div className="flex items-start gap-4">
                        <div className="bg-brand-teal p-2 rounded shrink-0">
                            <ExternalLink className="h-4 w-4 text-white" />
                        </div>
                        <div>
                            <h3 className="font-medium text-[#1a2e35] dark:text-[#e8ddd4] mb-1 text-sm">Learn About Catch</h3>
                            <p className="text-sm text-[#4a6572] dark:text-[#8fa8b2] mb-3">
                                The Catch network supports community-supported fisheries and sustainable seafood initiatives.
                            </p>
                            <a
                                href="https://localcatch.org"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 text-brand-terracotta hover:underline text-sm font-medium"
                            >
                                Visit Local Catch Network
                                <ExternalLink className="h-3 w-3" />
                            </a>
                        </div>
                    </div>
                </div>
            </div>

            {/* Open Source */}
            <div className="bg-white dark:bg-white/5 border border-[#d6ccc4] dark:border-white/10 rounded-lg p-8 shadow-sm">
                <div className="flex items-center gap-3 mb-5">
                    <Github className="h-5 w-5 text-brand-terracotta" />
                    <h2 className="text-xl font-semibold text-brand-teal dark:text-[#e8ddd4]">Open Source & Free Forever</h2>
                </div>

                <p className="text-[#4a6572] dark:text-[#8fa8b2] leading-relaxed mb-6 text-sm">
                    This calculator is and will always be{' '}
                    <span className="text-brand-teal dark:text-brand-yellow font-medium">free and open source</span>.
                    It's built for and by the fishing community. Whether you're a small-scale fisher calculating
                    prices for direct sales, or a processor working with multiple species, this tool is here to help.
                </p>

                <a
                    href="https://github.com/paccloud/Fish_Cost_Calculator"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-[#1a2e35] dark:bg-white/10 hover:bg-[#0d1f26] dark:hover:bg-white/15 text-white px-4 py-2 rounded transition text-sm font-medium"
                >
                    <Github className="h-4 w-4" />
                    View on GitHub
                </a>
            </div>

            {/* Support */}
            <div className="bg-white dark:bg-white/5 border border-[#d6ccc4] dark:border-white/10 rounded-lg p-8 shadow-sm text-center">
                <div className="inline-flex items-center justify-center mb-5">
                    <div className="bg-brand-terracotta p-3 rounded">
                        <Coffee className="h-6 w-6 text-white" />
                    </div>
                </div>

                <h2 className="text-xl font-semibold text-brand-teal dark:text-[#e8ddd4] mb-3">Support Future Updates</h2>

                <p className="text-[#4a6572] dark:text-[#8fa8b2] max-w-lg mx-auto mb-6 leading-relaxed text-sm">
                    If you find this tool useful and want to support continued development, consider buying me a coffee!
                    Your support helps fund new features, better data, and keeping this tool free for everyone.
                </p>

                <a
                    href="https://buymeacoffee.com/pcswny"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-brand-terracotta hover:bg-brand-terracotta-light text-white font-semibold px-6 py-3 rounded transition"
                >
                    <Coffee className="h-4 w-4" />
                    Buy Me a Coffee
                    <Heart className="h-4 w-4" />
                </a>
            </div>

            {/* Footer */}
            <div className="text-center py-6 border-t border-[#d6ccc4] dark:border-white/10">
                <p className="text-[#4a6572] dark:text-[#8fa8b2] text-sm">
                    Built with care for the fishing community
                </p>
            </div>
        </div>
    );
};

export default About;
