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
A yield a person measured from their own processing. Private unless shared.
_Avoid_: user data, my data

**Saved calculation**:
A cost or weight calculation a person chose to keep.
_Avoid_: calc, saved calc

### People and sharing

**Account**:
An optional sign-in that exists for two reasons only: keeping a person's custom
yields and saved calculations across devices, and sharing custom yields.
_Avoid_: user, profile

**Guest**:
Someone using the app without signing in. A guest can save, but loses what they
saved if they clear their browser data, and cannot share.
_Avoid_: anonymous user

**Shared yield**:
A custom yield its owner chose to make public in the community dataset.
_Avoid_: published yield, contribution

**Community dataset**:
All shared yields, readable by anyone, attributed only by display name or as
"Anonymous".
_Avoid_: community pool, public data

**Display name**:
The only public identity a person has. Optional, chosen by them, never their
email.
_Avoid_: username, contributor name

_Dropped concepts_: contributor profile (bio/organization pages) and publishing
saved calculations publicly. Neither is one of an account's two jobs.
