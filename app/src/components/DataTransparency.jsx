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
        <div className="max-w-4xl mx-auto px-4 py-8">
            {/* Header */}
            <div className="text-center mb-12">
                <div className="inline-flex items-center justify-center mb-6">
                    <div className="bg-teal p-4 rounded-full">
                        <BookOpen className="h-10 w-10 text-white" />
                    </div>
                </div>
                <h1 className="text-3xl md:text-4xl font-heading font-bold text-navy dark:text-text-primary tracking-tight mb-4">Data Sources & Methodology</h1>
                <p className="text-lg text-text-secondary max-w-2xl mx-auto">
                    Transparency in data sourcing for accurate yield calculations
                </p>
            </div>

            {/* Primary Source */}
            <div className="bg-surface-elevated border border-border rounded-xl p-8 mb-8">
                <div className="flex items-center gap-3 mb-6">
                    <FileText className="h-6 w-6 text-teal" />
                    <h2 className="text-2xl font-heading font-semibold text-navy dark:text-text-primary">Primary Data Source</h2>
                </div>

                <div className="bg-teal/10 border border-teal/20 rounded-xl p-6 mb-6">
                    <h3 className="text-xl font-bold text-navy dark:text-text-primary mb-2">{DATA_SOURCE.title}</h3>
                    <p className="text-text-secondary mb-4">
                        <span className="text-teal">Publication:</span> {DATA_SOURCE.publication}
                    </p>
                    <div className="grid md:grid-cols-2 gap-4 text-sm">
                        <div>
                            <p className="text-text-secondary">Authors:</p>
                            <p className="text-navy dark:text-text-primary">{DATA_SOURCE.authors.join(', ')}</p>
                        </div>
                        <div>
                            <p className="text-text-secondary">Publisher:</p>
                            <p className="text-navy dark:text-text-primary">{DATA_SOURCE.publisher}</p>
                        </div>
                        <div>
                            <p className="text-text-secondary">Year:</p>
                            <p className="text-navy dark:text-text-primary">{DATA_SOURCE.year}</p>
                        </div>
                        <div>
                            <p className="text-text-secondary">ISBN:</p>
                            <p className="text-navy dark:text-text-primary font-mono">{DATA_SOURCE.isbn}</p>
                        </div>
                    </div>
                </div>

                <a 
                    href="https://seagrant.uaf.edu/bookstore/pubs/MAB-37.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-teal hover:bg-[#0B6958] text-white px-4 py-2 rounded-lg transition"
                >
                    <ExternalLink className="h-4 w-4" />
                    View Original Publication
                </a>
            </div>

            {/* Methodology */}
            <div className="bg-surface-elevated border border-border rounded-xl p-8 mb-8">
                <div className="flex items-center gap-3 mb-6">
                    <Database className="h-6 w-6 text-teal" />
                    <h2 className="text-2xl font-heading font-semibold text-navy dark:text-text-primary">Methodology Notes</h2>
                </div>

                <div className="space-y-4 text-text-secondary">
                    <div className="bg-teal/10 border border-teal/20 rounded-lg p-4">
                        <h4 className="font-semibold text-teal mb-2">Average Yields</h4>
                        <p>Yields represent high quality, properly handled fresh fish and shellfish in good physiological condition. If fish condition is abnormal (post-spawning or starving state), actual yields may differ.</p>
                    </div>
                    
                    <div className="bg-teal/10 border border-teal/20 rounded-lg p-4">
                        <h4 className="font-semibold text-teal mb-2">Yield Ranges</h4>
                        <p>Ranges represent typical variations found within fish populations during the year. Many factors including handling, processing conditions, filleting skills, and refrigeration affect actual yields.</p>
                    </div>
                    
                    <div className="bg-teal/10 border border-teal/20 rounded-lg p-4">
                        <h4 className="font-semibold text-teal mb-2">Smoked Products</h4>
                        <p>Smoked fish yields were calculated using an average <strong>15% weight loss</strong> during salting/brining and <strong>10%</strong> during the smoking process.</p>
                    </div>
                </div>
            </div>

            {/* Acronym Glossary */}
            <div className="bg-surface-elevated border border-border rounded-xl p-8 mb-8">
                <h2 className="text-2xl font-heading font-semibold text-navy dark:text-text-primary mb-6 flex items-center gap-3">
                    <span className="text-teal">A-Z</span> Acronym Glossary
                </h2>

                <div className="grid md:grid-cols-2 gap-4">
                    {Object.entries(ACRONYMS).map(([abbr, definition]) => (
                        <div key={abbr} className="bg-surface border border-border rounded-lg p-4">
                            <span className="text-teal font-bold text-lg">{abbr}</span>
                            <p className="text-text-secondary text-sm mt-1">{definition}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Uncertain Data */}
            {UNCERTAIN_DATA && UNCERTAIN_DATA.length > 0 && (
                <div className="bg-surface-elevated border border-border rounded-xl p-8 mb-8">
                    <div className="flex items-center gap-3 mb-6">
                        <AlertCircle className="h-6 w-6 text-amber-400" />
                        <h2 className="text-2xl font-heading font-semibold text-navy dark:text-text-primary">Data Quality Notes</h2>
                    </div>

                    <p className="text-text-secondary mb-4">
                        The following data entries were extracted from PDF scans and may have quality issues:
                    </p>

                    <div className="space-y-3">
                        {UNCERTAIN_DATA.map((item, i) => (
                            <div key={i} className="bg-amber-900/20 border border-amber-700/30 rounded-lg p-4">
                                <p className="text-navy dark:text-text-primary font-medium">{item.species}</p>
                                <p className="text-sm text-text-secondary">
                                    <span className="text-amber-400">{item.field}:</span> {item.note}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* User Data */}
            <div className="bg-surface-elevated border border-border rounded-xl p-8">
                <div className="flex items-center gap-3 mb-6">
                    <Users className="h-6 w-6 text-teal" />
                    <h2 className="text-2xl font-heading font-semibold text-navy dark:text-text-primary">User-Contributed Data</h2>
                </div>

                <p className="text-text-secondary mb-4">
                    Logged-in users can upload their own yield data from personal experience. User-contributed data is:
                </p>

                <ul className="space-y-2 text-text-secondary">
                    <li className="flex items-start gap-2">
                        <span className="text-teal mt-1">•</span>
                        <span>Displayed separately from source data in the calculator</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-teal mt-1">•</span>
                        <span>Associated with the user's account</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-teal mt-1">•</span>
                        <span>Can be edited or deleted by the contributing user</span>
                    </li>
                </ul>
            </div>

            {/* Community Contributors */}
            {contributors.length > 0 && (
                <div className="bg-surface-elevated border border-border rounded-xl p-8">
                    <div className="flex items-center gap-3 mb-6">
                        <Award className="h-6 w-6 text-amber-500" />
                        <h2 className="text-2xl font-heading font-semibold text-navy dark:text-text-primary">Community Contributors</h2>
                    </div>

                    <p className="text-text-secondary mb-6">
                        These community members have contributed custom yield data to help expand our database.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {contributors.map((contributor) => (
                            <div
                                key={contributor.id}
                                className="bg-surface border border-border rounded-lg p-4"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <h3 className="font-semibold text-navy dark:text-text-primary">
                                            {contributor.display_name}
                                        </h3>
                                        {contributor.organization && (
                                            <p className="text-sm text-teal mt-1">
                                                {contributor.organization}
                                            </p>
                                        )}
                                        {contributor.bio && (
                                            <p className="text-sm text-text-secondary mt-2">
                                                {contributor.bio}
                                            </p>
                                        )}
                                    </div>
                                    <div className="text-right ml-4">
                                        <p className="text-2xl font-bold text-teal">
                                            {contributor.contribution_count}
                                        </p>
                                        <p className="text-xs text-text-secondary">
                                            {contributor.contribution_count === 1 ? 'entry' : 'entries'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* References */}
            <div className="mt-12 text-center text-text-secondary text-sm">
                <p>
                    For corrections or additions to the data, please contact the project maintainers via GitHub.
                </p>
            </div>
        </div>
    );
};

export default DataTransparency;
