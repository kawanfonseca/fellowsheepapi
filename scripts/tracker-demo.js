#!/usr/bin/env node

/**
 * Script de demonstração do Elo Tracker
 * 
 * Executa:
 * 1. Pull de todas as contas
 * 2. Cálculo de métricas
 * 3. Display de resumo no console
 * 
 * Uso: npm run tracker:demo
 */

const {
  loadTrackedAccounts,
  pullAll,
  readAllMatches,
  computeConsolidatedStats,
  computeCycles
} = require('../models/tracker.models');

// Configuração para demo
process.env.USE_DISK_STORAGE = process.env.USE_DISK_STORAGE || 'true';
process.env.API_REQUEST_TIMEOUT_MS = process.env.API_REQUEST_TIMEOUT_MS || '10000';

/**
 * Formata número com separadores de milhares
 */
function formatNumber(num) {
  return Number(num).toLocaleString('pt-BR');
}

/**
 * Formata Elo com cor baseada no valor
 */
function formatElo(elo) {
  if (!Number.isFinite(elo)) return 'N/A';
  
  const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    yellow: '\x1b[33m', 
    green: '\x1b[32m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
  };

  let color = colors.reset;
  if (elo >= 2000) color = colors.magenta;      // 2000+ = Magenta
  else if (elo >= 1800) color = colors.cyan;   // 1800+ = Cyan  
  else if (elo >= 1600) color = colors.green;  // 1600+ = Verde
  else if (elo >= 1400) color = colors.yellow; // 1400+ = Amarelo
  else color = colors.red;                      // <1400 = Vermelho

  return `${color}${elo}${colors.reset}`;
}

/**
 * Formata delta com sinal e cor
 */
function formatDelta(delta) {
  if (!Number.isFinite(delta)) return 'N/A';
  
  const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m'
  };

  const sign = delta >= 0 ? '+' : '';
  const color = delta >= 0 ? colors.green : colors.red;
  
  return `${color}${sign}${delta}${colors.reset}`;
}

/**
 * Exibe banner do demo
 */
function showBanner() {
  console.log('\n' + '='.repeat(60));
  console.log('🐑 FELLOWSHEEP ELO TRACKER - DEMO');
  console.log('='.repeat(60));
  console.log(`Storage Mode: ${process.env.USE_DISK_STORAGE === 'false' ? '💾 Memory' : '💿 Disk'}`);
  console.log(`Timeout: ${process.env.API_REQUEST_TIMEOUT_MS}ms`);
  console.log('='.repeat(60) + '\n');
}

/**
 * Executa pull de dados
 */
async function executePull() {
  console.log('📡 Executando pull de matches...\n');
  
  const startTime = Date.now();
  
  try {
    const result = await pullAll();
    const duration = Date.now() - startTime;
    
    console.log('✅ Pull concluído!');
    console.log(`⏱️  Tempo: ${(duration / 1000).toFixed(1)}s\n`);
    
    console.log('📊 Matches adicionados por conta:');
    Object.entries(result.added).forEach(([profileId, count]) => {
      console.log(`   Profile ${profileId}: ${formatNumber(count)} matches`);
    });
    
    const totalAdded = Object.values(result.added).reduce((sum, count) => sum + count, 0);
    console.log(`   Total: ${formatNumber(totalAdded)} matches\n`);
    
    return result;
  } catch (error) {
    console.error('❌ Erro no pull:', error.message);
    throw error;
  }
}

/**
 * Calcula e exibe métricas
 */
