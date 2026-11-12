# The iPhone app

The iPhone app is the same web build as the site, wrapped in a native shell with [Capacitor 8](https://capacitorjs.com). There is one codebase. This page says what is set up, what you have to decide before the first TestFlight upload, and the commands to run on a Mac.

The project was generated on Linux and has not been compiled yet: there is no Xcode here. Expect to fix small things the first time it is opened on a Mac.

## What is set up

- **The Xcode project** is in `app/ios` and is committed. It uses Swift Package Manager, so there is no CocoaPods step.
- **Config** is `app/capacitor.config.json`: app name `Local Catch`, web folder `dist`, and the bundle id `com.example.localcatch`, which is a placeholder.
- **Three native plugins** are installed for the calculator to use: `@capacitor/share` (the system share sheet), `@capacitor/haptics` (a tap you can feel) and `@capacitor/status-bar` (light or dark clock and battery icons to match the theme).
- **App icon and launch screen** are in `app/ios/App/App/Assets.xcassets`. The icon is the 1024 px PNG with no transparency and square corners (iOS rounds them itself). The launch screen is the icon on paper, with a dark version for dark mode.
- **Nothing needs the network to start.** The fonts (Inter and Fraunces), the icons and every reference yield are inside the build.
- **No service worker in the app.** The website uses one to work offline. Inside the app the files are already on the phone, so `app/src/main.jsx` skips it when `Capacitor.isNativePlatform()` is true.
- **Minimum iOS version** is 15, Capacitor's default.

The copy of the web build inside the Xcode project (`app/ios/App/App/public`) is not committed. It is made fresh by `npm run ios:sync`, so run that before opening Xcode and after every change to the web app.

## Decide before the first TestFlight upload

1. **The bundle id.** This is the app's permanent identifier on the App Store, in reverse-domain form (for example `org.yourdomain.localcatch`). It cannot be changed after the first upload. Replace `com.example.localcatch` in two places: `appId` in `app/capacitor.config.json`, and the Bundle Identifier of the App target in Xcode (Signing & Capabilities). Capacitor does not update the Xcode project for you once it exists.
2. **The app name.** It is "Local Catch" everywhere today: `appName` in `app/capacitor.config.json`, Display Name in Xcode, the web manifest in `app/vite.config.js` and the page title in `app/index.html`. "Local Catch" is the Local Catch Network's name, so shipping under it needs their agreement in writing, or a name of your own (product audit, section 7).
3. **The Apple Developer account** ($99 a year). An individual account is quick. An organisation account shows a company as the seller but needs a D-U-N-S number, which can take weeks. Whichever account owns the bundle id is the one that signs the app.
4. **A privacy policy URL.** Apple requires one for every submission, including a calculator with no accounts.
5. **The icon.** The current artwork still carries "FC" from the old name and is a placeholder until a mark is commissioned. To replace it, put the new 1024 px PNG (no transparency, square corners) at `app/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` and update the PNGs in `app/public/icons` for the website.

## Commands on a Mac

You need Xcode (Apple currently requires Xcode 26 for uploads) and Node 22 or newer.

```bash
cd app
npm ci
npm run ios:sync   # builds the web app, then copies it and the plugins into app/ios
npm run ios:open   # opens the project in Xcode
```

Then in Xcode:

1. Select the **App** target, open **Signing & Capabilities**, choose your team and set the bundle id.
2. Pick a simulator or a plugged-in iPhone and press Run to try it.
3. For TestFlight: set the destination to **Any iOS Device**, choose **Product > Archive**, then **Distribute App > TestFlight**.

The version (`1.0`) and build number (`1`) are on the target's General tab. Every upload needs a higher build number.

## What the 1.0 build contains

- The calculator, with all the reference yields.
- Saved prices, kept on the phone.
- Share, through the system share sheet.
- No accounts.

Because there is no sign-in, Sign in with Apple, native Google sign-in and in-app account deletion are not required yet, and 1.0 does not have to wait for the Firebase migration.

## What 1.1 needs

From the product audit, section 6:

- Accounts through the Firebase Auth SDK, with **Sign in with Apple** next to Google (Apple requires it when another login is offered) and Google sign-in through a native plugin (Google blocks its web sign-in inside app web views).
- **In-app account deletion.** Apple requires it as soon as people can create an account.
- An App Privacy label that matches what the app then collects, and privacy manifests checked for the added SDKs.
- A demo account or demo mode for the App Store reviewer.
- Sync and community yields, which arrive with the Firebase work.

## How the app knows there is no backend

The 1.0 app has no server to talk to. Inside the native shell the app checks `Capacitor.isNativePlatform()` and turns off everything that needs one (sign-in, sync, community data). A web build can be made to behave the same way by setting `VITE_BACKEND=off` when it is built:

```bash
cd app
VITE_BACKEND=off npm run build
```

That is the way to preview what the iPhone app will show without a Mac.

## Android, later

Capacitor's Android target reuses the same build and the same three plugins: `npm install @capacitor/android`, then `npx cap add android`. It is not set up yet.
