// Static server with an SPA fallback (like the vercel.json rewrites), for the end-to-end tests.
// Usage: node e2e/serve.cjs <dir> <port>
const http = require('http'), fs = require('fs'), path = require('path');
const [dir, port] = [process.argv[2], +process.argv[3]];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.xml': 'application/xml' };
http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(dir, u);
  if (!f.startsWith(dir)) { res.writeHead(400); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { const html = path.join(dir, u + '.html'); f = fs.existsSync(html) ? html : path.join(dir, fs.existsSync(path.join(dir, 'app.html')) ? 'app.html' : 'index.html'); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log('serving', dir, 'on', port));
