// The move to Firebase (ADR 0001, issue #130) happens in stages, set at build
// time with VITE_MOVE_STAGE:
//   off        normal app (default)
//   notice     banner about the move; guests are asked to sign in, and leaving
//              with unsynced changes is warned about
//   read-only  as notice, plus no new edits; pending changes still sync and
//              unsent changes can be saved to a file
const STAGES = new Set(['off', 'notice', 'read-only']);

export function parseMoveStage(value) {
  const stage = String(value ?? '').trim().toLowerCase();
  return STAGES.has(stage) ? stage : 'off';
}

export const MOVE_STAGE = parseMoveStage(import.meta.env.VITE_MOVE_STAGE);
export const isMoveNoticeOn = MOVE_STAGE !== 'off';
export const isAppReadOnly = MOVE_STAGE === 'read-only';
// Where the new app lives, shown in the banner once known.
export const NEW_APP_URL = String(import.meta.env.VITE_NEW_APP_URL ?? '').trim();
