import React from 'react';
import { BookOpen, ExternalLink, FileText, AlertCircle, Database, Users } from 'lucide-react';
import { DATA_SOURCE, ACRONYMS, UNCERTAIN_DATA } from '../data/fish_data_v3';

const DataTransparency = () => {
    return (
        <div className="max-w-4xl mx-auto px-4 py-8">
            {/* Header */}
            <div className="text-center mb-12">
                <div className="inline-flex items-center justify-center mb-6">
                    <div className="bg-gradient-to-tr from-emerald-500 to-teal-600 p-4 rounded-full">
                        <BookOpen className="h-10 w-10 text-white" />
                    </div>
                </div>
                <h1 className="text-4xl font-bold text-white mb-4">Data Sources & Methodology</h1>
                <p className="text-xl text-gray-400 max-w-2xl mx-auto">
                    Transparency in data sourcing for accurate yield calculations
                </p>
            </div>

            {/* Primary Source */}
            <div className="bg-slate-800/80 border border-white/10 rounded-2xl p-8 mb-8">
                <div className="flex items-center gap-3 mb-6">
                    <FileText className="h-6 w-6 text-emerald-400" />
                    <h2 className="text-2xl font-semibold text-white">Primary Data Source</h2>
                </div>
                
                <div className="bg-emerald-900/30 border border-emerald-700/50 rounded-xl p-6 mb-6">
                    <h3 className="text-xl font-bold text-white mb-2">{DATA_SOURCE.title}</h3>
                    <p className="text-gray-300 mb-4">
                        <span className="text-emerald-400">Publication:</span> {DATA_SOURCE.publication}
                    </p>
                    <div className="grid md:grid-cols-2 gap-4 text-sm">
                        <div>
                            <p className="text-gray-400">Authors:</p>
                            <p className="text-white">{DATA_SOURCE.authors.join(', ')}</p>
                        </div>
                        <div>
                            <p className="text-gray-400">Publisher:</p>
                            <p className="text-white">{DATA_SOURCE.publisher}</p>
                        </div>
                        <div>
                            <p className="text-gray-400">Year:</p>
                            <p className="text-white">{DATA_SOURCE.year}</p>
                        </div>
                        <div>
                            <p className="text-gray-400">ISBN:</p>
                            <p className="text-white font-mono">{DATA_SOURCE.isbn}</p>
                        </div>
                    </div>
                </div>

                <a 
                    href="https://seagrant.uaf.edu/bookstore/pubs/MAB-37.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg transition"
                >
                    <ExternalLink className="h-4 w-4" />
                    View Original Publication
                </a>
            </div>

            {/* Methodology */}
            <div className="bg-slate-800/80 border border-white/10 rounded-2xl p-8 mb-8">
                <div className="flex items-center gap-3 mb-6">
                    <Database className="h-6 w-6 text-blue-400" />
                    <h2 className="text-2xl font-semibold text-white">Methodology Notes</h2>
                </div>
                
                <div className="space-y-4 text-gray-300">
                    <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-4">
                        <h4 className="font-semibold text-blue-400 mb-2">Average Yields</h4>
                        <p>Yields represent high quality, properly handled fresh fish and shellfish in good physiological condition. If fish condition is abnormal (post-spawning or starving state), actual yields may differ.</p>
                    </div>
                    
                    <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-4">
                        <h4 className="font-semibold text-blue-400 mb-2">Yield Ranges</h4>
                        <p>Ranges represent typical variations found within fish populations during the year. Many factors including handling, processing conditions, filleting skills, and refrigeration affect actual yields.</p>
                    </div>
                    
                    <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-4">
                        <h4 className="font-semibold text-blue-400 mb-2">Smoked Products</h4>
                        <p>Smoked fish yields were calculated using an average <strong>15% weight loss</strong> during salting/brining and <strong>10%</strong> during the smoking process.</p>
                    </div>
                </div>
            </div>

            {/* Acronym Glossary */}
            <div className="bg-slate-800/80 border border-white/10 rounded-2xl p-8 mb-8">
                <h2 className="text-2xl font-semibold text-white mb-6 flex items-center gap-3">
                    <span className="text-cyan-400">A-Z</span> Acronym Glossary
                </h2>
                
                <div className="grid md:grid-cols-2 gap-4">
                    {Object.entries(ACRONYMS).map(([abbr, definition]) => (
                        <div key={abbr} className="bg-slate-700/50 rounded-lg p-4">
                            <span className="text-cyan-400 font-bold text-lg">{abbr}</span>
                            <p className="text-gray-300 text-sm mt-1">{definition}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Uncertain Data */}
            {UNCERTAIN_DATA && UNCERTAIN_DATA.length > 0 && (
                <div className="bg-slate-800/80 border border-white/10 rounded-2xl p-8 mb-8">
                    <div className="flex items-center gap-3 mb-6">
                        <AlertCircle className="h-6 w-6 text-amber-400" />
                        <h2 className="text-2xl font-semibold text-white">Data Quality Notes</h2>
                    </div>
                    
                    <p className="text-gray-400 mb-4">
                        The following data entries were extracted from PDF scans and may have quality issues:
                    </p>
                    
                    <div className="space-y-3">
                        {UNCERTAIN_DATA.map((item, i) => (
                            <div key={i} className="bg-amber-900/20 border border-amber-700/30 rounded-lg p-4">
                                <p className="text-white font-medium">{item.species}</p>
                                <p className="text-sm text-gray-400">
                                    <span className="text-amber-400">{item.field}:</span> {item.note}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* User Data */}
            <div className="bg-slate-800/80 border border-white/10 rounded-2xl p-8">
                <div className="flex items-center gap-3 mb-6">
                    <Users className="h-6 w-6 text-purple-400" />
                    <h2 className="text-2xl font-semibold text-white">User-Contributed Data</h2>
                </div>
                
                <p className="text-gray-300 mb-4">
                    Logged-in users can upload their own yield data from personal experience. User-contributed data is:
                </p>
                
                <ul className="space-y-2 text-gray-300">
                    <li className="flex items-start gap-2">
                        <span className="text-purple-400 mt-1">•</span>
                        <span>Displayed separately from source data in the calculator</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-purple-400 mt-1">•</span>
                        <span>Associated with the user's account</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-purple-400 mt-1">•</span>
                        <span>Can be edited or deleted by the contributing user</span>
                    </li>
                </ul>
            </div>

            {/* References */}
            <div className="mt-12 text-center text-gray-500 text-sm">
                <p>
                    For corrections or additions to the data, please contact the project maintainers via GitHub.
                </p>
            </div>
        </div>
    );
};

export default DataTransparency;
