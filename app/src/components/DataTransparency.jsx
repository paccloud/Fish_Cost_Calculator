import React, { useState, useEffect } from 'react';
import { BookOpen, ExternalLink, FileText, AlertCircle, Database, Users, Award } from 'lucide-react';
import { DATA_SOURCE, ACRONYMS, UNCERTAIN_DATA } from '../data/fish_data_v3';
import { apiUrl } from '../config/api';

const DataTransparency = () => {
    const [contributors, setContributors] = useState([]);

    useEffect(() => {
        fetch(apiUrl('/api/contributors'))
            .then(res => res.json())
            .then(data => setContributors(data))
            .catch(err => console.error('Failed to load contributors:', err));
    }, []);

    return (
        <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
            {/* Header */}
            <div className="text-center mb-10">
                <div className="inline-flex items-center justify-center mb-4">
                    <div className="bg-brand-teal p-4 rounded-lg">
                        <BookOpen className="h-8 w-8 text-white" />
                    </div>
                </div>
                <h1 className="text-3xl font-bold text-brand-teal dark:text-[#e8ddd4] mb-3">Data Sources & Methodology</h1>
                <p className="text-[#4a6572] dark:text-[#8fa8b2] max-w-xl mx-auto text-sm">
                    Transparency in data sourcing for accurate yield calculations
                </p>
            </div>

            {/* Primary Source */}
            <div className="bg-white dark:bg-white/5 border border-[#d6ccc4] dark:border-white/10 rounded-lg p-8 shadow-sm">
                <div className="flex items-center gap-3 mb-5">
                    <FileText className="h-5 w-5 text-brand-terracotta" />
                    <h2 className="text-xl font-semibold text-brand-teal dark:text-[#e8ddd4]">Primary Data Source</h2>
                </div>

                <div className="bg-[#eef3f5] dark:bg-brand-teal/10 border border-[#c8d8dd] dark:border-brand-teal/30 rounded p-6 mb-6">
                    <h3 className="text-lg font-bold text-[#1a2e35] dark:text-[#e8ddd4] mb-2">{DATA_SOURCE.title}</h3>
                    <p className="text-[#4a6572] dark:text-[#8fa8b2] mb-4 text-sm">
                        <span className="text-brand-teal dark:text-brand-yellow font-medium">Publication:</span> {DATA_SOURCE.publication}
                    </p>
                    <div className="grid md:grid-cols-2 gap-4 text-sm">
                        <div>
                            <p className="text-[#4a6572] dark:text-[#8fa8b2]">Authors:</p>
                            <p className="text-[#1a2e35] dark:text-[#e8ddd4]">{DATA_SOURCE.authors.join(', ')}</p>
                        </div>
                        <div>
                            <p className="text-[#4a6572] dark:text-[#8fa8b2]">Publisher:</p>
                            <p className="text-[#1a2e35] dark:text-[#e8ddd4]">{DATA_SOURCE.publisher}</p>
                        </div>
                        <div>
                            <p className="text-[#4a6572] dark:text-[#8fa8b2]">Year:</p>
                            <p className="text-[#1a2e35] dark:text-[#e8ddd4]">{DATA_SOURCE.year}</p>
                        </div>
                        <div>
                            <p className="text-[#4a6572] dark:text-[#8fa8b2]">ISBN:</p>
                            <p className="text-[#1a2e35] dark:text-[#e8ddd4] font-mono">{DATA_SOURCE.isbn}</p>
                        </div>
                    </div>
                </div>

                <a
                    href="https://seagrant.uaf.edu/bookstore/pubs/MAB-37.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-brand-teal hover:bg-brand-teal-light text-white px-4 py-2 rounded transition text-sm font-medium"
                >
                    <ExternalLink className="h-4 w-4" />
                    View Original Publication
                </a>
            </div>

            {/* Methodology */}
            <div className="bg-white dark:bg-white/5 border border-[#d6ccc4] dark:border-white/10 rounded-lg p-8 shadow-sm">
                <div className="flex items-center gap-3 mb-5">
                    <Database className="h-5 w-5 text-brand-terracotta" />
                    <h2 className="text-xl font-semibold text-brand-teal dark:text-[#e8ddd4]">Methodology Notes</h2>
                </div>

                <div className="space-y-4 text-sm">
                    <div className="bg-[#eef3f5] dark:bg-brand-teal/10 border border-[#c8d8dd] dark:border-brand-teal/20 rounded p-4">
                        <h4 className="font-semibold text-brand-teal dark:text-[#e8ddd4] mb-2">Average Yields</h4>
                        <p className="text-[#4a6572] dark:text-[#8fa8b2]">Yields represent high quality, properly handled fresh fish and shellfish in good physiological condition. If fish condition is abnormal (post-spawning or starving state), actual yields may differ.</p>
                    </div>

                    <div className="bg-[#eef3f5] dark:bg-brand-teal/10 border border-[#c8d8dd] dark:border-brand-teal/20 rounded p-4">
                        <h4 className="font-semibold text-brand-teal dark:text-[#e8ddd4] mb-2">Yield Ranges</h4>
                        <p className="text-[#4a6572] dark:text-[#8fa8b2]">Ranges represent typical variations found within fish populations during the year. Many factors including handling, processing conditions, filleting skills, and refrigeration affect actual yields.</p>
                    </div>

                    <div className="bg-[#eef3f5] dark:bg-brand-teal/10 border border-[#c8d8dd] dark:border-brand-teal/20 rounded p-4">
                        <h4 className="font-semibold text-brand-teal dark:text-[#e8ddd4] mb-2">Smoked Products</h4>
                        <p className="text-[#4a6572] dark:text-[#8fa8b2]">Smoked fish yields were calculated using an average <strong>15% weight loss</strong> during salting/brining and <strong>10%</strong> during the smoking process.</p>
                    </div>
                </div>
            </div>

            {/* Acronym Glossary */}
            <div className="bg-white dark:bg-white/5 border border-[#d6ccc4] dark:border-white/10 rounded-lg p-8 shadow-sm">
                <h2 className="text-xl font-semibold text-brand-teal dark:text-[#e8ddd4] mb-5 flex items-center gap-3">
                    <span className="text-brand-terracotta font-bold">A–Z</span> Acronym Glossary
                </h2>

                <div className="grid md:grid-cols-2 gap-3">
                    {Object.entries(ACRONYMS).map(([abbr, definition]) => (
                        <div key={abbr} className="bg-[#f5f0eb] dark:bg-white/5 rounded p-4">
                            <span className="text-brand-teal dark:text-brand-yellow font-bold text-base">{abbr}</span>
                            <p className="text-[#4a6572] dark:text-[#8fa8b2] text-sm mt-1">{definition}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Uncertain Data */}
            {UNCERTAIN_DATA && UNCERTAIN_DATA.length > 0 && (
                <div className="bg-white dark:bg-white/5 border border-[#d6ccc4] dark:border-white/10 rounded-lg p-8 shadow-sm">
                    <div className="flex items-center gap-3 mb-5">
                        <AlertCircle className="h-5 w-5 text-brand-yellow" />
                        <h2 className="text-xl font-semibold text-brand-teal dark:text-[#e8ddd4]">Data Quality Notes</h2>
                    </div>

                    <p className="text-[#4a6572] dark:text-[#8fa8b2] mb-4 text-sm">
                        The following data entries were extracted from PDF scans and may have quality issues:
                    </p>

                    <div className="space-y-3">
                        {UNCERTAIN_DATA.map((item, i) => (
                            <div key={i} className="bg-brand-yellow/10 border border-brand-yellow/30 rounded p-4">
                                <p className="text-[#1a2e35] dark:text-[#e8ddd4] font-medium text-sm">{item.species}</p>
                                <p className="text-sm text-[#4a6572] dark:text-[#8fa8b2]">
                                    <span className="text-brand-terracotta">{item.field}:</span> {item.note}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* User Data */}
            <div className="bg-white dark:bg-white/5 border border-[#d6ccc4] dark:border-white/10 rounded-lg p-8 shadow-sm">
                <div className="flex items-center gap-3 mb-5">
                    <Users className="h-5 w-5 text-brand-terracotta" />
                    <h2 className="text-xl font-semibold text-brand-teal dark:text-[#e8ddd4]">User-Contributed Data</h2>
                </div>

                <p className="text-[#4a6572] dark:text-[#8fa8b2] mb-4 text-sm">
                    Logged-in users can upload their own yield data from personal experience. User-contributed data is:
                </p>

                <ul className="space-y-2 text-[#4a6572] dark:text-[#8fa8b2] text-sm">
                    <li className="flex items-start gap-2">
                        <span className="text-brand-terracotta mt-1">•</span>
                        <span>Displayed separately from source data in the calculator</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-brand-terracotta mt-1">•</span>
                        <span>Associated with the user's account</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-brand-terracotta mt-1">•</span>
                        <span>Can be edited or deleted by the contributing user</span>
                    </li>
                </ul>
            </div>

            {/* Community Contributors */}
            {contributors.length > 0 && (
                <div className="bg-white dark:bg-white/5 border border-[#d6ccc4] dark:border-white/10 rounded-lg p-8 shadow-sm">
                    <div className="flex items-center gap-3 mb-5">
                        <Award className="h-5 w-5 text-brand-yellow" />
                        <h2 className="text-xl font-semibold text-brand-teal dark:text-[#e8ddd4]">Community Contributors</h2>
                    </div>

                    <p className="text-[#4a6572] dark:text-[#8fa8b2] mb-6 text-sm">
                        These community members have contributed custom yield data to help expand our database.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {contributors.map((contributor) => (
                            <div
                                key={contributor.id}
                                className="bg-[#f5f0eb] dark:bg-white/5 border border-[#d6ccc4] dark:border-white/10 rounded p-4"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <h3 className="font-semibold text-[#1a2e35] dark:text-[#e8ddd4] text-sm">
                                            {contributor.display_name}
                                        </h3>
                                        {contributor.organization && (
                                            <p className="text-sm text-brand-terracotta mt-1">
                                                {contributor.organization}
                                            </p>
                                        )}
                                        {contributor.bio && (
                                            <p className="text-sm text-[#4a6572] dark:text-[#8fa8b2] mt-2">
                                                {contributor.bio}
                                            </p>
                                        )}
                                    </div>
                                    <div className="text-right ml-4">
                                        <p className="text-2xl font-bold text-brand-teal dark:text-brand-yellow">
                                            {contributor.contribution_count}
                                        </p>
                                        <p className="text-xs text-[#4a6572] dark:text-[#8fa8b2]">
                                            {contributor.contribution_count === 1 ? 'entry' : 'entries'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Footer */}
            <div className="text-center py-4 text-[#4a6572] dark:text-[#8fa8b2] text-sm">
                <p>
                    For corrections or additions to the data, please contact the project maintainers via GitHub.
                </p>
            </div>
        </div>
    );
};

export default DataTransparency;
