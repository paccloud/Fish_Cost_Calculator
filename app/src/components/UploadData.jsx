import React, { useState } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../config/api';

const UploadData = () => {
    const { user } = useAuth();
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [status, setStatus] = useState(null);

    const handleFileChange = (e) => {
        if (e.target.files) {
            setFile(e.target.files[0]);
            setStatus(null);
        }
    };

    const handleUpload = async () => {
        if (!file || !user) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const token = localStorage.getItem('token');
            const res = await fetch(apiUrl('/api/upload-data'), {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            const data = await res.json();

            if (res.ok) {
                setStatus({ type: 'success', data });
                setFile(null);
            } else {
                setStatus({ type: 'error', message: data.error || 'Upload failed.' });
            }
        } catch (e) {
            setStatus({ type: 'error', message: 'Network error occurred.' });
        } finally {
            setUploading(false);
        }
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
                <h2 className="text-2xl font-bold mb-2 text-brand-teal flex items-center gap-3">
                    <Upload className="text-brand-terracotta" size={22} />
                    Upload Yield Data
                </h2>

                <p className="text-text-secondary mb-8 text-sm">
                    Upload an Excel (.xlsx) file with your custom species yield data.
                    The file should have columns for <strong>Species</strong> (or Common Name) and <strong>% Yield</strong>.
                </p>

                <div className="border-2 border-dashed border-line rounded p-10 text-center hover:border-brand-teal/40 transition bg-surface">
                    <input
                        type="file"
                        accept=".xlsx, .xls, .csv"
                        onChange={handleFileChange}
                        className="hidden"
                        id="file-upload"
                    />
                    <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-4">
                        {file ? (
                            <FileText size={40} className="text-brand-teal" />
                        ) : (
                            <Upload size={40} className="text-text-secondary" />
                        )}
                        <span className="text-base font-medium text-text-primary">
                            {file ? file.name : 'Click to select a file'}
                        </span>
                        <span className="text-sm text-text-secondary">
                            Supported formats: .xlsx, .csv
                        </span>
                    </label>
                </div>

                {status && status.type === 'success' && (
                    <div className="mt-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-500/30 rounded p-4">
                        <div className="flex items-center gap-2 text-green-700 dark:text-green-300 font-medium text-sm mb-3">
                            <CheckCircle size={16} />
                            Import complete
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-center mb-3">
                            {status.data.inserted > 0 && (
                                <div className="bg-white dark:bg-white/10 rounded p-2">
                                    <p className="text-xl font-bold text-brand-teal">{status.data.inserted}</p>
                                    <p className="text-xs text-text-secondary">added</p>
                                </div>
                            )}
                            {status.data.updated > 0 && (
                                <div className="bg-white dark:bg-white/10 rounded p-2">
                                    <p className="text-xl font-bold text-brand-teal">{status.data.updated}</p>
                                    <p className="text-xs text-text-secondary">updated</p>
                                </div>
                            )}
                            {status.data.skipped > 0 && (
                                <div className="bg-white dark:bg-white/10 rounded p-2">
                                    <p className="text-xl font-bold text-brand-yellow">{status.data.skipped}</p>
                                    <p className="text-xs text-text-secondary">skipped</p>
                                </div>
                            )}
                        </div>
                        {status.data.skipped > 0 && status.data.skippedRows?.length > 0 && (
                            <p className="text-xs text-text-secondary mb-2">
                                Skipped rows (missing species or invalid yield): {status.data.skippedRows.join(', ')}
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

                {status && status.type === 'error' && (
                    <div className="mt-6 p-4 rounded flex items-center gap-3 text-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-500/30">
                        <AlertCircle size={18} />
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
