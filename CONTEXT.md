# Local Catch

A yield and cost calculator for fishermen and fishmongers. It turns what a fish
costs whole into what each finished product really costs, and lets people keep
and share the yields they measure themselves.

## Language

### Yields and costs

**Conversion**:
Going from one form of a fish to another, written `From → To` (e.g.
`Round → Skinless Fillet`).
_Avoid_: cut, transformation

**Yield**:
The share of weight kept by a conversion, as a percentage above 0 and up to 100.
_Avoid_: recovery rate, fraction (0.42)

**Reference yield**:
A published yield from the MAB-37 research that ships with the app.
_Avoid_: default yield, static data

**Custom yield**:
A yield a person measured from their own processing. Private unless approved
into the community dataset.
_Avoid_: user data, my data

**Saved calculation**:
A cost or weight calculation a person chose to keep.
_Avoid_: calc, saved calc

### People and the community dataset

**Account**:
An optional sign-in that exists for two reasons only: keeping a person's custom
yields and saved calculations across devices, and submitting custom yields to
the community dataset. A reviewer's account can also review submitted yields.
_Avoid_: user, profile

**Guest**:
Someone using the app without signing in. A guest can save, but loses what they
saved if they clear their browser data, and cannot submit yields.
_Avoid_: anonymous user

**Submitted yield**:
A custom yield its owner has asked to add to the community dataset. It stays
private until a reviewer approves it. A rejected yield goes back to private,
where its owner can fix it and submit it again. Editing an approved yield takes
it out of the dataset and submits it again.
_Avoid_: shared yield, published yield, contribution

**Review note**:
An optional message from the reviewer to a yield's owner saying why it was
rejected. Only the owner sees it.
_Avoid_: rejection reason, feedback

**Reviewer**:
An account that has been granted the right to approve or reject submitted
yields. Being signed in is not enough.
_Avoid_: admin, moderator

**Community dataset**:
All approved yields, readable and downloadable by anyone under CC BY 4.0,
attributed only by display name or as "Anonymous".
_Avoid_: community pool, public data

**Display name**:
The only public identity a person has. Optional, chosen by them, never their
email.
_Avoid_: username, contributor name

_Dropped concepts_: contributor profile (bio/organization pages) and publishing
saved calculations publicly. Neither is one of an account's two jobs.
