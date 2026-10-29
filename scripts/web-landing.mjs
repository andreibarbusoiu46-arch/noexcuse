// After `expo export -p web`: the marketing page becomes "/", the app shell moves to /app.html.
// vercel.json rewrites every other path (e.g. /onboarding, /habits) to /app.html.
import { copyFileSync, existsSync, renameSync } from 'node:fs';

if (!existsSync('dist/index.html')) throw new Error('dist/index.html missing — run expo export first');
renameSync('dist/index.html', 'dist/app.html');
copyFileSync('web/landing.html', 'dist/index.html');
console.log('Landing page → dist/index.html, app shell → dist/app.html');
