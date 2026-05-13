import React, { useState, useEffect } from 'react';
import { Users, Download, Search, AlertCircle } from 'lucide-react';
import { apiUrl } from '../config/api';

const CommunityData = () => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');

    useEffect(() => {
        fetch(apiUrl('/api/community-data'))
            .then(res => res.json())
            .then(rows => {
                if (Array.isArray(rows)) {
                    setData(rows);
                } else {
                    setError('Failed to load community data.');
                }
            })
            .catch(() => setError('Network error loading community data.'))
            .finally(() => setLoading(false));
    }, []);

    const filtered = data.filter(row =>
        row.species.toLowerCase().includes(search.toLowerCase()) ||
        row.product.toLowerCase().includes(search.toLowerCase()) ||
        (row.contributor || '').toLowerCase().includes(search.toLowerCase())
    );

    const handleDownload = async () => {
        try {
            const res = await fetch(apiUrl('/api/export-community-data'));
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'community-yield-data.csv';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (e) {
            console.error('Download failed:', e);
        }
    };

    return (
        <div className="max-w-5xl mx-auto px-4 py-8">
            <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-brand-teal flex items-center gap-3">
                        <Users className="text-brand-terracotta" size={24} />
                        Community Data Pool
                    </h1>
                    <p className="text-text-secondary mt-1 text-sm">
                        Yield data shared by the Local Catch Network community — {data.length} entries from real fishing operations.
                    </p>
                </div>
                <button
                    onClick={handleDownload}
                    disabled={data.length === 0}
                    className="flex items-center gap-2 bg-brand-teal hover:bg-brand-teal-light text-white px-4 py-2 rounded transition disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                >
                    <Download size={16} />
                    Download CSV
                </button>
            </div>

            {/* Search */}
            <div className="relative mb-6">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by species, product, or contributor..."
                    className="form-input pl-10"
                />
            </div>

            {error && (
                <div className="mb-6 p-4 rounded flex items-center gap-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-500/30">
                    <AlertCircle size={18} />
                    {error}
                </div>
            )}

            <div className="card overflow-hidden">
                <div className="p-4 border-b border-line flex items-center justify-between">
                    <h2 className="text-base font-semibold text-brand-teal">Shared Yield Data</h2>
                    {search && (
                        <span className="text-sm text-text-secondary">{filtered.length} of {data.length} results</span>
                    )}
                </div>

                {loading ? (
                    <div className="p-8 text-center text-text-secondary">Loading...</div>
                ) : filtered.length === 0 ? (
                    <div className="p-8 text-center text-text-secondary">
                        <Users size={40} className="mx-auto mb-4 opacity-30" />
                        <p>{search ? 'No results match your search.' : 'No community data yet. Be the first to share your yield data!'}</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-line bg-surface">
                                    <th className="text-left p-4 text-text-secondary font-medium">Species</th>
                                    <th className="text-left p-4 text-text-secondary font-medium">Product</th>
                                    <th className="text-right p-4 text-text-secondary font-medium">Yield %</th>
                                    <th className="text-left p-4 text-text-secondary font-medium">Contributor</th>
                                    <th className="text-left p-4 text-text-secondary font-medium hidden md:table-cell">Source</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((row) => (
                                    <tr
                                        key={row.id}
                                        className="border-b border-line-subtle hover:bg-surface transition"
                                    >
                                        <td className="p-4 text-text-primary font-medium">{row.species}</td>
                                        <td className="p-4 text-text-secondary">{row.product}</td>
                                        <td className="p-4 text-right text-brand-teal font-semibold">{row.yield}%</td>
                                        <td className="p-4 text-text-secondary">
                                            {row.contributor || 'Anonymous'}
                                            {row.organization && (
                                                <span className="ml-1 text-text-muted text-xs">({row.organization})</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-text-muted hidden md:table-cell">{row.source || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <p className="mt-6 text-sm text-text-secondary text-center">
                Want to contribute? Log in, add your yield data in <strong>My Data</strong>, then click the share icon.
            </p>
        </div>
    );
};

export default CommunityData;
