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

- A guest who clears browser data loses what they saved, as today.
- Unused anonymous accounts pile up and may need occasional cleanup.
- Only a non-anonymous account can share, so every shared yield has a real
  owner.
