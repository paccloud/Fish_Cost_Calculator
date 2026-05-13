import { useState, useEffect, useCallback } from 'react';
import { User, Building2, FileText, Save, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { apiUrl } from '../config/api';
import { stackClientApp } from '../config/neonAuth';

const ContributorProfile = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [status, setStatus] = useState(null);
    const [formData, setFormData] = useState({
        display_name: '',
        organization: '',
        bio: '',
        show_on_page: true
    });

    const getAuthHeaders = useCallback(async () => {
        const headers = { 'Content-Type': 'application/json' };

        if (user?.authProvider === 'oauth') {
            try {
                const stackUser = await stackClientApp.getUser();
                if (stackUser) {
                    const accessToken = await stackUser.getAuthJson();
                    if (accessToken?.accessToken) {
                        headers['x-stack-access-token'] = accessToken.accessToken;
                        return headers;
                    }
                }
            } catch (err) {
                console.error('Failed to get Stack Auth token:', err);
            }
        }

        const token = localStorage.getItem('token');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        return headers;
    }, [user]);

    useEffect(() => {
        if (!user) return;

        const loadProfile = async () => {
            try {
                const headers = await getAuthHeaders();
                const res = await fetch(apiUrl('/api/contributor/me'), { headers });

                if (res.status === 404) return;

                if (!res.ok) {
                    const rawError = await res.text().catch(() => '');
                    let message = `Unable to load your profile (HTTP ${res.status}). Please try again.`;

                    if (rawError) {
                        try {
                            const errorData = JSON.parse(rawError);
                            message = errorData?.error || errorData?.message || message;
                        } catch {
                            const trimmed = rawError.trim();
                            if (trimmed && trimmed.length <= 200 && !trimmed.includes('<')) {
                                message = trimmed;
                            }
                        }
                    }

                    setStatus({ type: 'error', message });
                    return;
                }

                const data = await res.json();
                if (data) {
                    setFormData({
                        display_name: data.display_name || '',
                        organization: data.organization || '',
                        bio: data.bio || '',
                        show_on_page: data.show_on_page === 1
                    });
                }
            } catch (err) {
                console.error('Failed to load profile:', err);
                setStatus({ type: 'error', message: 'Unable to load your profile. Please try again.' });
            }
        };

        loadProfile();
    }, [user, getAuthHeaders]);

    const handleSubmit = async (e) => {
        e.preventDefault();

        try {
            const headers = await getAuthHeaders();
            const res = await fetch(apiUrl('/api/contributor'), {
                method: 'POST',
                headers,
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                setStatus({ type: 'success', message: 'Profile saved successfully!' });
                setTimeout(() => navigate('/manage-data'), 2000);
            } else {
                const errorData = await res.json().catch(() => ({}));
                setStatus({
                    type: 'error',
                    message: errorData.error || 'Failed to save profile.'
                });
            }
        } catch (error) {
            console.error('Save profile error:', error);
            setStatus({ type: 'error', message: 'Error saving profile.' });
        }
    };

    if (!user) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
                <div className="bg-surface p-8 rounded-full">
                    <User size={40} className="text-text-secondary" />
                </div>
                <h2 className="text-xl font-bold text-brand-teal">Login Required</h2>
                <p className="text-text-secondary max-w-md text-sm">
                    You need to be logged in to create a contributor profile.
                </p>
                <Link to="/login" className="text-brand-terracotta hover:underline text-sm font-medium">
                    Go to Login
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto px-4 py-8">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-brand-teal flex items-center gap-3">
                    <User className="text-brand-terracotta" size={22} />
                    Contributor Profile
                </h1>
                <p className="text-text-secondary mt-1 text-sm">
                    Share your information to be recognized on the Data Sources page
                </p>
            </div>

            {status && (
                <div className={`mb-6 p-4 rounded flex items-center gap-3 text-sm ${
                    status.type === 'success'
                        ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-400'
                        : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400'
                }`}>
                    {status.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
                    <p>{status.message}</p>
                </div>
            )}

            <form onSubmit={handleSubmit} className="card p-8 space-y-5">
                <div>
                    <label className="form-label flex items-center gap-2">
                        <User size={14} />
                        Display Name *
                    </label>
                    <input
                        type="text"
                        value={formData.display_name}
                        onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                        className="form-input"
                        placeholder="Your name"
                        required
                    />
                    <p className="mt-1 text-xs text-text-secondary">
                        This is how your name will appear on the Data Sources page
                    </p>
                </div>

                <div>
                    <label className="form-label flex items-center gap-2">
                        <Building2 size={14} />
                        Organization
                    </label>
                    <input
                        type="text"
                        value={formData.organization}
                        onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
                        className="form-input"
                        placeholder="Your organization (optional)"
                    />
                </div>

                <div>
                    <label className="form-label flex items-center gap-2">
                        <FileText size={14} />
                        Bio
                    </label>
                    <textarea
                        value={formData.bio}
                        onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                        className="form-input"
                        placeholder="Tell us about your expertise (max 200 characters)"
                        rows="3"
                        maxLength="200"
                    />
                    <p className="mt-1 text-xs text-text-secondary text-right">
                        {formData.bio.length}/200
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <input
                        type="checkbox"
                        id="show_on_page"
                        checked={formData.show_on_page}
                        onChange={(e) => setFormData({ ...formData, show_on_page: e.target.checked })}
                        className="w-4 h-4 accent-brand-teal"
                    />
                    <label htmlFor="show_on_page" className="text-sm text-text-secondary">
                        Show my profile on the Data Sources page
                    </label>
                </div>

                <div className="flex gap-3 pt-2">
                    <button
                        type="submit"
                        className="flex-1 btn-primary flex items-center justify-center gap-2"
                    >
                        <Save size={16} />
                        Save Profile
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/manage-data')}
                        className="px-5 py-3 bg-surface border border-line text-text-secondary rounded hover:bg-surface-raised transition text-sm"
                    >
                        Cancel
                    </button>
                </div>
            </form>
        </div>
    );
};

export default ContributorProfile;
