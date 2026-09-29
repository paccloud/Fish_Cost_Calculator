---
status: accepted
---

# Guests use Firebase anonymous sign-in

People should be able to save before deciding to sign up. Instead of keeping
guest data in the browser and copying it into an account with our own code, a
guest's first save signs them in anonymously; their data lives in Firestore
under the same rules as any account, and signing in with Google or email later
links to that same user so nothing is copied. People who only use the
calculator never get an account.

## Consequences

- If the guest signs in with a Google account or email that already belongs to
  an account, Firebase cannot link it to the anonymous user. In that case the
  app reads the guest's custom yields and saved calculations while still signed
  in as the guest, signs in to the existing account, and writes them there.
  This copy is the one piece of guest-transfer code we keep.

- A guest who clears browser data loses what they saved, as today.
- Unused anonymous accounts pile up and may need occasional cleanup.
- Only a non-anonymous account can submit yields to the community dataset, so
  every submitted yield has a real owner.
