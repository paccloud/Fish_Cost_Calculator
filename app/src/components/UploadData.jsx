import React, { useState } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
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
                setStatus({ type: 'success', message: data.message || 'Upload successful!' });
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
                <div className="bg-[#f0ebe4] dark:bg-white/8 p-8 rounded-full">
                    <Upload size={40} className="text-[#4a6572] dark:text-[#8fa8b2]" />
                </div>
                <h2 className="text-xl font-bold text-brand-teal dark:text-[#e8ddd4]">Login Required</h2>
                <p className="text-[#4a6572] dark:text-[#8fa8b2] max-w-md text-sm">
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
            <div className="bg-white dark:bg-white/5 rounded-lg p-6 sm:p-8 shadow-sm border border-[#d6ccc4] dark:border-white/15">
                <h2 className="text-2xl font-bold mb-2 text-brand-teal dark:text-[#e8ddd4] flex items-center gap-3">
                    <Upload className="text-brand-terracotta" size={22} />
                    Upload Yield Data
                </h2>

                <p className="text-[#4a6572] dark:text-[#8fa8b2] mb-8 text-sm">
                    Upload an Excel (.xlsx) file with your custom species yield data.
                    The file should have columns for <strong>Species</strong> (or Common Name) and <strong>% Yield</strong>.
                </p>

                <div className="border-2 border-dashed border-[#d6ccc4] dark:border-white/20 rounded p-10 text-center hover:border-brand-teal/40 transition bg-[#f5f0eb] dark:bg-white/5">
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
                            <Upload size={40} className="text-[#4a6572] dark:text-[#8fa8b2]" />
                        )}
                        <span className="text-base font-medium text-[#1a2e35] dark:text-[#e8ddd4]">
                            {file ? file.name : 'Click to select a file'}
                        </span>
                        <span className="text-sm text-[#4a6572] dark:text-[#8fa8b2]">
                            Supported formats: .xlsx, .csv
                        </span>
                    </label>
                </div>

                {status && (
                    <div className={`mt-6 p-4 rounded flex items-center gap-3 text-sm ${
                        status.type === 'success'
                            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-500/30'
                            : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-500/30'
                    }`}>
                        {status.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
                        {status.message}
                    </div>
                )}

                <button
                    onClick={handleUpload}
                    disabled={!file || uploading}
                    className="mt-6 w-full py-3 rounded font-semibold transition text-sm
                        disabled:bg-[#ede7e0] disabled:dark:bg-white/8 disabled:cursor-not-allowed disabled:text-[#4a6572] disabled:dark:text-[#8fa8b2]
                        bg-brand-teal hover:bg-brand-teal-light text-white enabled:cursor-pointer"
                >
                    {uploading ? 'Uploading...' : 'Upload Data'}
                </button>
            </div>
        </div>
    );
};

export default UploadData;
