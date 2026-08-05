const fs = require('fs');
const https = require('https');
const path = require('path');

const baseUrl = 'https://www.grupotitan.sbs/';

const downloadFile = (url, dest) => {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, { recursive: true });
    }
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      } else {
        file.close();
        fs.unlink(dest, () => {}); // Delete temp file
        resolve(); // Ignore 404s for now
      }
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      resolve();
    });
  });
};

const run = async () => {
  // Read products.js
  const productsContent = fs.readFileSync('products.js', 'utf8');
  const imgRegex = /img:\s*"([^"]+)"/g;
  let match;
  const urls = new Set();
  
  while ((match = imgRegex.exec(productsContent)) !== null) {
    urls.add(match[1]);
  }
  
  // Read index.html for other webp
  const htmlContent = fs.readFileSync('index.html', 'utf8');
  const htmlImgRegex = /(?:src|href)="([^"]+\.webp)"/gi;
  while ((match = htmlImgRegex.exec(htmlContent)) !== null) {
    urls.add(match[1]);
  }

  // Also BRANDS from products.js
  const heroRegex = /hero:\s*"([^"]+)"/g;
  while ((match = heroRegex.exec(productsContent)) !== null) {
    urls.add(match[1]);
  }

  console.log(`Found ${urls.size} images to download...`);
  
  for (const item of urls) {
    const encodedItem = item.split('/').map(encodeURIComponent).join('/');
    const url = baseUrl + encodedItem;
    console.log('Downloading:', item);
    await downloadFile(url, path.join(__dirname, item));
  }
  console.log('Done downloading images.');
};

run();
