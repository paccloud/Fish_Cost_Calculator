import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X, Database, AlertCircle, CheckCircle, Download } from 'lucide-react';
import { useAuth } from '../context/useAuth';
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
                <div className="bg-surface border border-border p-8 rounded-full">
                    <Database size={48} className="text-text-secondary" />
                </div>
                <h2 className="text-2xl font-heading font-bold text-navy dark:text-text-primary">Login Required</h2>
                <p className="text-text-secondary max-w-md">
                    You need to be logged in to manage your custom yield data.
                </p>
                <Link to="/login" className="px-6 py-2 bg-rust text-white rounded-lg hover:bg-[#B8532A] dark:hover:bg-[#F07D4A] transition">
                    Go to Login
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 py-8">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-heading font-bold text-navy dark:text-text-primary flex items-center gap-3">
                        <Database className="text-teal" />
                        Manage Your Data
                    </h1>
                    <p className="text-text-secondary mt-2">
                        Add, edit, or delete your custom yield data • <Link to="/profile" className="text-teal hover:underline">Edit Contributor Profile</Link>
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
                        className="flex items-center gap-2 bg-rust hover:bg-[#B8532A] dark:hover:bg-[#F07D4A] text-white px-4 py-2 rounded-lg transition"
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
                <div className="bg-surface-elevated border border-border rounded-xl p-6 mb-8 shadow-md dark:shadow-none">
                    <h2 className="text-xl font-heading font-semibold text-navy dark:text-text-primary mb-4">
                        {editingId ? 'Edit Entry' : 'Add New Entry'}
                    </h2>
                    
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-2">Species Name</label>
                                <input
                                    type="text"
                                    value={formData.species}
                                    onChange={(e) => setFormData({...formData, species: e.target.value})}
                                    className="w-full bg-surface border border-border rounded-lg p-3 text-navy dark:text-text-primary focus:ring-2 focus:ring-teal outline-none"
                                    placeholder="e.g. Atlantic Salmon"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-2">Product/Conversion</label>
                                <input
                                    type="text"
                                    value={formData.product}
                                    onChange={(e) => setFormData({...formData, product: e.target.value})}
                                    className="w-full bg-surface border border-border rounded-lg p-3 text-navy dark:text-text-primary focus:ring-2 focus:ring-teal outline-none"
                                    placeholder="e.g. Skinless Fillet"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-2">Yield (%)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="100"
                                    value={formData.yield}
                                    onChange={(e) => setFormData({...formData, yield: e.target.value})}
                                    className="w-full bg-surface border border-border rounded-lg p-3 text-navy dark:text-text-primary focus:ring-2 focus:ring-teal outline-none"
                                    placeholder="e.g. 45"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-2">Source/Notes</label>
                                <input
                                    type="text"
                                    value={formData.source}
                                    onChange={(e) => setFormData({...formData, source: e.target.value})}
                                    className="w-full bg-surface border border-border rounded-lg p-3 text-navy dark:text-text-primary focus:ring-2 focus:ring-teal outline-none"
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
            <div className="bg-surface-elevated border border-border rounded-xl overflow-hidden shadow-md dark:shadow-none">
                <div className="p-4 border-b border-border">
                    <h2 className="text-lg font-heading font-semibold text-navy dark:text-text-primary">Your Custom Data</h2>
                </div>

                {loading ? (
                    <div className="p-8 text-center text-text-secondary">Loading...</div>
                ) : userData.length === 0 ? (
                    <div className="p-8 text-center text-text-secondary">
                        <Database size={48} className="mx-auto mb-4 opacity-50" />
                        <p>No custom data yet. Add your first entry above!</p>
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {userData.map((item) => (
                            <div key={item.id} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-white/5 transition">
                                <div>
                                    <p className="text-navy dark:text-text-primary font-medium">{item.species}</p>
                                    <p className="text-sm text-text-secondary">
                                        {item.product} → <span className="text-teal font-mono">{item.yield}%</span>
                                        {item.source && <span className="ml-2 text-text-secondary">({item.source})</span>}
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleEdit(item)}
                                        className="p-2 text-text-secondary hover:text-teal transition"
                                        title="Edit"
                                        aria-label={`Edit ${item.species} ${item.product}`}
                                    >
                                        <Edit2 size={18} />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(item.id)}
                                        className="p-2 text-text-secondary hover:text-red-400 transition"
                                        title="Delete"
                                        aria-label={`Delete ${item.species} ${item.product}`}
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
