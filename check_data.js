const fs = require('fs');
const path = require('path');

try {
  const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'web/public/data/master.json'), 'utf-8'));
  console.log('Total Records:', data.length);
  
  // 인천 남동구 레코드 추출
  const namdong = data.filter(c => (c.city === '인천' || c.city === '인천광역시') && (c.district && c.district.includes('남동')));
  console.log('Namdong-gu Records:', namdong.length);
  
  if (namdong.length > 0) {
    console.log('Sample Records from Namdong-gu:');
    namdong.slice(0, 5).forEach(c => {
      console.log(`- ${c.name}: lat=${c.lat}, lng=${c.lng}, addr=${c.addr_road}`);
    });
    
    const withGeo = namdong.filter(c => c.lat && c.lat > 0);
    console.log('Namdong-gu Records with Coordinates:', withGeo.length);
  } else {
    // 혹시 '남동'이 아니라 다른 이름으로 저장되어 있는지 확인
    const incheon = data.filter(c => c.city === '인천' || c.city === '인천광역시');
    console.log('Total Incheon Records:', incheon.length);
    if (incheon.length > 0) {
      const districts = [...new Set(incheon.map(c => c.district))];
      console.log('Incheon Districts in DB:', districts);
    }
  }
} catch (e) {
  console.error('Error reading data:', e);
}
