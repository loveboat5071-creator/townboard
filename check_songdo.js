const fs = require('fs');
const path = require('path');

try {
  const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'web/public/data/master.json'), 'utf-8'));
  
  // 송도 추출
  const songdo = data.filter(c => (c.dong && c.dong.includes('송도')) || (c.name && c.name.includes('송도')));
  console.log('Total Songdo Records:', songdo.length);
  
  const songdoWithGeo = songdo.filter(c => c.lat && c.lng && c.lat !== 37.5665 && c.lat !== 0);
  console.log('Songdo Records with Valid Coordinates:', songdoWithGeo.length);

} catch (e) {
  console.error('Error:', e);
}
