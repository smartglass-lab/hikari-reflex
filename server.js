var http = require('http');
var fs = require('fs');
var path = require('path');

var PORT = process.env.PORT || 3000;

var mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

var server = http.createServer(function(req, res) {
  var urlPath = (req.url === '/' ? '/index.html' : req.url).split('?')[0];
  var filePath = path.join(__dirname, decodeURIComponent(urlPath));
  var ext = path.extname(filePath);
  var contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, function(err, content) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>404 Not Found</h1>');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
    res.end(content);
  });
});

server.listen(PORT, function() {
  console.log('hikari-reflex dev server: http://localhost:' + PORT);
});
