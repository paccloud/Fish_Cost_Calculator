import React, { useState, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import { DATA_SOURCE, ACRONYMS, UNCERTAIN_DATA } from '../data/fish_data_v3';
import { apiUrl } from '../config/api';

const HEADING = 'font-display text-xl font-semibold text-text-primary';
const SUBHEADING = 'text-base font-semibold text-text-primary';

const DataTransparency = () => {
    const [contributors, setContributors] = useState([]);

    useEffect(() => {
        fetch(apiUrl('/api/contributors'))
            .then(res => res.json())
            .then(data => { if (Array.isArray(data)) setContributors(data); })
            .catch(err => console.error('Failed to load contributors:', err));
    }, []);

    return (
        <div className="mx-auto max-w-2xl">
            <header className="mb-8">
                <h1 className="font-display text-3xl font-semibold text-text-primary">Data sources and methodology</h1>
                <p className="mt-2 text-base text-text-secondary">
                    Transparency in data sourcing for accurate yield calculations
                </p>
            </header>

            <div className="space-y-6">
                {/* Primary Source */}
                <section className="card p-5 sm:p-6" aria-labelledby="source-primary">
                    <h2 id="source-primary" className={HEADING}>Primary data source</h2>

                    <h3 className="mt-3 text-lg font-semibold text-text-primary">{DATA_SOURCE.title}</h3>
                    <dl className="mt-3 grid gap-x-6 gap-y-3 text-base sm:grid-cols-2">
                        <div className="sm:col-span-2">
                            <dt className="text-sm text-text-secondary">Publication</dt>
                            <dd className="text-text-primary">{DATA_SOURCE.publication}</dd>
                        </div>
                        <div>
                            <dt className="text-sm text-text-secondary">Authors</dt>
                            <dd className="text-text-primary">{DATA_SOURCE.authors.join(', ')}</dd>
                        </div>
                        <div>
                            <dt className="text-sm text-text-secondary">Publisher</dt>
                            <dd className="text-text-primary">{DATA_SOURCE.publisher}</dd>
                        </div>
                        <div>
                            <dt className="text-sm text-text-secondary">Year</dt>
                            <dd className="tabular-nums text-text-primary">{DATA_SOURCE.year}</dd>
                        </div>
                        <div>
                            <dt className="text-sm text-text-secondary">ISBN</dt>
                            <dd className="tabular-nums text-text-primary">{DATA_SOURCE.isbn}</dd>
                        </div>
                    </dl>

                    <a
                        href="https://seagrant.uaf.edu/bookstore/pubs/MAB-37.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secondary mt-5"
                    >
                        View original publication
                        <ExternalLink size={20} aria-hidden="true" />
                        <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                </section>

                {/* Methodology */}
                <section className="card p-5 sm:p-6" aria-labelledby="source-method">
                    <h2 id="source-method" className={HEADING}>Methodology notes</h2>

                    <div className="mt-3 max-w-prose space-y-4 text-base text-text-secondary">
                        <div>
                            <h3 className={SUBHEADING}>Average yields</h3>
                            <p>Yields represent high quality, properly handled fresh fish and shellfish in good physiological condition. If fish condition is abnormal (post-spawning or starving state), actual yields may differ.</p>
                        </div>

                        <div>
                            <h3 className={SUBHEADING}>Yield ranges</h3>
                            <p>Ranges represent typical variations found within fish populations during the year. Many factors including handling, processing conditions, filleting skills, and refrigeration affect actual yields.</p>
                        </div>

                        <div>
                            <h3 className={SUBHEADING}>Smoked products</h3>
                            <p>Smoked fish yields were calculated using an average <strong className="text-text-primary">15% weight loss</strong> during salting/brining and <strong className="text-text-primary">10%</strong> during the smoking process.</p>
                        </div>
                    </div>
                </section>

                {/* Acronym Glossary */}
                <section className="card p-5 sm:p-6" aria-labelledby="source-acronyms">
                    <h2 id="source-acronyms" className={HEADING}>Acronym glossary</h2>

                    <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                        {Object.entries(ACRONYMS).map(([abbr, definition]) => (
                            <div key={abbr}>
                                <dt className="text-base font-bold text-text-primary">{abbr}</dt>
                                <dd className="text-base text-text-secondary">{definition}</dd>
                            </div>
                        ))}
                    </dl>
                </section>

                {/* Uncertain Data */}
                {UNCERTAIN_DATA && UNCERTAIN_DATA.length > 0 && (
                    <section className="card p-5 sm:p-6" aria-labelledby="source-quality">
                        <h2 id="source-quality" className={HEADING}>Data quality notes</h2>

                        <p className="mt-3 max-w-prose text-base text-text-secondary">
                            The following data entries were extracted from PDF scans and may have quality issues:
                        </p>

                        <ul className="mt-3 divide-y divide-line-subtle">
                            {UNCERTAIN_DATA.map((item, i) => (
                                <li key={i} className="py-3 first:pt-0 last:pb-0">
                                    <p className="text-base font-semibold text-text-primary">{item.species}</p>
                                    <p className="text-base text-text-secondary">
                                        <span className="font-semibold">{item.field}:</span> {item.note}
                                    </p>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {/* User Data */}
                <section className="card p-5 sm:p-6" aria-labelledby="source-user">
                    <h2 id="source-user" className={HEADING}>User-contributed data</h2>

                    <p className="mt-3 max-w-prose text-base text-text-secondary">
                        People who sign in can upload their own yield data from personal experience. User-contributed data is:
                    </p>

                    <ul className="mt-3 max-w-prose list-disc space-y-2 pl-5 text-base text-text-secondary">
                        <li>Displayed separately from source data in the calculator</li>
                        <li>Associated with the user&apos;s account</li>
                        <li>Can be edited or deleted by the contributing user</li>
                    </ul>
                </section>

                {/* Community Contributors */}
                {contributors.length > 0 && (
                    <section className="card p-5 sm:p-6" aria-labelledby="source-contributors">
                        <h2 id="source-contributors" className={HEADING}>Community contributors</h2>

                        <p className="mt-3 max-w-prose text-base text-text-secondary">
                            These community members have contributed custom yield data to help expand our database.
                        </p>

                        <ul className="mt-3 divide-y divide-line-subtle">
                            {contributors.map((contributor) => (
                                <li key={contributor.id} className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
                                    <div className="min-w-0">
                                        <h3 className="break-words text-base font-semibold text-text-primary">
                                            {contributor.display_name}
                                        </h3>
                                        {contributor.organization && (
                                            <p className="break-words text-base text-text-secondary">
                                                {contributor.organization}
                                            </p>
                                        )}
                                        {contributor.bio && (
                                            <p className="mt-1 break-words text-sm text-text-secondary">
                                                {contributor.bio}
                                            </p>
                                        )}
                                    </div>
                                    <p className="shrink-0 text-right text-xl font-bold tabular-nums text-text-primary">
                                        {contributor.contribution_count}
                                        <span className="block text-sm font-normal text-text-secondary">
                                            {contributor.contribution_count === 1 ? 'entry' : 'entries'}
                                        </span>
                                    </p>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <p className="max-w-prose text-sm text-text-secondary">
                    For corrections or additions to the data, please contact the project maintainers via GitHub.
                </p>
            </div>
        </div>
    );
};

export default DataTransparency;
