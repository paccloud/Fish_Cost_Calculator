import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Download } from 'lucide-react';
import { apiUrl } from '../config/api';
import { useAuth } from '../context/AuthContext';

const HEADING = 'font-display text-xl font-semibold text-text-primary';
const INLINE_LINK = 'font-semibold text-link underline underline-offset-2';

// "48.00" from the server reads as 48; a typed decimal (45.5) is kept.
function formatYield(value) {
    const n = Number(value);
    return Number.isFinite(n) ? String(Number(n.toFixed(2))) : String(value ?? '');
}

function countLabel(count) {
    return `${count} ${count === 1 ? 'yield' : 'yields'}`;
}

/**
 * Everything under the Community title, for one load state at a time:
 * loading, failed (the failure and a way forward, nothing else), or loaded
 * (the yields, or an empty state when there are none).
 */
export const CommunityYieldsView = ({
    status,
    rows = [],
    search = '',
    onSearchChange,
    onRetry,
    retrying = false,
    failures = 0,
    onDownload,
    downloadError = null,
    signedIn = false,
    headingRef,
}) => {
    if (status === 'loading') {
        return <p role="status" className="text-base text-text-secondary">Loading community yields…</p>;
    }

    if (status === 'error') {
        return (
            <section className="card p-5 sm:p-6">
                {/* Keyed so a second failed try is announced again */}
                <div role="alert" key={failures}>
                    <h2 className={`flex items-start gap-2 ${HEADING}`}>
                        <AlertCircle size={22} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
                        Community yields didn’t load
                    </h2>
                    <p className="mt-2 text-base text-text-secondary">
                        The calculator still works without them. Try again when you have signal.
                    </p>
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                    <button
                        type="button"
                        onClick={onRetry}
                        aria-disabled={retrying}
                        className="btn-primary w-full aria-disabled:cursor-wait aria-disabled:opacity-60 sm:w-auto"
                    >
                        {retrying ? 'Trying again…' : 'Try again'}
                    </button>
                    <Link to="/" className="btn-secondary w-full sm:w-auto">Go to the calculator</Link>
                </div>
            </section>
        );
    }

    if (rows.length === 0) {
        return (
            <section className="card p-5 sm:p-6">
                <h2 ref={headingRef} tabIndex={-1} className={HEADING}>No community yields yet</h2>
                <p className="mt-2 text-base text-text-secondary">
                    Yields that people measure and choose to share show up here. To add the first one,
                    {signedIn ? ' ' : ' sign in, '}add a yield in My yields, then choose Share on it.
                </p>
                {signedIn ? (
                    <Link to="/manage-data" className="btn-primary mt-5">Go to My yields</Link>
                ) : (
                    <Link to="/login" className="btn-primary mt-5">Sign in</Link>
                )}
            </section>
        );
    }

    const query = search.trim().toLowerCase();
    const filtered = query
        ? rows.filter((row) =>
            (row.species || '').toLowerCase().includes(query) ||
            (row.product || '').toLowerCase().includes(query) ||
            (row.contributor || '').toLowerCase().includes(query))
        : rows;

    return (
        <div className="space-y-6">
            <div>
                <label htmlFor="community-search" className="form-label">Search community yields</label>
                <input
                    id="community-search"
                    type="search"
                    value={search}
                    onChange={(e) => onSearchChange?.(e.target.value)}
                    placeholder="Species, product or contributor"
                    className="form-input"
                />
            </div>

            <section className="card overflow-hidden" aria-labelledby="community-list-heading">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line p-5">
                    <h2 id="community-list-heading" ref={headingRef} tabIndex={-1} className={HEADING}>
                        Shared yields
                    </h2>
                    <p aria-live="polite" className="text-sm text-text-secondary">
                        {query ? `${filtered.length} of ${countLabel(rows.length)}` : countLabel(rows.length)}
                    </p>
                </div>

                {filtered.length === 0 ? (
                    <div className="p-5">
                        <p className="text-base text-text-secondary">
                            No yields match “{search.trim()}”. Try a species or product name.
                        </p>
                        <button type="button" onClick={() => onSearchChange?.('')} className="btn-ghost -mx-3 mt-1 text-base">
                            Clear search
                        </button>
                    </div>
                ) : (
                    <ul className="divide-y divide-line-subtle">
                        {filtered.map((row) => (
                            <li key={row.id} className="flex items-start justify-between gap-4 px-5 py-4">
                                <div className="min-w-0">
                                    <p className="break-words font-display text-xl font-semibold text-text-primary">{row.species}</p>
                                    <p className="break-words text-base text-text-secondary">{row.product}</p>
                                    <p className="mt-1 break-words text-sm text-text-secondary">
                                        Shared by {row.contributor || 'Anonymous'}
                                        {row.organization ? ` (${row.organization})` : ''}
                                        {row.source ? ` · Source: ${row.source}` : ''}
                                    </p>
                                </div>
                                <p className="shrink-0 text-right text-xl font-bold tabular-nums text-text-primary">
                                    {formatYield(row.yield)}%
                                    <span className="block text-sm font-normal text-text-secondary">yield</span>
                                </p>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <div>
                <button type="button" onClick={onDownload} className="btn-secondary">
                    <Download size={20} aria-hidden="true" />
                    Download CSV
                </button>
                {downloadError && (
                    <p role="alert" className="mt-2 flex items-start gap-2 text-sm font-semibold text-danger">
                        <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                        {downloadError}
                    </p>
                )}
            </div>

            <p className="text-base text-text-secondary">
                Want to add yours?{' '}
                {signedIn ? (
                    <>Add a yield in <Link to="/manage-data" className={INLINE_LINK}>My yields</Link>, then choose Share on it.</>
                ) : (
                    <><Link to="/login" className={INLINE_LINK}>Sign in</Link>, add a yield in My yields, then choose Share on it.</>
                )}
            </p>
        </div>
    );
};

const CommunityData = () => {
    const { user } = useAuth();
    const [load, setLoad] = useState({ status: 'loading', rows: [], retrying: false, failures: 0 });
    const [attempt, setAttempt] = useState(0);
    const [search, setSearch] = useState('');
    const [downloadError, setDownloadError] = useState(null);
    const headingRef = useRef(null);
    const focusWhenLoaded = useRef(false);

    useEffect(() => {
        let cancelled = false;
        fetch(apiUrl('/api/community-data'))
            .then(res => {
                if (!res.ok) throw new Error('Server error');
                return res.json();
            })
            .then(rows => {
                if (!Array.isArray(rows)) throw new Error('Unexpected response');
                if (!cancelled) setLoad((prev) => ({ ...prev, status: 'ready', rows, retrying: false }));
            })
            .catch(() => {
                if (!cancelled) {
                    setLoad((prev) => ({ status: 'error', rows: [], retrying: false, failures: prev.failures + 1 }));
                }
            });
        return () => { cancelled = true; };
    }, [attempt]);

    // "Try again" disappears when the yields arrive, so put focus on what replaced it.
    useEffect(() => {
        if (load.status === 'ready' && focusWhenLoaded.current) {
            focusWhenLoaded.current = false;
            headingRef.current?.focus();
        }
    }, [load.status]);

    const handleRetry = () => {
        if (load.retrying) return;
        focusWhenLoaded.current = true;
        setLoad((prev) => ({ ...prev, retrying: true }));
        setAttempt((n) => n + 1);
    };

    const handleDownload = async () => {
        setDownloadError(null);
        try {
            const res = await fetch(apiUrl('/api/community-data?format=csv'));
            if (!res.ok) throw new Error('Export failed');
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
            setDownloadError('The CSV didn’t download. Check your connection and try again.');
        }
    };

    return (
        <div className="mx-auto max-w-2xl">
            <header className="mb-8">
                <h1 className="font-display text-3xl font-semibold text-text-primary">Community yields</h1>
                <p className="mt-2 text-base text-text-secondary">
                    Yields shared by the Local Catch Network community, from real fishing operations.
                </p>
            </header>

            <CommunityYieldsView
                status={load.status}
                rows={load.rows}
                search={search}
                onSearchChange={setSearch}
                onRetry={handleRetry}
                retrying={load.retrying}
                failures={load.failures}
                onDownload={handleDownload}
                downloadError={downloadError}
                signedIn={Boolean(user)}
                headingRef={headingRef}
            />
        </div>
    );
};

export default CommunityData;
