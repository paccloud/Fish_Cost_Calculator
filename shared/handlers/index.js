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
  handleGetContributorProfile,
  handleGetFishData,
  handleListContributors,
  handleListPublicCalcs,
  handleSaveContributorProfile,
} from './publicEndpoints.js';
