import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, ArrowRight, Download, X, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { apiUrl } from '../config/api';
import { isAppReadOnly } from '../config/move';

const TEMPLATE_CSV = `Species,% Yield,Product,Source\nAtlantic Salmon,45,Skinless Fillet,\nHalibut,38,Steak,\nDungeness Crab,25,Picked Meat,\n`;

const TITLE = 'font-display text-3xl font-semibold text-text-primary';

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const UploadData = () => {
  const { user, getAuthHeaders } = useAuth();
  const { isOnline, retrySync } = useData();
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState(null);
  const fileInputRef = useRef(null);
  // "Remove file" disappears with the file, so hand focus to the button beside it.
  const chooseButtonRef = useRef(null);
  const hadFile = useRef(false);
  useEffect(() => {
    if (hadFile.current && !file) chooseButtonRef.current?.focus();
    hadFile.current = Boolean(file);
  }, [file]);

  const acceptFile = (f) => {
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'csv'].includes(ext)) {
      setStatus({ type: 'error', message: 'That file type isn’t supported. Choose an .xlsx or .csv file.' });
      return;
    }
    setFile(f);
    setStatus(null);
  };

  const handleFileChange = (e) => {
    if (e.target.files?.[0]) acceptFile(e.target.files[0]);
    // Clear the picker so choosing the same file again after removing it still registers
    e.target.value = '';
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    acceptFile(e.dataTransfer.files?.[0]);
  }, []);

  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);

  const handleUpload = async () => {
    if (isAppReadOnly) return;
    if (!file || !user || !isOnline) return;

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
        setFile(null);
        // Pull imported records into the active local scope before showing
        // success so the data is visible when the user navigates to /manage-data.
        await retrySync();
        setStatus({ type: 'success', data });
      } else {
        setStatus({ type: 'error', message: data.error || 'The upload didn’t go through. Try again.' });
      }
    } catch {
      setStatus({ type: 'error', message: 'The upload didn’t reach the server. Check your connection and try again.' });
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
      <div className="mx-auto max-w-2xl">
        <header className="mb-8">
          <h1 className={TITLE}>Upload yields</h1>
        </header>
        <section className="card p-5 sm:p-6">
          <p className="text-base text-text-secondary">
            Uploading a spreadsheet of your own yields needs an account, which keeps them on every device.
          </p>
          <Link to="/login" className="btn-primary mt-5">Sign in</Link>
        </section>
      </div>
    );
  }

  const counts = status?.type === 'success'
    ? [
        [status.data.inserted, 'added'],
        [status.data.updated, 'updated'],
        [status.data.skipped, 'skipped'],
      ].filter(([count]) => count > 0)
    : [];

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-8">
        <h1 className={TITLE}>Upload yields</h1>
        <p className="mt-2 text-base text-text-secondary">
          Upload a spreadsheet with columns <strong className="text-text-primary">Species</strong> and <strong className="text-text-primary">% Yield</strong>.
          Optionally include <strong className="text-text-primary">Product</strong> and <strong className="text-text-primary">Source</strong> columns.
        </p>
        <button
          type="button"
          onClick={downloadTemplate}
          className="btn-ghost -mx-3 mt-1 text-base"
          title="Download a template CSV"
        >
          <Download size={20} aria-hidden="true" />
          Download a template
        </button>
      </header>

      <section className="card space-y-5 p-5 sm:p-6" aria-label="Upload a spreadsheet">
        {!isOnline && (
          <p className="flex items-start gap-3 rounded-lg border border-line-strong p-4 text-base text-text-primary">
            <WifiOff size={20} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden="true" />
            <span>You’re offline. Uploading needs a connection.</span>
          </p>
        )}

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`rounded-lg border-2 border-dashed p-5 transition-colors ${
            dragOver ? 'border-accent bg-surface' : 'border-line-strong'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx, .csv"
            onChange={handleFileChange}
            className="hidden"
            id="file-upload"
            tabIndex={-1}
          />
          {file ? (
            <p className="flex items-start gap-3">
              <FileText size={24} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block break-words text-base font-semibold text-text-primary">{file.name}</span>
                <span className="block text-sm text-text-secondary">{formatBytes(file.size)}</span>
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-3">
              <Upload size={24} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden="true" />
              <span>
                <span className="block text-base font-semibold text-text-primary">
                  {dragOver ? 'Drop it here' : 'Drop a spreadsheet here, or choose one'}
                </span>
                <span className="block text-sm text-text-secondary">.xlsx or .csv, up to 4 MB</span>
              </span>
            </p>
          )}
          <div className="mt-4 flex flex-col items-start gap-1">
            <button
              ref={chooseButtonRef}
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn-secondary"
            >
              {file ? 'Choose a different file' : 'Choose a file'}
            </button>
            {file && (
              <button
                type="button"
                onClick={() => { setFile(null); setStatus(null); }}
                className="btn-ghost -mx-3 text-base"
              >
                <X size={20} aria-hidden="true" /> Remove file
              </button>
            )}
          </div>
        </div>

        {/* Results */}
        {status?.type === 'success' && (
          <div role="status" className="rounded-lg border border-success p-4">
            <p className="flex items-center gap-2 text-base font-semibold text-success">
              <CheckCircle size={20} className="shrink-0" aria-hidden="true" />
              Import complete
            </p>
            {counts.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
                {counts.map(([count, word]) => (
                  <li key={word} className="text-base text-text-secondary">
                    <span className="mr-1.5 text-2xl font-extrabold tabular-nums text-text-primary">{count}</span>
                    {word}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-base text-text-secondary">
                No rows could be read from that file. Check it has Species and % Yield columns, like the template.
              </p>
            )}
            {status.data.skipped > 0 && status.data.skippedRows?.length > 0 && (
              <p className="mt-2 text-sm text-text-secondary">
                Rows skipped (missing species or invalid yield %): rows {status.data.skippedRows.join(', ')}
              </p>
            )}
            <Link to="/manage-data" className="btn-ghost -mx-3 mt-1 text-base">
              View my yields <ArrowRight size={20} aria-hidden="true" />
            </Link>
          </div>
        )}

        {status?.type === 'error' && (
          <p role="alert" className="flex items-start gap-3 rounded-lg border border-danger p-4 text-base font-semibold text-danger">
            <AlertCircle size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{status.message}</span>
          </p>
        )}

        <button
          type="button"
          onClick={handleUpload}
          disabled={!file || uploading || !isOnline || isAppReadOnly}
          className="btn-primary w-full"
        >
          {uploading ? 'Uploading…' : 'Upload file'}
        </button>
      </section>
    </div>
  );
};

export default UploadData;
