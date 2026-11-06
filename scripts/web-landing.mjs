// After `expo export -p web`: the marketing page becomes "/", the app shell moves to /app.html,
// and the landing's own files are served from /l/. vercel.json rewrites app routes to /app.html.
import { copyFileSync, cpSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

if (!existsSync('dist/index.html')) throw new Error('dist/index.html missing — run expo export first');
renameSync('dist/index.html', 'dist/app.html');

// No theme flash: paint the saved (or system) background before the JS bundle loads.
// Mirrors PrefsProvider: localStorage nx.theme = dark | light | system; dark is the default.
const noFlash = `<script>(function(){try{var t=localStorage.getItem('nx.theme');var l=t==='light'||(t==='system'&&matchMedia('(prefers-color-scheme: light)').matches);` +
  `var d=document.documentElement;d.style.background=l?'#F5F5F3':'#000000';d.style.colorScheme=l?'light':'dark';` +
  `var g=localStorage.getItem('nx.lang');if(g)d.lang=g;}catch(e){document.documentElement.style.background='#000000';}})();</script>`;
const shell = readFileSync('dist/app.html', 'utf8');
if (!shell.includes('<head>')) throw new Error('app.html has no <head>');
writeFileSync('dist/app.html', shell.replace('<head>', `<head>${noFlash}`));
copyFileSync('web/landing.html', 'dist/index.html');
cpSync('web/l', 'dist/l', { recursive: true });
console.log('Landing page → dist/index.html (+ /l), app shell → dist/app.html (with no-flash theme script)');
