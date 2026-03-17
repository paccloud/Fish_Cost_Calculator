import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X, Database, AlertCircle, CheckCircle, Download, Share2, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { apiUrl } from '../config/api';

const DataManagement = () => {
    const { user } = useAuth();
    const [userData, setUserData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);

    const [formData, setFormData] = useState({
        species: '',
        product: '',
        yield: '',
        source: 'User Input'
    });

    useEffect(() => {
        if (user) {
            loadUserData();
        } else {
            setLoading(false);
        }
    }, [user]);

    const loadUserData = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(apiUrl('/api/user-data'), {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (Array.isArray(data)) {
                setUserData(data);
            }
        } catch (e) {
            console.error('Failed to load user data:', e);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleShare = async (item) => {
        const token = localStorage.getItem('token');
        const action = item.is_shared ? 'unshare' : 'share';
        try {
            const res = await fetch(apiUrl(`/api/user-data/${item.id}/${action}`), {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                setStatus({ type: 'success', message: action === 'share' ? 'Shared with community!' : 'Removed from community.' });
                loadUserData();
            } else {
                const err = await res.json();
                setStatus({ type: 'error', message: err.error || 'Failed to update sharing.' });
            }
        } catch (e) {
            setStatus({ type: 'error', message: 'Network error occurred.' });
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        const token = localStorage.getItem('token');
        const endpoint = editingId
            ? apiUrl(`/api/user-data/${editingId}`)
            : apiUrl('/api/user-data');
        const method = editingId ? 'PUT' : 'POST';

        try {
            const res = await fetch(endpoint, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    species: formData.species,
                    product: formData.product,
                    yield: parseFloat(formData.yield),
                    source: formData.source
                })
            });

            if (res.ok) {
                setStatus({ type: 'success', message: editingId ? 'Updated successfully!' : 'Added successfully!' });
                resetForm();
                loadUserData();
            } else {
                const err = await res.json();
                setStatus({ type: 'error', message: err.error || 'Operation failed.' });
            }
        } catch (e) {
            setStatus({ type: 'error', message: 'Network error occurred.' });
        }
    };

    const handleEdit = (item) => {
        setFormData({
            species: item.species,
            product: item.product,
            yield: String(item.yield),
            source: item.source || 'User Input'
        });
        setEditingId(item.id);
        setShowForm(true);
    };

    const handleDelete = async (id) => {
        if (!confirm('Are you sure you want to delete this entry?')) return;

        try {
            const token = localStorage.getItem('token');
            const res = await fetch(apiUrl(`/api/user-data/${id}`), {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                setStatus({ type: 'success', message: 'Deleted successfully!' });
                loadUserData();
            } else {
                setStatus({ type: 'error', message: 'Failed to delete.' });
            }
        } catch (e) {
            setStatus({ type: 'error', message: 'Network error occurred.' });
        }
    };

    const resetForm = () => {
        setFormData({ species: '', product: '', yield: '', source: 'User Input' });
        setEditingId(null);
        setShowForm(false);
    };

    if (!user) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
                <div className="bg-[#f0ebe4] dark:bg-white/8 p-8 rounded-full">
                    <Database size={40} className="text-[#4a6572] dark:text-[#8fa8b2]" />
                </div>
                <h2 className="text-xl font-bold text-brand-teal dark:text-[#e8ddd4]">Login Required</h2>
                <p className="text-[#4a6572] dark:text-[#8fa8b2] max-w-md text-sm">
                    You need to be logged in to manage your custom yield data.
                </p>
                <Link to="/login" className="px-6 py-2 bg-brand-teal hover:bg-brand-teal-light text-white rounded transition text-sm font-medium">
                    Go to Login
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 py-8">
            <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-brand-teal dark:text-[#e8ddd4] flex items-center gap-3">
                        <Database className="text-brand-terracotta" size={22} />
                        Manage Your Data
                    </h1>
                    <p className="text-[#4a6572] dark:text-[#8fa8b2] mt-1 text-sm">
                        Add, edit, or delete your custom yield data •{' '}
                        <Link to="/profile" className="text-brand-terracotta hover:underline">Edit Contributor Profile</Link>
                    </p>
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={async () => {
                            const token = localStorage.getItem('token');
                            try {
                                const response = await fetch(apiUrl('/api/export?type=data'), {
                                    headers: { 'Authorization': `Bearer ${token}` }
                                });
                                const blob = await response.blob();
                                const url = window.URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = 'custom-yield-data.csv';
                                document.body.appendChild(a);
                                a.click();
                                window.URL.revokeObjectURL(url);
                                document.body.removeChild(a);
                            } catch (error) {
                                console.error('Export failed:', error);
                            }
                        }}
                        className="flex items-center gap-2 bg-[#4a6572] hover:bg-[#3a5260] text-white px-4 py-2 rounded transition disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                        disabled={userData.length === 0}
                    >
                        <Download size={16} />
                        Export CSV
                    </button>
                    <button
                        onClick={() => setShowForm(!showForm)}
                        className="flex items-center gap-2 bg-brand-teal hover:bg-brand-teal-light text-white px-4 py-2 rounded transition text-sm font-medium"
                    >
                        <Plus size={16} />
                        Add Entry
                    </button>
                </div>
            </div>

            {/* Status Message */}
            {status && (
                <div className={`mb-6 p-4 rounded flex items-center gap-3 text-sm ${
                    status.type === 'success'
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-500/30'
                        : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-500/30'
                }`}>
                    {status.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
                    {status.message}
                    <button onClick={() => setStatus(null)} className="ml-auto">
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* Add/Edit Form */}
            {showForm && (
                <div className="bg-white dark:bg-white/5 border border-[#d6ccc4] dark:border-white/15 rounded-lg p-6 mb-8 shadow-sm">
                    <h2 className="text-lg font-semibold text-brand-teal dark:text-[#e8ddd4] mb-4">
                        {editingId ? 'Edit Entry' : 'Add New Entry'}
                    </h2>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-[#4a6572] dark:text-[#8fa8b2] mb-2">Species Name</label>
                                <input
                                    type="text"
                                    value={formData.species}
                                    onChange={(e) => setFormData({...formData, species: e.target.value})}
                                    className="w-full bg-[#f0ebe4] dark:bg-white/8 border border-[#d6ccc4] dark:border-white/15 rounded p-3 text-[#1a2e35] dark:text-[#e8ddd4] focus:ring-2 focus:ring-brand-teal outline-none text-sm"
                                    placeholder="e.g. Atlantic Salmon"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[#4a6572] dark:text-[#8fa8b2] mb-2">Product/Conversion</label>
                                <input
                                    type="text"
                                    value={formData.product}
                                    onChange={(e) => setFormData({...formData, product: e.target.value})}
                                    className="w-full bg-[#f0ebe4] dark:bg-white/8 border border-[#d6ccc4] dark:border-white/15 rounded p-3 text-[#1a2e35] dark:text-[#e8ddd4] focus:ring-2 focus:ring-brand-teal outline-none text-sm"
                                    placeholder="e.g. Skinless Fillet"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[#4a6572] dark:text-[#8fa8b2] mb-2">Yield (%)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="100"
                                    value={formData.yield}
                                    onChange={(e) => setFormData({...formData, yield: e.target.value})}
                                    className="w-full bg-[#f0ebe4] dark:bg-white/8 border border-[#d6ccc4] dark:border-white/15 rounded p-3 text-[#1a2e35] dark:text-[#e8ddd4] focus:ring-2 focus:ring-brand-teal outline-none text-sm"
                                    placeholder="e.g. 45"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[#4a6572] dark:text-[#8fa8b2] mb-2">Source/Notes</label>
                                <input
                                    type="text"
                                    value={formData.source}
                                    onChange={(e) => setFormData({...formData, source: e.target.value})}
                                    className="w-full bg-[#f0ebe4] dark:bg-white/8 border border-[#d6ccc4] dark:border-white/15 rounded p-3 text-[#1a2e35] dark:text-[#e8ddd4] focus:ring-2 focus:ring-brand-teal outline-none text-sm"
                                    placeholder="e.g. Personal experience"
                                />
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                type="submit"
                                className="flex items-center gap-2 bg-brand-teal hover:bg-brand-teal-light text-white px-4 py-2 rounded transition text-sm font-medium"
                            >
                                <Save size={16} />
                                {editingId ? 'Update' : 'Save'}
                            </button>
                            <button
                                type="button"
                                onClick={resetForm}
                                className="flex items-center gap-2 bg-[#ede7e0] dark:bg-white/10 hover:bg-[#d6ccc4] dark:hover:bg-white/15 text-[#4a6572] dark:text-[#8fa8b2] px-4 py-2 rounded transition text-sm font-medium"
                            >
                                <X size={16} />
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Data List */}
            <div className="bg-white dark:bg-white/5 border border-[#d6ccc4] dark:border-white/10 rounded-lg overflow-hidden shadow-sm">
                <div className="p-4 border-b border-[#d6ccc4] dark:border-white/10">
                    <h2 className="text-base font-semibold text-brand-teal dark:text-[#e8ddd4]">Your Custom Data</h2>
                </div>

                {loading ? (
                    <div className="p-8 text-center text-[#4a6572] dark:text-[#8fa8b2]">Loading...</div>
                ) : userData.length === 0 ? (
                    <div className="p-8 text-center text-[#4a6572] dark:text-[#8fa8b2]">
                        <Database size={40} className="mx-auto mb-4 opacity-30" />
                        <p>No custom data yet. Add your first entry above!</p>
                    </div>
                ) : (
                    <div className="divide-y divide-[#ede7e0] dark:divide-white/5">
                        {userData.map((item) => (
                            <div key={item.id} className="p-4 flex items-center justify-between hover:bg-[#f5f0eb] dark:hover:bg-white/5 transition">
                                <div>
                                    <p className="text-[#1a2e35] dark:text-[#e8ddd4] font-medium flex items-center gap-2 text-sm">
                                        {item.species}
                                        {item.is_shared ? (
                                            <span className="text-xs bg-brand-teal/10 text-brand-teal dark:text-brand-yellow border border-brand-teal/20 px-2 py-0.5 rounded-full">Shared</span>
                                        ) : null}
                                    </p>
                                    <p className="text-sm text-[#4a6572] dark:text-[#8fa8b2]">
                                        {item.product} → <span className="text-brand-teal dark:text-brand-yellow font-medium">{item.yield}%</span>
                                        {item.source && <span className="ml-2 text-[#4a6572]/60 dark:text-[#8fa8b2]/60">({item.source})</span>}
                                    </p>
                                </div>
                                <div className="flex gap-1">
                                    <button
                                        onClick={() => handleToggleShare(item)}
                                        className={`p-2 rounded transition ${item.is_shared ? 'text-brand-teal dark:text-brand-yellow hover:text-[#4a6572]' : 'text-[#4a6572] dark:text-[#8fa8b2] hover:text-brand-teal'}`}
                                        title={item.is_shared ? 'Remove from community' : 'Share with community'}
                                    >
                                        {item.is_shared ? <EyeOff size={16} /> : <Share2 size={16} />}
                                    </button>
                                    <button
                                        onClick={() => handleEdit(item)}
                                        className="p-2 rounded text-[#4a6572] dark:text-[#8fa8b2] hover:text-brand-teal transition"
                                        title="Edit"
                                    >
                                        <Edit2 size={16} />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(item.id)}
                                        className="p-2 rounded text-[#4a6572] dark:text-[#8fa8b2] hover:text-red-500 transition"
                                        title="Delete"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default DataManagement;
