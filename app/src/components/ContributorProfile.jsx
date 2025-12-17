import React, { useState, useEffect } from 'react';
import { User, Building2, FileText, Save, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { apiUrl } from '../config/api';

const ContributorProfile = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState(null);
    const [formData, setFormData] = useState({
        display_name: '',
        organization: '',
        bio: '',
        show_on_page: true
    });

    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        }

        // Load existing profile
        const token = localStorage.getItem('token');
        fetch(apiUrl('/api/contributor'), {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => {
            if (res.status === 404) {
                // No profile yet, that's okay
                setLoading(false);
                return null;
            }
            return res.json();
        })
        .then(data => {
            if (data) {
                setFormData({
                    display_name: data.display_name || '',
                    organization: data.organization || '',
                    bio: data.bio || '',
                    show_on_page: data.show_on_page === 1
                });
            }
            setLoading(false);
        })
        .catch(err => {
            console.error('Failed to load profile:', err);
            setLoading(false);
        });
    }, [user]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const token = localStorage.getItem('token');

        try {
            const res = await fetch(apiUrl('/api/contributor'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                setStatus({ type: 'success', message: 'Profile saved successfully!' });
                setTimeout(() => navigate('/manage-data'), 2000);
            } else {
                setStatus({ type: 'error', message: 'Failed to save profile.' });
            }
        } catch (error) {
            setStatus({ type: 'error', message: 'Error saving profile.' });
        }
    };

    if (!user) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
                <div className="bg-slate-100 dark:bg-slate-800 p-8 rounded-full">
                    <User size={48} className="text-slate-500 dark:text-gray-500" />
                </div>
                <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Login Required</h2>
                <p className="text-slate-600 dark:text-gray-400 max-w-md">
                    You need to be logged in to create a contributor profile.
                </p>
                <Link to="/login" className="text-cyan-600 dark:text-cyan-400 hover:underline">
                    Go to Login
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto px-4 py-8">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-800 dark:text-white flex items-center gap-3">
                    <User className="text-cyan-400" />
                    Contributor Profile
                </h1>
                <p className="text-slate-600 dark:text-gray-400 mt-2">
                    Share your information to be recognized on the Data Sources page
                </p>
            </div>

            {status && (
                <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
                    status.type === 'success'
                        ? 'bg-green-50 dark:bg-green-900/40 border border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-400'
                        : 'bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400'
                }`}>
                    {status.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
                    <p>{status.message}</p>
                </div>
            )}

            <form onSubmit={handleSubmit} className="bg-white dark:bg-white/10 backdrop-blur-lg rounded-xl p-8 border border-slate-200 dark:border-white/20 shadow-lg space-y-6">
                <div>
                    <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300 flex items-center gap-2">
                        <User size={16} />
                        Display Name *
                    </label>
                    <input
                        type="text"
                        value={formData.display_name}
                        onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                        className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-3 focus:ring-2 focus:ring-cyan-500 outline-none text-slate-800 dark:text-white"
                        placeholder="Your name"
                        required
                    />
                    <p className="mt-1 text-xs text-slate-500 dark:text-gray-500">
                        This is how your name will appear on the Data Sources page
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300 flex items-center gap-2">
                        <Building2 size={16} />
                        Organization
                    </label>
                    <input
                        type="text"
                        value={formData.organization}
                        onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
                        className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-3 focus:ring-2 focus:ring-cyan-500 outline-none text-slate-800 dark:text-white"
                        placeholder="Your organization (optional)"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300 flex items-center gap-2">
                        <FileText size={16} />
                        Bio
                    </label>
                    <textarea
                        value={formData.bio}
                        onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                        className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-3 focus:ring-2 focus:ring-cyan-500 outline-none text-slate-800 dark:text-white"
                        placeholder="Tell us about your expertise (max 200 characters)"
                        rows="3"
                        maxLength="200"
                    />
                    <p className="mt-1 text-xs text-slate-500 dark:text-gray-500 text-right">
                        {formData.bio.length}/200
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <input
                        type="checkbox"
                        id="show_on_page"
                        checked={formData.show_on_page}
                        onChange={(e) => setFormData({ ...formData, show_on_page: e.target.checked })}
                        className="w-4 h-4 text-cyan-600 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 rounded focus:ring-cyan-500"
                    />
                    <label htmlFor="show_on_page" className="text-sm text-slate-700 dark:text-gray-300">
                        Show my profile on the Data Sources page
                    </label>
                </div>

                <div className="flex gap-3 pt-4">
                    <button
                        type="submit"
                        className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold py-3 rounded-lg hover:from-cyan-400 hover:to-blue-500 transition shadow-lg"
                    >
                        <Save size={20} />
                        Save Profile
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/manage-data')}
                        className="px-6 py-3 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-gray-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-700 transition"
                    >
                        Cancel
                    </button>
                </div>
            </form>
        </div>
    );
};

export default ContributorProfile;
