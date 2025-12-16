import React, { useState } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

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
            const res = await fetch('http://localhost:3000/api/upload-data', {
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
                <div className="bg-slate-800 p-8 rounded-full">
                    <Upload size={48} className="text-gray-500" />
                </div>
                <h2 className="text-2xl font-bold text-white">Login Required</h2>
                <p className="text-gray-400 max-w-md">
                    You need to be logged in to upload your own yield data. 
                    This allows you to customize the calculator with your specific experience.
                </p>
                <Link to="/login" className="px-6 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition">
                    Go to Login
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto p-6">
            <div className="bg-white/10 backdrop-blur-lg rounded-xl p-8 shadow-xl border border-white/20">
                <h2 className="text-3xl font-bold mb-6 text-white flex items-center gap-3">
                    <Upload className="text-cyan-400" />
                    Upload Yield Data
                </h2>
                
                <p className="text-gray-300 mb-8">
                    Upload an Excel (.xlsx) file with your custom species yield data. 
                    The file should have columns for <strong>Species</strong> (or Common Name) and <strong>% Yield</strong>.
                </p>

                <div className="border-2 border-dashed border-slate-600 rounded-xl p-10 text-center hover:border-cyan-500/50 transition bg-slate-800/50">
                    <input 
                        type="file" 
                        accept=".xlsx, .xls, .csv" 
                        onChange={handleFileChange}
                        className="hidden" 
                        id="file-upload"
                    />
                    <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-4">
                        {file ? (
                            <FileText size={48} className="text-green-400" />
                        ) : (
                            <Upload size={48} className="text-gray-400" />
                        )}
                        <span className="text-lg font-medium text-white">
                            {file ? file.name : "Click to select a file"}
                        </span>
                        <span className="text-sm text-gray-500">
                            Supported formats: .xlsx, .csv
                        </span>
                    </label>
                </div>

                {status && (
                    <div className={`mt-6 p-4 rounded-lg flex items-center gap-3 ${status.type === 'success' ? 'bg-green-900/40 text-green-300 border border-green-500/30' : 'bg-red-900/40 text-red-300 border border-red-500/30'}`}>
                        {status.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
                        {status.message}
                    </div>
                )}

                <button 
                    onClick={handleUpload}
                    disabled={!file || uploading}
                    className={`mt-8 w-full py-3 rounded-lg font-bold text-white shadow-lg transition
                        ${!file || uploading 
                            ? 'bg-slate-700 cursor-not-allowed text-gray-400' 
                            : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 hover:scale-[1.02]'
                        }`}
                >
                    {uploading ? 'Uploading...' : 'Upload Data'}
                </button>
            </div>
        </div>
    );
};

export default UploadData;
