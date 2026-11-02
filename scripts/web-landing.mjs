// After `expo export -p web`: the marketing page becomes "/", the app shell moves to /app.html,
// and the landing's own files are served from /l/. vercel.json rewrites app routes to /app.html.
import { copyFileSync, cpSync, existsSync, renameSync } from 'node:fs';

if (!existsSync('dist/index.html')) throw new Error('dist/index.html missing — run expo export first');
renameSync('dist/index.html', 'dist/app.html');
copyFileSync('web/landing.html', 'dist/index.html');
cpSync('web/l', 'dist/l', { recursive: true });
console.log('Landing page → dist/index.html (+ /l), app shell → dist/app.html');
