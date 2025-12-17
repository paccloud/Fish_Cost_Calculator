import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X, Database, AlertCircle, CheckCircle, Download } from 'lucide-react';
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

    // Load user's custom data
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
                <div className="bg-slate-100 dark:bg-slate-800 p-8 rounded-full">
                    <Database size={48} className="text-slate-500 dark:text-gray-500" />
                </div>
                <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Login Required</h2>
                <p className="text-slate-600 dark:text-gray-400 max-w-md">
                    You need to be logged in to manage your custom yield data.
                </p>
                <Link to="/login" className="px-6 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition">
                    Go to Login
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 py-8">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-slate-800 dark:text-white flex items-center gap-3">
                        <Database className="text-cyan-400" />
                        Manage Your Data
                    </h1>
                    <p className="text-slate-600 dark:text-gray-400 mt-2">
                        Add, edit, or delete your custom yield data • <Link to="/profile" className="text-cyan-600 dark:text-cyan-400 hover:underline">Edit Contributor Profile</Link>
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
                        className="flex items-center gap-2 bg-slate-600 hover:bg-slate-500 text-white px-4 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={userData.length === 0}
                    >
                        <Download size={20} />
                        Export CSV
                    </button>
                    <button
                        onClick={() => setShowForm(!showForm)}
                        className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg transition"
                    >
                        <Plus size={20} />
                        Add Entry
                    </button>
                </div>
            </div>

            {/* Status Message */}
            {status && (
                <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
                    status.type === 'success' 
                        ? 'bg-green-900/40 text-green-300 border border-green-500/30' 
                        : 'bg-red-900/40 text-red-300 border border-red-500/30'
                }`}>
                    {status.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
                    {status.message}
                    <button onClick={() => setStatus(null)} className="ml-auto">
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* Add/Edit Form */}
            {showForm && (
                <div className="bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-white/10 rounded-xl p-6 mb-8 shadow-md dark:shadow-none">
                    <h2 className="text-xl font-semibold text-slate-800 dark:text-white mb-4">
                        {editingId ? 'Edit Entry' : 'Add New Entry'}
                    </h2>
                    
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-600 dark:text-gray-300 mb-2">Species Name</label>
                                <input
                                    type="text"
                                    value={formData.species}
                                    onChange={(e) => setFormData({...formData, species: e.target.value})}
                                    className="w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg p-3 text-slate-800 dark:text-white focus:ring-2 focus:ring-cyan-500 outline-none"
                                    placeholder="e.g. Atlantic Salmon"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-600 dark:text-gray-300 mb-2">Product/Conversion</label>
                                <input
                                    type="text"
                                    value={formData.product}
                                    onChange={(e) => setFormData({...formData, product: e.target.value})}
                                    className="w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg p-3 text-slate-800 dark:text-white focus:ring-2 focus:ring-cyan-500 outline-none"
                                    placeholder="e.g. Skinless Fillet"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-600 dark:text-gray-300 mb-2">Yield (%)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="100"
                                    value={formData.yield}
                                    onChange={(e) => setFormData({...formData, yield: e.target.value})}
                                    className="w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg p-3 text-slate-800 dark:text-white focus:ring-2 focus:ring-cyan-500 outline-none"
                                    placeholder="e.g. 45"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-600 dark:text-gray-300 mb-2">Source/Notes</label>
                                <input
                                    type="text"
                                    value={formData.source}
                                    onChange={(e) => setFormData({...formData, source: e.target.value})}
                                    className="w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg p-3 text-slate-800 dark:text-white focus:ring-2 focus:ring-cyan-500 outline-none"
                                    placeholder="e.g. Personal experience"
                                />
                            </div>
                        </div>
                        
                        <div className="flex gap-3">
                            <button
                                type="submit"
                                className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg transition"
                            >
                                <Save size={18} />
                                {editingId ? 'Update' : 'Save'}
                            </button>
                            <button
                                type="button"
                                onClick={resetForm}
                                className="flex items-center gap-2 bg-slate-600 hover:bg-slate-500 text-white px-4 py-2 rounded-lg transition"
                            >
                                <X size={18} />
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Data List */}
            <div className="bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden shadow-md dark:shadow-none">
                <div className="p-4 border-b border-slate-200 dark:border-white/10">
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Your Custom Data</h2>
                </div>

                {loading ? (
                    <div className="p-8 text-center text-slate-600 dark:text-gray-400">Loading...</div>
                ) : userData.length === 0 ? (
                    <div className="p-8 text-center text-slate-600 dark:text-gray-400">
                        <Database size={48} className="mx-auto mb-4 opacity-50" />
                        <p>No custom data yet. Add your first entry above!</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-200 dark:divide-white/5">
                        {userData.map((item) => (
                            <div key={item.id} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-white/5 transition">
                                <div>
                                    <p className="text-slate-800 dark:text-white font-medium">{item.species}</p>
                                    <p className="text-sm text-slate-600 dark:text-gray-400">
                                        {item.product} → <span className="text-cyan-400">{item.yield}%</span>
                                        {item.source && <span className="ml-2 text-slate-500 dark:text-gray-500">({item.source})</span>}
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleEdit(item)}
                                        className="p-2 text-slate-600 dark:text-gray-400 hover:text-cyan-400 transition"
                                        title="Edit"
                                    >
                                        <Edit2 size={18} />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(item.id)}
                                        className="p-2 text-slate-600 dark:text-gray-400 hover:text-red-400 transition"
                                        title="Delete"
                                    >
                                        <Trash2 size={18} />
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
