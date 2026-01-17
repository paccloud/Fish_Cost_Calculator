import React from 'react';
import { Coffee, Heart, Fish, Anchor, Sparkles, Github, Mail } from 'lucide-react';

const About = () => {
    return (
        <div className="max-w-4xl mx-auto px-4">
            {/* Hero Section */}
            <div className="text-center mb-16">
                <div className="inline-flex items-center justify-center mb-6">
                    <div className="relative">
                        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full blur-xl opacity-50 animate-pulse"></div>
                        <div className="relative bg-gradient-to-tr from-cyan-500 to-blue-600 p-4 rounded-full">
                            <Fish className="h-12 w-12 text-white" />
                        </div>
                    </div>
                </div>
                <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent mb-4">
                    About This Calculator
                </h1>
                <p className="text-xl text-slate-600 dark:text-gray-400 max-w-2xl mx-auto">
                    A simple fish cost calculator for the seafood industry
                </p>
            </div>

            {/* Origin Story Card */}
            <div className="relative mb-12 group">
                <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-500"></div>
                <div className="relative bg-white dark:bg-slate-800/80 backdrop-blur-sm border border-slate-200 dark:border-white/10 rounded-2xl p-8 md:p-10 shadow-md dark:shadow-none">
                    <div className="flex items-center gap-3 mb-6">
                        <Anchor className="h-6 w-6 text-cyan-400" />
                        <h2 className="text-2xl font-semibold text-slate-800 dark:text-white">The Story</h2>
                    </div>

                    <div className="space-y-4 text-slate-600 dark:text-gray-300 leading-relaxed">
                        <p>
                            This project started years ago as a simple tool to help calculate the true cost of fish 
                            products after processing yields and various fees. What began as a personal spreadsheet 
                            evolved into something the community could benefit from.
                        </p>
                        <p>
                            The discussions about pricing transparency and the challenges fishers face when calculating 
                            fair prices for their catch reminded me why this tool matters. I wanted to create something 
                            that helps everyone in the seafood industry make informed decisions.
                        </p>
                    </div>

                    {/* Contact Section */}
                    <div className="mt-8 p-4 bg-slate-100 dark:bg-slate-700/50 rounded-xl border border-slate-200 dark:border-white/5">
                        <div className="flex items-start gap-4">
                            <div className="bg-gradient-to-br from-blue-500 to-cyan-500 p-2 rounded-lg shrink-0">
                                <Mail className="h-5 w-5 text-white" />
                            </div>
                            <div>
                                <h3 className="font-medium text-slate-800 dark:text-white mb-1">Get in Touch</h3>
                                <p className="text-sm text-slate-600 dark:text-gray-400 mb-3">
                                    Have questions, suggestions, or feedback? I'd love to hear from you.
                                </p>
                                <a 
                                    href="mailto:ryan@pacificcloudseafoods.com"
                                    className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 transition-colors text-sm font-medium"
                                >
                                    ryan@pacificcloudseafoods.com
                                    <Mail className="h-4 w-4" />
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Open Source Section */}
            <div className="relative mb-12 group">
                <div className="absolute -inset-1 bg-gradient-to-r from-purple-500 via-pink-500 to-rose-500 rounded-2xl blur opacity-20 group-hover:opacity-35 transition duration-500"></div>
                <div className="relative bg-white dark:bg-slate-800/80 backdrop-blur-sm border border-slate-200 dark:border-white/10 rounded-2xl p-8 md:p-10 shadow-md dark:shadow-none">
                    <div className="flex items-center gap-3 mb-6">
                        <Sparkles className="h-6 w-6 text-purple-400" />
                        <h2 className="text-2xl font-semibold text-slate-800 dark:text-white">Open Source & Free Forever</h2>
                    </div>

                    <div className="text-slate-600 dark:text-gray-300 leading-relaxed mb-6">
                        <p>
                            This calculator is and will always be <span className="text-purple-400 font-medium">free and open source</span>. 
                            It's built for and by the fishing community. Whether you're a small-scale fisher calculating 
                            prices for direct sales, or a processor working with multiple species, this tool is here to help.
                        </p>
                    </div>

                    <a
                        href="https://github.com/paccloud/Fish_Cost_Calculator"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-white px-4 py-2 rounded-lg transition-colors"
                    >
                        <Github className="h-5 w-5" />
                        View on GitHub
                    </a>
                </div>
            </div>

            {/* Support Section - Buy Me a Coffee */}
            <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-amber-500 via-orange-500 to-yellow-500 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-500"></div>
                <div className="relative bg-white dark:bg-slate-800/80 backdrop-blur-sm border border-slate-200 dark:border-white/10 rounded-2xl p-8 md:p-10 text-center shadow-md dark:shadow-none">
                    <div className="inline-flex items-center justify-center mb-6">
                        <div className="bg-gradient-to-br from-amber-500 to-orange-500 p-3 rounded-full">
                            <Coffee className="h-8 w-8 text-white" />
                        </div>
                    </div>

                    <h2 className="text-2xl font-semibold text-slate-800 dark:text-white mb-4">Support Future Updates</h2>

                    <p className="text-slate-600 dark:text-gray-300 max-w-lg mx-auto mb-8 leading-relaxed">
                        If you find this tool useful and want to support continued development, consider buying me a coffee! 
                        Your support helps fund new features, better data, and keeping this tool free for everyone.
                    </p>

                    <a 
                        href="https://buymeacoffee.com/pcswny"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-semibold px-8 py-4 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40"
                    >
                        <Coffee className="h-5 w-5" />
                        Buy Me a Coffee
                        <Heart className="h-4 w-4 text-red-200" />
                    </a>

                    <p className="text-sm text-slate-500 dark:text-gray-500 mt-6 flex items-center justify-center gap-2">
                        <Heart className="h-4 w-4 text-red-400" />
                        Thank you for supporting community tools!
                    </p>
                </div>
            </div>

            {/* Footer Note */}
            <div className="text-center mt-16 py-8 border-t border-slate-200 dark:border-white/10">
                <p className="text-slate-500 dark:text-gray-500 text-sm">
                    Built with ❤️ for the fishing community
                </p>
            </div>
        </div>
    );
};

export default About;