async function calculateAndShowMetrics() {
  console.log('🧮 Calculando métricas...\n');
  
  try {
    const accounts = await loadTrackedAccounts();
    const allMatches = await readAllMatches({ ladder: 'rm_1v1' });
    
    console.log(`📈 Total de matches carregados: ${formatNumber(allMatches.length)}\n`);
    
    // Agrupar por conta
    const matchesByAccount = {};
    accounts.forEach(account => {
      matchesByAccount[account.id] = allMatches.filter(m => m.profile_id === account.id);
    });
    
    // Calcular estatísticas
    const { byAccount, consolidated } = computeConsolidatedStats(matchesByAccount);
    
    // Exibir métricas por conta
    console.log('👤 MÉTRICAS POR CONTA:');
    console.log('-'.repeat(60));
    
    accounts.forEach(account => {
      const stats = byAccount[account.id];
      const matchCount = matchesByAccount[account.id].length;
      
      console.log(`\n🎮 ${account.nick || 'Unknown'} (ID: ${account.id})`);
      console.log(`   Matches: ${formatNumber(matchCount)} total`);
      console.log(`   Volume: ${stats.volume.week} semana / ${stats.volume.month} mês`);
      console.log(`   Rolling Avg: g10=${formatElo(stats.rollingAvg.g10)} g30=${formatElo(stats.rollingAvg.g30)} g100=${formatElo(stats.rollingAvg.g100)}`);
      console.log(`   Percentis: P25=${formatElo(stats.percentiles.p25)} P50=${formatElo(stats.percentiles.p50)} P75=${formatElo(stats.percentiles.p75)}`);
      console.log(`   Delta: g10=${formatDelta(stats.delta.g10)} g20=${formatDelta(stats.delta.g20)} g30=${formatDelta(stats.delta.g30)}`);
      
      if (stats.tilt.length > 0) {
        console.log(`   ⚠️  Tilt detectado: ${stats.tilt.length} ocorrências`);
        stats.tilt.slice(0, 2).forEach(tilt => {
          console.log(`      ${tilt.type}: ${tilt.losses} derrotas, -${tilt.eloDrop} Elo`);
        });
      }
    });
    
    // Exibir métricas consolidadas
    console.log('\n\n🏆 MÉTRICAS CONSOLIDADAS:');
    console.log('-'.repeat(60));
    console.log(`Matches: ${formatNumber(allMatches.length)} total`);
    console.log(`Volume: ${consolidated.volume.week} semana / ${consolidated.volume.month} mês`);
    console.log(`Rolling Avg: g10=${formatElo(consolidated.rollingAvg.g10)} g30=${formatElo(consolidated.rollingAvg.g30)} g100=${formatElo(consolidated.rollingAvg.g100)}`);
    console.log(`Percentis: P25=${formatElo(consolidated.percentiles.p25)} P50=${formatElo(consolidated.percentiles.p50)} P75=${formatElo(consolidated.percentiles.p75)}`);
    console.log(`Delta: g10=${formatDelta(consolidated.delta.g10)} g20=${formatDelta(consolidated.delta.g20)} g30=${formatDelta(consolidated.delta.g30)}`);
    
    if (consolidated.tilt.length > 0) {
      console.log(`⚠️  Tilt consolidado: ${consolidated.tilt.length} ocorrências`);
    }
    
    // Calcular e exibir ciclos
    const cycles = computeCycles(allMatches);
    
    if (cycles.length > 0) {
      console.log('\n\n🎯 CICLOS DE ELO (+100):');
      console.log('-'.repeat(60));
      
      cycles.forEach(cycle => {
        console.log(`${cycle.elo_from} → ${cycle.elo_to}: ${formatNumber(cycle.games_in_cycle)} jogos em ${cycle.days_in_cycle} dias`);
      });
    } else {
      console.log('\n\n🎯 Nenhum ciclo de Elo completo encontrado');
    }
    
  } catch (error) {
    console.error('❌ Erro no cálculo de métricas:', error.message);
    throw error;
  }
}

/**
 * Exibe dicas de uso da API
 */
function showApiTips() {
  console.log('\n\n💡 DICAS DE USO DA API:');
  console.log('-'.repeat(60));
  console.log('# Atualizar dados:');
  console.log('curl -X POST "http://localhost:3000/api/tracker/pull"');
  console.log('');
  console.log('# Volume de jogos:');
  console.log('curl "http://localhost:3000/api/tracker/volume"');
  console.log('');
  console.log('# Métricas completas com detalhes:');
  console.log('curl "http://localhost:3000/api/tracker/summary?includeDetails=true"');
  console.log('');
  console.log('# Timeline dos últimos 30 dias:');
  console.log('curl "http://localhost:3000/api/tracker/timeline?days=30"');
  console.log('');
  console.log('# Ciclos de Elo:');
  console.log('curl "http://localhost:3000/api/tracker/cycles"');
}

/**
 * Função principal
 */
async function main() {
  const startTime = Date.now();
  
  try {
    showBanner();
    
    // Carregar contas
    const accounts = await loadTrackedAccounts();
    console.log(`👥 Contas rastreadas: ${accounts.length}`);
    accounts.forEach(account => {
      console.log(`   - ${account.nick || 'Unknown'} (ID: ${account.id})`);
    });
    console.log('');
    
    // Executar pull
    await executePull();
    
    // Calcular e exibir métricas
    await calculateAndShowMetrics();
    
    // Exibir dicas
    showApiTips();
    
    // Tempo total
    const totalDuration = Date.now() - startTime;
    console.log('\n' + '='.repeat(60));
    console.log(`✅ Demo concluída em ${(totalDuration / 1000).toFixed(1)}s`);
    console.log('='.repeat(60) + '\n');
    
  } catch (error) {
    console.error('\n❌ Erro no demo:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Executar apenas se chamado diretamente
if (require.main === module) {
  main();
}

module.exports = { main };
