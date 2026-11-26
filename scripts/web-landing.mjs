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
copyFileSync('web/robots.txt', 'dist/robots.txt');
copyFileSync('web/sitemap.xml', 'dist/sitemap.xml');
// vercel.json rewrites only the app's real routes to /app.html; any other path gets Vercel's 404.html with a
// real 404 status. It is the app shell too, so the app still renders its branded "page doesn't exist" screen
// (and a route missing from vercel.json would still render correctly, just with a 404 status).
copyFileSync('dist/app.html', 'dist/404.html');
console.log('Landing page → dist/index.html (+ /l, robots.txt, sitemap.xml), app shell → dist/app.html and dist/404.html (with no-flash theme script)');
