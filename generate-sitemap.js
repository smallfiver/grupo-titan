const fs = require('fs');

// Simple script to read products.js and generate sitemap.xml
try {
    const productsContent = fs.readFileSync('products.js', 'utf8');
    
    // Evaluate the products array
    let PRODUCTS = [];
    let BRANDS = [];
    const window = {}; // mock window object
    eval(productsContent.replace('const PRODUCTS =', 'PRODUCTS =').replace('const BRANDS =', 'BRANDS ='));
    
    const baseUrl = 'https://www.grupotitan.sbs';
    const currentDate = new Date().toISOString().split('T')[0];
    
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>${baseUrl}/</loc>
        <lastmod>${currentDate}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>
</urlset>`;

    fs.writeFileSync('sitemap.xml', xml);
    console.log('Sitemap generated successfully.');
} catch (error) {
    console.error('Error generating sitemap:', error);
}
