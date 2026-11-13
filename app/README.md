# Local Catch app

The React app: the calculator, My yields, Community and Account screens. It is the whole product on the web, and the same build is wrapped for iPhone by the Capacitor project in `ios/`.

```bash
npm ci
npm run dev        # http://localhost:5173
npm run lint
npm test           # Vitest; about three minutes, most of it the secret-scanner tests
npm run build      # production build in dist/
npm run ios:sync   # build, then copy it into the iOS project (see ../docs/ios.md)
```

Tests import code from the repository root, `shared/` and `scripts/`, so run `npm ci` in the root and in `shared/` as well.

The calculator works with no backend: reference yields are bundled, and what a person saves is kept on the device. Sign-in and sync need the API (`VITE_API_URL`); see `../docs/ENVIRONMENT_VARIABLES.md`.

Where things are:

- `src/components/` screens and shared components (`Calculator.jsx`, `TabBar.jsx`, `Stamp.jsx`, `Notice.jsx`)
- `src/lib/` pure logic with tests beside it (`calcEngine.js`, `formNames.js`, `priceCard.js`, `numberInput.js`)
- `src/data/fish_data_v3.js` the reference yields
- `src/index.css`, `tailwind.config.js` design tokens and shared classes; the rules are in `../docs/STYLE_GUIDE.md` and `../docs/DESIGN_SYSTEM.md`
