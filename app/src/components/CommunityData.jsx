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
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-slate-800 dark:text-white flex items-center gap-3">
                        <Users className="text-cyan-400" />
                        Community Data Pool
                    </h1>
                    <p className="text-slate-600 dark:text-gray-400 mt-2">
                        Yield data shared by the Local Catch Network community — {data.length} entries from real fishing operations.
                    </p>
                </div>
                <button
                    onClick={handleDownload}
                    disabled={data.length === 0}
                    className="flex items-center gap-2 bg-slate-600 hover:bg-slate-500 text-white px-4 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Download size={20} />
                    Download CSV
                </button>
            </div>

            {/* Search */}
            <div className="relative mb-6">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by species, product, or contributor..."
                    className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-800 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-cyan-500 outline-none"
                />
            </div>

            {error && (
                <div className="mb-6 p-4 rounded-lg flex items-center gap-3 bg-red-900/40 text-red-300 border border-red-500/30">
                    <AlertCircle size={20} />
                    {error}
                </div>
            )}

            <div className="bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden shadow-md dark:shadow-none">
                <div className="p-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Shared Yield Data</h2>
                    {search && (
                        <span className="text-sm text-slate-500 dark:text-gray-400">{filtered.length} of {data.length} results</span>
                    )}
                </div>

                {loading ? (
                    <div className="p-8 text-center text-slate-600 dark:text-gray-400">Loading...</div>
                ) : filtered.length === 0 ? (
                    <div className="p-8 text-center text-slate-600 dark:text-gray-400">
                        <Users size={48} className="mx-auto mb-4 opacity-50" />
                        <p>{search ? 'No results match your search.' : 'No community data yet. Be the first to share your yield data!'}</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50">
                                    <th className="text-left p-4 text-slate-600 dark:text-gray-400 font-medium">Species</th>
                                    <th className="text-left p-4 text-slate-600 dark:text-gray-400 font-medium">Product</th>
                                    <th className="text-right p-4 text-slate-600 dark:text-gray-400 font-medium">Yield %</th>
                                    <th className="text-left p-4 text-slate-600 dark:text-gray-400 font-medium">Contributor</th>
                                    <th className="text-left p-4 text-slate-600 dark:text-gray-400 font-medium hidden md:table-cell">Source</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((row, i) => (
                                    <tr
                                        key={row.id}
                                        className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/5 transition"
                                    >
                                        <td className="p-4 text-slate-800 dark:text-white font-medium">{row.species}</td>
                                        <td className="p-4 text-slate-600 dark:text-gray-300">{row.product}</td>
                                        <td className="p-4 text-right text-cyan-500 font-semibold">{row.yield}%</td>
                                        <td className="p-4 text-slate-600 dark:text-gray-300">
                                            {row.contributor || 'Anonymous'}
                                            {row.organization && (
                                                <span className="ml-1 text-slate-400 dark:text-gray-500 text-xs">({row.organization})</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-slate-400 dark:text-gray-500 hidden md:table-cell">{row.source || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <p className="mt-6 text-sm text-slate-500 dark:text-gray-500 text-center">
                Want to contribute? Log in, add your yield data in <strong>My Data</strong>, then click the share icon.
            </p>
        </div>
    );
};

export default CommunityData;
