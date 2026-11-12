import { useState, useEffect, useRef } from 'react';
import { Save, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { apiUrl } from '../config/api';
import { isAppReadOnly } from '../config/move';
import { DEFAULT_PROFILE_FORM, profileToFormData, buildProfilePayload } from '../lib/contributorProfile';

const TITLE = 'font-display text-3xl font-semibold text-text-primary';

// A load that works clears the message a failed load left, and nothing else.
const clearLoadError = (prev) => (prev?.source === 'load' ? null : prev);

const ContributorProfile = () => {
    const { user, getAuthHeaders } = useAuth();
    const navigate = useNavigate();
    const [status, setStatus] = useState(null);
    const [formData, setFormData] = useState({ ...DEFAULT_PROFILE_FORM });
    // Form is only editable/savable once the stored profile resolved (200 or
    // 404), so a failed or pending load can never overwrite stored consent.
    const [loaded, setLoaded] = useState(false);
    // Bumped by "Try again" after a failed load.
    const [loadAttempt, setLoadAttempt] = useState(0);
    const nameInputRef = useRef(null);
    const focusWhenLoaded = useRef(false);

    useEffect(() => {
        if (!user) return;

        const loadProfile = async () => {
            try {
                const headers = await getAuthHeaders();
                const res = await fetch(apiUrl('/api/contributor'), { headers });

                if (res.status === 404) {
                    setStatus(clearLoadError);
                    setLoaded(true);
                    return;
                }

                if (!res.ok) {
                    const rawError = await res.text().catch(() => '');
                    let message = `Your details didn’t load (HTTP ${res.status}). Try again.`;

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

                    setStatus({ type: 'error', source: 'load', message });
                    return;
                }

                const data = await res.json();
                if (data) {
                    setFormData(profileToFormData(data));
                }
                setStatus(clearLoadError);
                setLoaded(true);
            } catch (err) {
                console.error('Failed to load profile:', err);
                setStatus({ type: 'error', source: 'load', message: 'Your details didn’t load. Check your connection and try again.' });
            }
        };

        loadProfile();
    }, [user, getAuthHeaders, loadAttempt]);

    // "Try again" disappears once the details load, so put focus on the first field.
    useEffect(() => {
        if (loaded && focusWhenLoaded.current) {
            focusWhenLoaded.current = false;
            nameInputRef.current?.focus();
        }
    }, [loaded]);

    const handleSubmit = async (e) => {
        if (isAppReadOnly) { e.preventDefault(); return; }
        e.preventDefault();
        if (!loaded) return;

        try {
            const headers = await getAuthHeaders('application/json');
            const res = await fetch(apiUrl('/api/contributor'), {
                method: 'POST',
                headers,
                body: JSON.stringify(buildProfilePayload(formData))
            });

            if (res.ok) {
                setStatus({ type: 'success', message: 'Saved. Taking you back to My yields.' });
                setTimeout(() => navigate('/manage-data'), 2000);
            } else {
                const errorData = await res.json().catch(() => ({}));
                setStatus({
                    type: 'error',
                    message: errorData.error || 'Your details weren’t saved. Try again.'
                });
            }
        } catch (error) {
            console.error('Save profile error:', error);
            setStatus({ type: 'error', message: 'Your details didn’t reach the server. Check your connection and try again.' });
        }
    };

    if (!user) {
        return (
            <div className="mx-auto max-w-2xl">
                <header className="mb-8">
                    <h1 className={TITLE}>How your name appears</h1>
                </header>
                <section className="card p-5 sm:p-6">
                    <p className="text-base text-text-secondary">
                        Choosing the name shown beside the yields you share needs an account.
                    </p>
                    <Link to="/login" className="btn-primary mt-5">Sign in</Link>
                </section>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-2xl">
            <header className="mb-8">
                <h1 className={TITLE}>How your name appears</h1>
                <p className="mt-2 text-base text-text-secondary">
                    Share your information to be recognized on the Data sources page
                </p>
            </header>

            {status && (
                <div
                    role={status.type === 'success' ? 'status' : 'alert'}
                    className={`mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border bg-surface-raised p-4 ${
                        status.type === 'success' ? 'border-success' : 'border-danger'
                    }`}
                >
                    <p className="flex min-w-0 flex-1 basis-64 items-start gap-3 text-base text-text-primary">
                        {status.type === 'success'
                            ? <CheckCircle size={20} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                            : <AlertCircle size={20} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />}
                        <span className="min-w-0 break-words">{status.message}</span>
                    </p>
                    {status.source === 'load' && !loaded && (
                        <button
                            type="button"
                            onClick={() => { focusWhenLoaded.current = true; setLoadAttempt((n) => n + 1); }}
                            className="btn-secondary"
                        >
                            Try again
                        </button>
                    )}
                </div>
            )}

            <form onSubmit={handleSubmit} className="card space-y-5 p-5 sm:p-6">
              <fieldset disabled={!loaded || isAppReadOnly} className="m-0 min-w-0 space-y-5 border-0 p-0">
                <div>
                    <label htmlFor="profile-display-name" className="form-label">
                        Display name
                    </label>
                    <input
                        id="profile-display-name"
                        ref={nameInputRef}
                        type="text"
                        autoComplete="nickname"
                        value={formData.display_name}
                        onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                        className="form-input"
                        placeholder="Your name"
                        aria-describedby="profile-display-name-help"
                        required
                    />
                    <p id="profile-display-name-help" className="mt-1.5 text-sm text-text-muted">
                        Required. This is how your name will appear on the Data sources page.
                    </p>
                </div>

                <div>
                    <label htmlFor="profile-organization" className="form-label">
                        Organization (optional)
                    </label>
                    <input
                        id="profile-organization"
                        type="text"
                        autoComplete="organization"
                        value={formData.organization}
                        onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
                        className="form-input"
                        placeholder="Your organization"
                    />
                </div>

                <div>
                    <label htmlFor="profile-bio" className="form-label">
                        Bio (optional)
                    </label>
                    <textarea
                        id="profile-bio"
                        value={formData.bio}
                        onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                        className="form-input"
                        placeholder="Tell us about your expertise"
                        rows="3"
                        maxLength="200"
                        aria-describedby="profile-bio-help"
                    />
                    <p id="profile-bio-help" className="mt-1.5 text-sm tabular-nums text-text-muted">
                        {formData.bio.length} of 200 characters
                    </p>
                </div>

                <label htmlFor="show_on_page" className="flex min-h-[2.75rem] cursor-pointer items-center gap-3 text-base text-text-primary">
                    <input
                        type="checkbox"
                        id="show_on_page"
                        checked={formData.show_on_page}
                        onChange={(e) => setFormData({ ...formData, show_on_page: e.target.checked })}
                        className="h-6 w-6 shrink-0 accent-primary"
                    />
                    Show my name, organization and bio on the Data sources page
                </label>

              </fieldset>

                <div className="flex flex-wrap gap-3">
                    <button
                        type="submit"
                        disabled={!loaded || isAppReadOnly}
                        className="btn-primary flex-1"
                    >
                        <Save size={20} aria-hidden="true" />
                        Save changes
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/manage-data')}
                        className="btn-secondary"
                    >
                        Cancel
                    </button>
                </div>
            </form>
        </div>
    );
};

export default ContributorProfile;
