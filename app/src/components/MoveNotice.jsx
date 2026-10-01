import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { isMoveNoticeOn, NEW_APP_URL } from '../config/move';

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

// Banner for the move to Firebase (issue #130). Shown only while
// VITE_MOVE_STAGE is "notice" or "read-only".
export default function MoveNotice() {
  const { user } = useAuth();
  const { readOnly, accountUnsentCount, unsentCount, saveUnsentChanges, savedCalcs, customYields, dataLoaded } = useData();

  const [exportError, setExportError] = useState(null);

  if (!isMoveNoticeOn) return null;

  const handleSave = async () => {
    setExportError(null);
    try {
      await saveUnsentChanges();
    } catch (err) {
      console.warn('Saving unsent changes failed:', err);
      setExportError('Your unsent changes couldn’t be saved to a file. Please try again.');
    }
  };

  const guestRecords = user ? 0 : savedCalcs.length + customYields.length;
  const newAddress = NEW_APP_URL ? (
    <a href={NEW_APP_URL} className="font-semibold underline underline-offset-2">
      {NEW_APP_URL.replace(/^https?:\/\//, '')}
    </a>
  ) : 'a new address';

  return (
    <section
      aria-labelledby="move-notice-title"
      className="border-b border-line bg-surface-raised px-4 py-3 text-sm text-text-primary"
    >
      <div className="mx-auto max-w-5xl space-y-1.5">
        <h2 id="move-notice-title" className="font-semibold">
          Local Catch is moving to {newAddress}.
        </h2>
        {readOnly && (
          <p>
            This version is read-only while we move. You can still use the calculator and look at your data,
            but new changes can&apos;t be saved here.
          </p>
        )}
        {dataLoaded && guestRecords > 0 && (
          <p>
            You have {plural(guestRecords, 'item', 'items')} saved on this device without an account.{' '}
            <Link to="/login" className="font-semibold underline underline-offset-2">Sign in</Link>{' '}
            so {guestRecords === 1 ? 'it comes' : 'they come'} with you.
          </p>
        )}
        {user && accountUnsentCount > 0 && (
          <p>
            {plural(accountUnsentCount, 'change hasn’t', 'changes haven’t')} synced yet. Keep this page open and
            online until it finishes.
          </p>
        )}
        {readOnly && unsentCount > 0 && (
          <p className="flex flex-wrap items-center gap-2">
            <span>
              {plural(unsentCount, 'change', 'changes')} on this device {unsentCount === 1 ? 'hasn’t' : 'haven’t'} reached
              the server. Save {unsentCount === 1 ? 'it' : 'them'} to a file you can import into the new app.
            </span>
            <button type="button" onClick={handleSave} className="btn-secondary">
              Save my unsent changes
            </button>
          </p>
        )}
        {exportError && (
          <p role="alert" className="font-semibold text-danger">{exportError}</p>
        )}
      </div>
    </section>
  );
}
