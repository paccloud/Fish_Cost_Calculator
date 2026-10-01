import { defineConfig } from 'vitest/config';

// Tests that need the Firebase emulators. Run them with `npm run test:emulated`,
// which starts the Auth and Firestore emulators around this config. The default
// `npm test` excludes `test/**`, so these never run without an emulator.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/rules/**/*.rules.test.js', 'test/emulator/**/*.emu.test.js'],
    testTimeout: 20000,
    hookTimeout: 30000,
    // One shared emulator: files run one at a time so a clearFirestore() in
    // one file cannot wipe records another file is reading.
    fileParallelism: false,
  },
});
