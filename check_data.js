const fs = require('fs');
const zlib = require('zlib');

try {
  const compressed = fs.readFileSync('./database/matches-10952501.json.gz');
  const decompressed = zlib.gunzipSync(compressed);
  const matches = JSON.parse(decompressed.toString());

  console.log('Total de matches:', matches.length);
  console.log('Ladders únicos:', [...new Set(matches.map(m => m.ladder))]);
  console.log('Distribuição por ladder:', matches.reduce((acc, m) => {
    acc[m.ladder] = (acc[m.ladder] || 0) + 1;
    return acc;
  }, {}));
  console.log('Exemplo de ladder no primeiro match:', matches[0]?.ladder);
  console.log('Exemplo de ladder no último match:', matches[matches.length - 1]?.ladder);
} catch (error) {
  console.error('Erro:', error.message);
}
