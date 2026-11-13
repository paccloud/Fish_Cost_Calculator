// Where the app is running, and what it can reach from there.
//
// The store build (Capacitor) has no API yet: it is the calculator, the reference yields and
// what the person saves on the phone. Sign-in, sync and community yields come with the Firebase
// move. A web build can be made the same way with VITE_BACKEND=off.

// True inside the Capacitor shell on a device, false in any browser.
export const isNativeApp = Boolean(globalThis.Capacitor?.isNativePlatform?.());

// What to call the thing a guest's data is saved on: a laptop is not a phone. Where the screen
// cannot be asked (tests, server rendering) it is a phone, the main case.
const narrowTouch = globalThis.matchMedia?.('(pointer: coarse) and (max-width: 640px)');
export const thisDevice = !narrowTouch || narrowTouch.matches ? 'this phone' : 'this device';

// False when there is no API to talk to. The shell hides sign-in and community when it is.
export const backendEnabled = !isNativeApp && import.meta.env.VITE_BACKEND !== 'off';
