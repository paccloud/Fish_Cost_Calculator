# Runbook: moving the old app off Vercel and Neon

This is the old-app side of the move to Firebase ([ADR 0001](adr/0001-firebase-auth-and-firestore.md), issue #130). Each step is one setting, and each is off by default.

| Step | Setting | Where | What changes |
|---|---|---|---|
| 1. Notice | `VITE_MOVE_STAGE=notice` | Vercel build env, then redeploy | A banner announces the move. Guests with saved data are asked to sign in, and the existing adoption code moves their records into the account. Signed-in users see how many changes haven't synced, and the browser warns before they leave with changes pending. |
| 2. Read-only app | `VITE_MOVE_STAGE=read-only` | Vercel build env, then redeploy | As in step 1, plus no new edits: saving, importing, editing, deleting, sharing and publishing are disabled. Changes already pending still sync. The banner offers **Save my unsent changes**, which downloads a file the new app's import accepts (#127). |
| 3. API freeze | `API_READ_ONLY=true` | Vercel env (and `server/.env` locally), then redeploy | Both backends answer every write with `503` and `{"error":"read_only"}`. Reads and sign-in keep working, and so does the **Save my unsent changes** button. Signing in no longer creates, links or updates users. |

Set `VITE_NEW_APP_URL` once the new address is known, so the banner links to it.

## Timing

- Leave step 1 up long enough for guests to see it (at least one week of normal use).
- Step 2 goes out once the new app can import the unsent-changes file.
- **Waiting period before step 3: 14 days after step 2.** The server can't see a device that is offline, so "everything has synced" can't be observed. The waiting period gives installed copies time to come online, pick up the read-only release and sync. The installed app uses `registerType: 'autoUpdate'`, so it updates on its next load.
- After step 3, run the one-time copy from Neon (#131). The old address then keeps serving the read-only app for six months (#132) before it becomes a redirect.

## The unsent-changes file

```json
{
  "format": "local-catch-unsent-changes",
  "version": 1,
  "exportedAt": "2026-10-01T12:00:00.000Z",
  "customYields": [
    { "id": "…", "species": "Cod", "product": "Fillet", "yield": 42, "source": "Me", "createdAt": "…", "updatedAt": "…" }
  ],
  "savedCalculations": [
    { "id": "…", "species": "Tuna", "product": "Steak", "cost": 9, "yield": 60, "result": 15, "…": "other calculator inputs" }
  ],
  "pendingDeletes": {
    "customYields": [{ "id": 9, "species": "Cod", "product": "Loin" }],
    "savedCalculations": []
  }
}
```

- `customYields` and `savedCalculations` hold records that never reached the server: the signed-in user's pending changes and anything saved on the device as a guest. Sync bookkeeping fields are removed.
- `yield` is a percentage above 0 and up to 100. `product` is the finished product only; the old app never recorded the starting form.
- `pendingDeletes` lists deletions that never reached the server. The Neon copy still contains these records, so the new app should show them so the owner can delete them again.
