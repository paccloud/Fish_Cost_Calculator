import React, { useState, useCallback } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, ArrowRight, Download, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../config/api';

const TEMPLATE_CSV = `Species,% Yield,Product,Source\nAtlantic Salmon,45,Skinless Fillet,\nHalibut,38,Steak,\nDungeness Crab,25,Picked Meat,\n`;

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const UploadData = () => {
    const { user, getAuthHeaders } = useAuth();
    const [file, setFile] = useState(null);
    const [dragOver, setDragOver] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [status, setStatus] = useState(null);

    const acceptFile = (f) => {
        if (!f) return;
        const ext = f.name.split('.').pop().toLowerCase();
        if (!['xlsx', 'xls', 'csv'].includes(ext)) {
            setStatus({ type: 'error', message: 'Unsupported file type. Please upload a .xlsx or .csv file.' });
            return;
        }
        setFile(f);
        setStatus(null);
    };

    const handleFileChange = (e) => {
        if (e.target.files?.[0]) acceptFile(e.target.files[0]);
    };

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        setDragOver(false);
        acceptFile(e.dataTransfer.files?.[0]);
    }, []);

    const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
    const handleDragLeave = () => setDragOver(false);

    const handleUpload = async () => {
        if (!file || !user) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const authHeaders = await getAuthHeaders();
            const res = await fetch(apiUrl('/api/upload-data'), {
                method: 'POST',
                headers: authHeaders,
                body: formData
            });

            const data = await res.json();

            if (res.ok) {
                setStatus({ type: 'success', data });
                setFile(null);
            } else {
                setStatus({ type: 'error', message: data.error || 'Upload failed.' });
            }
        } catch {
            setStatus({ type: 'error', message: 'Network error occurred.' });
        } finally {
            setUploading(false);
        }
    };

    const downloadTemplate = () => {
        const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'yield-upload-template.csv';
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
    };

    if (!user) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
                <div className="bg-surface p-8 rounded-full">
                    <Upload size={40} className="text-text-secondary" />
                </div>
                <h2 className="text-xl font-bold text-brand-teal">Login Required</h2>
                <p className="text-text-secondary max-w-md text-sm">
                    You need to be logged in to upload your own yield data.
                    This allows you to customize the calculator with your specific experience.
                </p>
                <Link to="/login" className="px-6 py-2 bg-brand-teal hover:bg-brand-teal-light text-white rounded transition text-sm font-medium">
                    Go to Login
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto p-4 sm:p-6">
            <div className="card p-6 sm:p-8">
                <div className="flex items-start justify-between mb-2">
                    <h2 className="text-2xl font-bold text-brand-teal flex items-center gap-3">
                        <Upload className="text-brand-terracotta" size={22} />
                        Upload Yield Data
                    </h2>
                    <button
                        onClick={downloadTemplate}
                        className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-brand-teal transition font-medium"
                        title="Download a template CSV"
                    >
                        <Download size={14} />
                        Template
                    </button>
                </div>

                <p className="text-text-secondary mb-6 text-sm">
                    Upload a spreadsheet with columns <strong>Species</strong> and <strong>% Yield</strong>.
                    Optionally include <strong>Product</strong> and <strong>Source</strong> columns.
                </p>

                {/* Drop zone */}
                <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    className={`border-2 border-dashed rounded p-10 text-center transition
                        ${dragOver
                            ? 'border-brand-teal bg-brand-teal/5'
                            : file
                                ? 'border-brand-teal/40 bg-surface'
                                : 'border-line bg-surface hover:border-brand-teal/40'}`}
                >
                    <input
                        type="file"
                        accept=".xlsx, .xls, .csv"
                        onChange={handleFileChange}
                        className="hidden"
                        id="file-upload"
                    />
                    {file ? (
                        <div className="flex flex-col items-center gap-3">
                            <FileText size={36} className="text-brand-teal" />
                            <div>
                                <p className="text-sm font-medium text-text-primary">{file.name}</p>
                                <p className="text-xs text-text-secondary mt-0.5">{formatBytes(file.size)}</p>
                            </div>
                            <button
                                onClick={() => { setFile(null); setStatus(null); }}
                                className="flex items-center gap-1 text-xs text-text-secondary hover:text-red-400 transition"
                            >
                                <X size={12} /> Remove
                            </button>
                        </div>
                    ) : (
                        <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-3">
                            <Upload size={36} className={dragOver ? 'text-brand-teal' : 'text-text-secondary'} />
                            <div>
                                <p className="text-sm font-medium text-text-primary">
                                    {dragOver ? 'Drop to upload' : 'Drag & drop or click to select'}
                                </p>
                                <p className="text-xs text-text-secondary mt-1">
                                    .xlsx or .csv — max 4 MB
                                </p>
                            </div>
                        </label>
                    )}
                </div>

                {/* Results */}
                {status?.type === 'success' && (
                    <div className="mt-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-500/30 rounded p-4">
                        <div className="flex items-center gap-2 text-green-700 dark:text-green-300 font-medium text-sm mb-3">
                            <CheckCircle size={16} />
                            Import complete
                        </div>
                        <div className="flex gap-3 mb-3">
                            {status.data.inserted > 0 && (
                                <div className="flex-1 bg-white dark:bg-white/10 rounded p-2 text-center">
                                    <p className="text-xl font-bold text-brand-teal">{status.data.inserted}</p>
                                    <p className="text-xs text-text-secondary">added</p>
                                </div>
                            )}
                            {status.data.updated > 0 && (
                                <div className="flex-1 bg-white dark:bg-white/10 rounded p-2 text-center">
                                    <p className="text-xl font-bold text-brand-teal">{status.data.updated}</p>
                                    <p className="text-xs text-text-secondary">updated</p>
                                </div>
                            )}
                            {status.data.skipped > 0 && (
                                <div className="flex-1 bg-white dark:bg-white/10 rounded p-2 text-center">
                                    <p className="text-xl font-bold text-brand-yellow">{status.data.skipped}</p>
                                    <p className="text-xs text-text-secondary">skipped</p>
                                </div>
                            )}
                            {status.data.inserted === 0 && status.data.updated === 0 && status.data.skipped === 0 && (
                                <p className="text-sm text-text-secondary">No valid records found in file.</p>
                            )}
                        </div>
                        {status.data.skipped > 0 && status.data.skippedRows?.length > 0 && (
                            <p className="text-xs text-text-secondary mb-3">
                                Rows skipped (missing species or invalid yield %): rows {status.data.skippedRows.join(', ')}
                            </p>
                        )}
                        <Link
                            to="/manage-data"
                            className="inline-flex items-center gap-1 text-xs text-brand-terracotta hover:underline font-medium"
                        >
                            View your data <ArrowRight size={12} />
                        </Link>
                    </div>
                )}

                {status?.type === 'error' && (
                    <div className="mt-6 p-4 rounded flex items-center gap-3 text-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-500/30">
                        <AlertCircle size={18} className="shrink-0" />
                        {status.message}
                    </div>
                )}

                <button
                    onClick={handleUpload}
                    disabled={!file || uploading}
                    className="mt-6 btn-primary w-full"
                >
                    {uploading ? 'Uploading...' : 'Upload Data'}
                </button>
            </div>
        </div>
    );
};

export default UploadData;
