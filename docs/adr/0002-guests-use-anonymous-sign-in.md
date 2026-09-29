---
status: accepted
---

# Guests use Firebase anonymous sign-in

People should be able to save before deciding to sign up. Instead of keeping
guest data in the browser and copying it into an account with our own code, a
guest's first save signs them in anonymously; their data lives in Firestore
under the same rules as any account, and signing in with Google or email later
links to that same user so nothing is copied. People who only use the calculator
never get an account. Anonymous sign-in needs the network, so a save made
offline before the guest has a user is kept in the browser and written to
Firestore once sign-in succeeds.

## Consequences

- Guest data saved by the current app (in the browser, not Firestore) is not
  read by the new app. It moves over the existing way before the switch: the
  current app asks guests to sign in, its adoption code moves their records into
  the account, and they reach Firestore with the one-time copy from Neon (see
  ADR 0001). The old guest storage and adoption code are removed only after
  that.

- If the guest signs in with a Google account or email that already belongs to
  an account, Firebase cannot link it to the anonymous user. In that case the
  app reads the guest's custom yields and saved calculations while still signed
  in as the guest, signs in to the existing account, and writes them there. This
  copy is the one piece of guest-transfer code we keep.

- A guest who clears browser data loses what they saved, as today.
- Unused anonymous accounts pile up and may need occasional cleanup. Deleting an
  Auth user does not delete its Firestore documents, so cleanup removes the
  user's custom yields and saved calculations along with the user.
- Anonymous users can write to Firestore without a verified account, so the app
  uses App Check, and the rules cap the size and number of each user's records.
  A budget alert on the Firebase project flags unusual use.
- Only a non-anonymous account can submit yields to the community dataset, so
  every submitted yield has a real owner.
