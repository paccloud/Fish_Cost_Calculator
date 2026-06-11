/**
 * Handler core barrel — re-exports all transport-agnostic handlers.
 *
 * Import from here rather than individual handler files so that adding
 * a new handler is a one-line change in one place.
 *
 * @module shared/handlers
 */

export { handleRegister } from './register.js';
export { handleLogin } from './login.js';
export { handleListSavedCalcs, handleSaveCalc, handleDeleteCalc } from './savedCalcs.js';
export {
  handleListUserData,
  handleCreateUserData,
  handleUpdateUserData,
  handleDeleteUserData,
} from './userData.js';
export { handleUploadData } from './uploadData.js';
export { handleExport, sanitizeCsvValue } from './export.js';
export { handlePublicCalcs } from './publicCalcs.js';
export { handleFishData } from './fishData.js';
export {
  handleListContributors,
  handleGetContributor,
  handleSaveContributor,
} from './contributors.js';
