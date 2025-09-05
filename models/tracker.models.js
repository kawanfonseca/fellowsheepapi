const axios = require("axios");
const rateLimit = require("axios-rate-limit");
const fs = require("fs");
const path = require("path");
const zlib = require('zlib');

// Criar instâncias de axios com rate limiting (reutilizando configuração similar ao players.models.js)
const infoRequest = rateLimit(axios.create(), {
  maxRequests: 2,
  perMilliseconds: 50,
  maxRPS: 40,
});

const historyRequest = rateLimit(axios.create(), {
  maxRequests: 2,
  perMilliseconds: 50,
  maxRPS: 40,
});

// Cliente adicional para aoe2.net API com rate limit
const aoe2NetRequest = rateLimit(axios.create(), {
  maxRequests: 3,
  perMilliseconds: 1000,
  maxRPS: 10,
});

/**
 * Carrega as contas rastreadas do arquivo fs_players.json
 * @returns {Promise<Array<{id: number, steam: string, nick?: string}>>}
 */
async function loadTrackedAccounts() {
  return new Promise((resolve, reject) => {
    const filePath = path.join(__dirname, '../database/fs_players.json');
    
    fs.readFile(filePath, 'utf-8', (err, fileContent) => {
      if (err) {
        console.error('Erro ao ler fs_players.json:', err);
        reject(err);
        return;
      }

      try {
        const players = JSON.parse(fileContent);
        const accounts = players
          .filter(p => p && p.id && p.steam)
          .map(p => ({
            id: Number(p.id),
            steam: String(p.steam),
            nick: p.nick || null
          }))
          .filter(p => Number.isFinite(p.id));
        
        resolve(accounts);
      } catch (parseErr) {
        console.error('Erro ao parsear fs_players.json:', parseErr);
        reject(parseErr);
      }
    });
  });
}

/**
 * Normaliza nome do mapa usando a lógica existente
 * @param {string} rawName 
 * @param {object} decodedOptions 
 * @returns {string}
 */
function normalizeMapName(rawName, decodedOptions) {
  const MAP_NAME_NORMALIZATION = new Map([
    ['arabia.rms', 'Arabia'],
    ['arena.rms', 'Arena'],
    ['enclosed.rms', 'Enclosed'],
    ['socotra.rms', 'Socotra'],
    ['mediterranean.rms', 'Mediterranean'],
    ['fortress.rms', 'Fortress'],
    ['gold_rush.rms', 'Gold Rush'],
    ['acropolis.rms', 'Acropolis'],
    ['four_lakes.rms', 'Four Lakes'],
    ['islands.rms', 'Islands'],
    ['ghost_lake.rms', 'Ghost Lake'],
    ['oasis.rms', 'Oasis'],
    ['highland.rms', 'Highland'],
    ['valley.rms', 'Valley'],
    ['cross.rms', 'Cross'],
  ]);

  // Tentar via options primeiro
  if (decodedOptions && typeof decodedOptions === 'object') {
    const o = decodedOptions;
    const fromKeys = [
      'map', 'selectedmap', 'mapname', 'map_name', 'random_map', 'randommap'
    ];
    for (const k of fromKeys) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) {
        const key = v.trim().toLowerCase();
        if (MAP_NAME_NORMALIZATION.has(key)) return MAP_NAME_NORMALIZATION.get(key);
        return v.replace(/\.rms$/i, '');
      }
    }
  }

  if (typeof rawName === 'string' && rawName.trim()) {
    const key = rawName.trim().toLowerCase();
    if (MAP_NAME_NORMALIZATION.has(key)) return MAP_NAME_NORMALIZATION.get(key);
    return rawName.replace(/\.rms$/i, '');
  }
  return 'Ranked';
}

/**
 * Decodifica opções comprimidas de uma partida
 * @param {string} optionsStr 
 * @returns {object|null}
 */
function decodeOptionsCompressed(optionsStr) {
  if (!optionsStr || typeof optionsStr !== 'string') return null;
  try {
    const decoded = Buffer.from(optionsStr, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch (_) {
    return null;
  }
}

/**
 * Busca partidas para um perfil específico via WorldsEdgeLink e aoe2.net
 * @param {number} profileId 
 * @param {object} options 
 * @param {number} options.sinceTs - Timestamp em segundos desde quando buscar
 * @returns {Promise<{addedCount: number, matchesNormalized: Array}>}
 */
async function pullMatchesForProfile(profileId, { sinceTs } = {}) {
  const pid = Number(profileId);
  if (!Number.isFinite(pid)) {
    throw new Error(`Profile ID inválido: ${profileId}`);
  }

  const timeout = Number(process.env.API_REQUEST_TIMEOUT_MS) || 10000;
  const matches = [];

  try {
    // 1. Buscar via WorldsEdgeLink recentMatchHistory
    console.log(`Buscando matches via WorldsEdgeLink para profile ${pid}...`);
    const welUrl = 'https://aoe-api.worldsedgelink.com/community/leaderboard/getRecentMatchHistory';
    const welParams = {
      title: 'age2',
      profile_ids: JSON.stringify([pid])
    };

    const welResp = await historyRequest.get(welUrl, { 
      params: welParams, 
      timeout 
    });
    
    const welData = welResp.data || {};
    const welMatches = Array.isArray(welData.matchHistoryStats) ? welData.matchHistoryStats : [];
    
    console.log(`WorldsEdgeLink retornou ${welMatches.length} matches`);

    // 2. Buscar via aoe2.net para complementar
    console.log(`Buscando matches via aoe2.net para profile ${pid}...`);
    const aoe2Url = 'https://aoe2.net/api/player/matches';
    const aoe2Params = {
      game: 'aoe2de',
      profile_id: pid,
      count: 1000
    };
    
    if (sinceTs && Number.isFinite(sinceTs)) {
      aoe2Params.since = sinceTs;
    }

    let aoe2Matches = [];
    try {
      const aoe2Resp = await aoe2NetRequest.get(aoe2Url, { 
        params: aoe2Params, 
        timeout 
      });
      aoe2Matches = Array.isArray(aoe2Resp.data) ? aoe2Resp.data : [];
      console.log(`aoe2.net retornou ${aoe2Matches.length} matches`);
    } catch (aoe2Err) {
      console.warn(`Erro ao buscar via aoe2.net para profile ${pid}:`, aoe2Err.message);
    }

    // 3. Normalizar matches do WorldsEdgeLink
    for (const match of welMatches) {
      const normalized = await normalizeWorldsEdgeLinkMatch(match, pid);
      if (normalized && normalized.ladder === 'rm_1v1') {
        matches.push(normalized);
      }
    }

    // 4. Normalizar matches do aoe2.net
    for (const match of aoe2Matches) {
      const normalized = normalizeAoe2NetMatch(match, pid);
      if (normalized && normalized.ladder === 'rm_1v1') {
        matches.push(normalized);
      }
    }

    // 5. Remover duplicatas por match_id
    const uniqueMatches = [];
    const seenIds = new Set();
    
    for (const match of matches) {
      const id = String(match.match_id);
      if (!seenIds.has(id)) {
        seenIds.add(id);
        uniqueMatches.push(match);
      }
    }

    // 6. Ordenar por started_at (mais recente primeiro)
    uniqueMatches.sort((a, b) => (b.started_at || 0) - (a.started_at || 0));

    console.log(`Total de matches únicos normalizados: ${uniqueMatches.length}`);

    // 7. Persistência
    const useDiskStorage = process.env.USE_DISK_STORAGE !== 'false';
    let addedCount = 0;

    if (useDiskStorage) {
      addedCount = await saveMatchesToDisk(pid, uniqueMatches);
    } else {
      addedCount = uniqueMatches.length;
    }

    return {
      addedCount,
      matchesNormalized: uniqueMatches
    };

  } catch (error) {
    console.error(`Erro ao buscar matches para profile ${pid}:`, error.message);
    throw new Error(`Falha ao buscar matches para profile ${pid}: ${error.message}`);
  }
}

/**
 * Normaliza uma partida do WorldsEdgeLink
 * @param {object} match 
 * @param {number} profileId 
 * @returns {Promise<object|null>}
 */
async function normalizeWorldsEdgeLinkMatch(match, profileId) {
  if (!match) return null;

  const matchId = match.id || match.matchhistory_id;
  if (!matchId) return null;

  const startTime = Number(match.startgametime || 0);
  const endTime = Number(match.completiontime || 0);
  
  // Só considerar partidas finalizadas para o tracker
  if (!endTime || endTime <= 0) return null;

  // Verificar se é RM 1v1 (matchtype_id = 7)
  const matchType = Number(match.matchtype_id || 0);
  if (matchType !== 7) return null;

  // Buscar dados do jogador específico
  const members = Array.isArray(match.matchhistorymember) ? match.matchhistorymember : [];
  const playerMember = members.find(m => Number(m.profile_id) === profileId);
  
  if (!playerMember) return null;

  // Decodificar opções para obter mapa e civilização
  const decodedOptions = decodeOptionsCompressed(match.options);
  const mapName = normalizeMapName(match.mapname, decodedOptions);
  
  // Civilização do jogador
  let civName = null;
  if (playerMember.race && Number.isFinite(Number(playerMember.race))) {
    civName = getCivilizationName(Number(playerMember.race));
  }

  // Resultado da partida
  let won = null;
  if (Number.isFinite(Number(playerMember.resulttype))) {
    won = Number(playerMember.resulttype) === 1; // 1 = vitória
  }

  // Rating antes e depois
  const ratingBefore = Number.isFinite(Number(playerMember.oldrating)) ? Number(playerMember.oldrating) : null;
  const ratingAfter = Number.isFinite(Number(playerMember.newrating)) ? Number(playerMember.newrating) : null;

  return {
    match_id: String(matchId),
    profile_id: profileId,
    started_at: startTime,
    ended_at: endTime,
    ladder: 'rm_1v1',
    map: mapName,
    civ: civName,
    won: won,
    rating_before: ratingBefore,
    rating_after: ratingAfter
  };
}

/**
 * Normaliza uma partida do aoe2.net
 * @param {object} match 
 * @param {number} profileId 
 * @returns {object|null}
 */
function normalizeAoe2NetMatch(match, profileId) {
  if (!match) return null;

  const matchId = match.match_id || match.match_uuid;
  if (!matchId) return null;

  const startTime = Number(match.started || 0);
  const endTime = Number(match.finished || 0);
  
  // Só considerar partidas finalizadas
  if (!endTime || endTime <= 0) return null;

  // Verificar se é RM 1v1
  const leaderboard = Number(match.leaderboard_id || 0);
  if (leaderboard !== 3) return null; // 3 = RM 1v1

  // Buscar dados do jogador específico
  const players = Array.isArray(match.players) ? match.players : [];
  const playerData = players.find(p => Number(p.profile_id) === profileId);
  
  if (!playerData) return null;

  // Mapa
  const mapName = match.map_type || 'Unknown';

  // Civilização
  let civName = null;
  if (playerData.civ && Number.isFinite(Number(playerData.civ))) {
    civName = getCivilizationName(Number(playerData.civ));
  }

  // Resultado
  let won = null;
  if (playerData.won !== undefined) {
    won = Boolean(playerData.won);
  }

  // Rating
  const ratingBefore = Number.isFinite(Number(playerData.rating)) ? Number(playerData.rating) : null;
  const ratingAfter = Number.isFinite(Number(playerData.rating_change)) && ratingBefore !== null 
    ? ratingBefore + Number(playerData.rating_change) 
    : null;

  return {
    match_id: String(matchId),
    profile_id: profileId,
    started_at: startTime,
    ended_at: endTime,
    ladder: 'rm_1v1',
    map: mapName,
    civ: civName,
    won: won,
    rating_before: ratingBefore,
    rating_after: ratingAfter
  };
}

/**
 * Salva matches no disco com merge incremental
 * @param {number} profileId 
 * @param {Array} newMatches 
 * @returns {Promise<number>} Número de matches adicionados
 */
async function saveMatchesToDisk(profileId, newMatches) {
  const filePath = path.join(__dirname, '../database', `matches-${profileId}.json.gz`);
  
  let existingMatches = [];
  
  // Carregar matches existentes
  if (fs.existsSync(filePath)) {
    try {
      const compressed = fs.readFileSync(filePath);
      const decompressed = zlib.gunzipSync(compressed);
      existingMatches = JSON.parse(decompressed.toString());
    } catch (err) {
      console.warn(`Erro ao ler arquivo existente ${filePath}:`, err.message);
    }
  }

  // Merge incremental
  const existingIds = new Set(existingMatches.map(m => String(m.match_id)));
  const toAdd = newMatches.filter(m => !existingIds.has(String(m.match_id)));
  
  if (toAdd.length === 0) {
    console.log(`Nenhum match novo para profile ${profileId}`);
    return 0;
  }

  const allMatches = [...existingMatches, ...toAdd];
  
  // Ordenar por ended_at desc
  allMatches.sort((a, b) => (b.ended_at || 0) - (a.ended_at || 0));

  // Salvar comprimido
  try {
    const jsonStr = JSON.stringify(allMatches, null, 2);
    const compressed = zlib.gzipSync(Buffer.from(jsonStr));
    fs.writeFileSync(filePath, compressed);
    console.log(`Salvos ${toAdd.length} matches novos para profile ${profileId}`);
    return toAdd.length;
  } catch (err) {
    console.error(`Erro ao salvar matches para profile ${profileId}:`, err.message);
    throw err;
  }
}

/**
 * Executa pullMatchesForProfile para todas as contas rastreadas
 * @param {object} options
 * @param {number} options.sinceTs
 * @returns {Promise<{added: object, memory?: object}>}
 */
async function pullAll({ sinceTs } = {}) {
  const accounts = await loadTrackedAccounts();
  const concurrencyLimit = 5;
  const results = { added: {} };
  
  if (process.env.USE_DISK_STORAGE === 'false') {
    results.memory = {};
  }

  console.log(`Iniciando pull para ${accounts.length} contas com concorrência ${concurrencyLimit}`);

  // Processar em batches para controlar concorrência
  for (let i = 0; i < accounts.length; i += concurrencyLimit) {
    const batch = accounts.slice(i, i + concurrencyLimit);
    
    const batchPromises = batch.map(async (account) => {
      try {
        const result = await pullMatchesForProfile(account.id, { sinceTs });
        results.added[account.id] = result.addedCount;
        
        if (results.memory) {
          results.memory[account.id] = result.matchesNormalized;
        }
        
        return { profileId: account.id, success: true, count: result.addedCount };
      } catch (error) {
        console.error(`Erro ao processar profile ${account.id}:`, error.message);
        results.added[account.id] = 0;
        
        if (results.memory) {
          results.memory[account.id] = [];
        }
        
        return { profileId: account.id, success: false, error: error.message };
      }
    });

    const batchResults = await Promise.allSettled(batchPromises);
    
    batchResults.forEach((result, index) => {
      const account = batch[index];
      if (result.status === 'fulfilled') {
        console.log(`Profile ${account.id}: ${result.value.success ? result.value.count + ' matches' : result.value.error}`);
      } else {
        console.error(`Profile ${account.id}: Promise rejeitada:`, result.reason);
      }
    });

    // Pequena pausa entre batches para evitar rate limiting
    if (i + concurrencyLimit < accounts.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log('Pull completo:', results.added);
  return results;
}

/**
 * Lê todas as partidas consolidadas das contas rastreadas
 * @param {object} options
 * @param {string} options.ladder - Filtro por ladder (default: 'rm_1v1')
 * @param {number} options.from - Timestamp início (epoch segundos)
 * @param {number} options.to - Timestamp fim (epoch segundos)
 * @param {object} options.inMemory - Matches em memória (para USE_DISK_STORAGE=false)
 * @returns {Promise<Array>}
 */
async function readAllMatches({ ladder = 'rm_1v1', from, to, inMemory } = {}) {
  const accounts = await loadTrackedAccounts();
  const allMatches = [];
  const useDiskStorage = process.env.USE_DISK_STORAGE !== 'false';

  if (!useDiskStorage && inMemory) {
    // Usar dados em memória
    for (const account of accounts) {
      const matches = inMemory[account.id] || [];
      allMatches.push(...matches.filter(m => m.ladder === ladder));
    }
  } else if (useDiskStorage) {
    // Ler do disco
    for (const account of accounts) {
      const filePath = path.join(__dirname, '../database', `matches-${account.id}.json.gz`);
      
      if (fs.existsSync(filePath)) {
        try {
          const compressed = fs.readFileSync(filePath);
          const decompressed = zlib.gunzipSync(compressed);
          const matches = JSON.parse(decompressed.toString());
          allMatches.push(...matches.filter(m => m.ladder === ladder));
        } catch (err) {
          console.warn(`Erro ao ler matches para profile ${account.id}:`, err.message);
        }
      }
    }
  }

  // Filtrar por janela de tempo se especificada
  let filteredMatches = allMatches;
  
  if (Number.isFinite(from) || Number.isFinite(to)) {
    filteredMatches = allMatches.filter(match => {
      const endTime = match.ended_at || 0;
      if (Number.isFinite(from) && endTime < from) return false;
      if (Number.isFinite(to) && endTime > to) return false;
      return true;
    });
  }

  // Ordenar por ended_at desc
  filteredMatches.sort((a, b) => (b.ended_at || 0) - (a.ended_at || 0));
  
  return filteredMatches;
}

/**
 * Calcula estatísticas para matches de uma conta específica
 * @param {Array} matches - Array de matches ordenado por ended_at asc
 * @returns {object}
 */
function computePerAccountStats(matches) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return {
      volume: { week: 0, month: 0 },
      rollingAvg: { g10: null, g20: null, g30: null, g50: null, g100: null },
      percentiles: { p25: null, p50: null, p75: null },
      delta: { g10: null, g20: null, g30: null },
      tilt: []
    };
  }

  // Ordenar por ended_at asc para cálculos sequenciais
  const sortedMatches = [...matches].sort((a, b) => (a.ended_at || 0) - (b.ended_at || 0));
  const now = Math.floor(Date.now() / 1000);
  const weekAgo = now - (7 * 24 * 60 * 60);
  const monthAgo = now - (30 * 24 * 60 * 60);

  // Volume
  const weekMatches = sortedMatches.filter(m => (m.ended_at || 0) >= weekAgo).length;
  const monthMatches = sortedMatches.filter(m => (m.ended_at || 0) >= monthAgo).length;

  // Rolling averages (usar últimos N matches)
  const rollingAvg = {};
  for (const n of [10, 20, 30, 50, 100]) {
    const lastN = sortedMatches.slice(-n);
    const validRatings = lastN
      .map(m => m.rating_after)
      .filter(r => Number.isFinite(r));
    
    rollingAvg[`g${n}`] = validRatings.length > 0 
      ? Math.round(validRatings.reduce((sum, r) => sum + r, 0) / validRatings.length)
      : null;
  }

  // Percentis (últimos 200 jogos ou todos se menos de 200)
  const last200 = sortedMatches.slice(-200);
  const validRatings = last200
    .map(m => m.rating_after)
    .filter(r => Number.isFinite(r))
    .sort((a, b) => a - b);

  const percentiles = {};
  if (validRatings.length > 0) {
    percentiles.p25 = Math.round(getPercentile(validRatings, 25));
    percentiles.p50 = Math.round(getPercentile(validRatings, 50));
    percentiles.p75 = Math.round(getPercentile(validRatings, 75));
  } else {
    percentiles.p25 = percentiles.p50 = percentiles.p75 = null;
  }

  // Delta Elo
  const delta = {};
  for (const n of [10, 20, 30]) {
    if (sortedMatches.length >= n) {
      const current = sortedMatches[sortedMatches.length - 1]?.rating_after;
      const nGamesAgo = sortedMatches[sortedMatches.length - n]?.rating_after;
      
      if (Number.isFinite(current) && Number.isFinite(nGamesAgo)) {
        delta[`g${n}`] = Math.round(current - nGamesAgo);
      } else {
        delta[`g${n}`] = null;
      }
    } else {
      delta[`g${n}`] = null;
    }
  }

  // Tilt/Streak detection
  const tilt = detectTiltStreaks(sortedMatches);

  return {
    volume: { week: weekMatches, month: monthMatches },
    rollingAvg,
    percentiles,
    delta,
    tilt
  };
}

/**
 * Calcula estatísticas consolidadas de todas as contas
 * @param {object} allMatchesByAccount - { [profileId]: Match[] }
 * @returns {object}
 */
function computeConsolidatedStats(allMatchesByAccount) {
  // Consolidar todos os matches
  const allMatches = [];
  const byAccount = {};

  Object.entries(allMatchesByAccount).forEach(([profileId, matches]) => {
    allMatches.push(...matches);
    byAccount[profileId] = computePerAccountStats(matches);
  });

  // Calcular stats consolidadas
  const consolidated = computePerAccountStats(allMatches);

  return { byAccount, consolidated };
}

/**
 * Calcula ciclos de Elo (+100 pontos)
 * @param {Array} allMatchesConsolidated - Matches consolidados ordenados por ended_at
 * @returns {Array}
 */
function computeCycles(allMatchesConsolidated) {
  if (!Array.isArray(allMatchesConsolidated) || allMatchesConsolidated.length === 0) {
    return [];
  }

  const matches = [...allMatchesConsolidated].sort((a, b) => (a.ended_at || 0) - (b.ended_at || 0));
  const cycles = [];
  const thresholds = [1700, 1800, 1900, 2000];

  for (let i = 0; i < thresholds.length - 1; i++) {
    const fromElo = thresholds[i];
    const toElo = thresholds[i + 1];

    // Encontrar primeiro match >= fromElo
    const startIndex = matches.findIndex(m => 
      Number.isFinite(m.rating_after) && m.rating_after >= fromElo
    );

    if (startIndex === -1) continue;

    // Encontrar primeiro match >= toElo após startIndex
    const endIndex = matches.findIndex((m, idx) => 
      idx > startIndex && Number.isFinite(m.rating_after) && m.rating_after >= toElo
    );

    if (endIndex === -1) continue;

    const startMatch = matches[startIndex];
    const endMatch = matches[endIndex];
    const gamesInCycle = endIndex - startIndex + 1;
    const daysInCycle = Math.ceil((endMatch.ended_at - startMatch.ended_at) / (24 * 60 * 60));

    cycles.push({
      elo_from: fromElo,
      elo_to: toElo,
      games_in_cycle: gamesInCycle,
      days_in_cycle: daysInCycle
    });
  }

  return cycles;
}

// Funções auxiliares

/**
 * Calcula percentil de um array ordenado
 * @param {Array} sortedArray 
 * @param {number} percentile 
 * @returns {number}
 */
function getPercentile(sortedArray, percentile) {
  const index = (percentile / 100) * (sortedArray.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  
  if (lower === upper) {
    return sortedArray[lower];
  }
  
  const weight = index - lower;
  return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
}

/**
 * Detecta sequências de tilt (≥3 derrotas seguidas OU queda ≥40 Elo em ≤10 jogos)
 * @param {Array} matches - Matches ordenados por ended_at asc
 * @returns {Array}
 */
function detectTiltStreaks(matches) {
  if (!Array.isArray(matches) || matches.length < 3) return [];

  const tilts = [];
  
  // Detectar sequências de derrotas
  let lossStreak = [];
  
  for (const match of matches) {
    if (match.won === false) {
      lossStreak.push(match);
    } else {
      if (lossStreak.length >= 3) {
        tilts.push({
          type: 'loss_streak',
          fromMatch: lossStreak[0].match_id,
          toMatch: lossStreak[lossStreak.length - 1].match_id,
          losses: lossStreak.length,
          eloDrop: calculateEloDrop(lossStreak)
        });
      }
      lossStreak = [];
    }
  }
  
  // Verificar última sequência
  if (lossStreak.length >= 3) {
    tilts.push({
      type: 'loss_streak',
      fromMatch: lossStreak[0].match_id,
      toMatch: lossStreak[lossStreak.length - 1].match_id,
      losses: lossStreak.length,
      eloDrop: calculateEloDrop(lossStreak)
    });
  }

  // Detectar quedas de Elo ≥40 em ≤10 jogos
  for (let i = 0; i <= matches.length - 3; i++) {
    for (let j = i + 2; j < Math.min(i + 10, matches.length); j++) {
      const startMatch = matches[i];
      const endMatch = matches[j];
      
      if (Number.isFinite(startMatch.rating_after) && Number.isFinite(endMatch.rating_after)) {
        const eloDrop = startMatch.rating_after - endMatch.rating_after;
        
        if (eloDrop >= 40) {
          tilts.push({
            type: 'elo_drop',
            fromMatch: startMatch.match_id,
            toMatch: endMatch.match_id,
            losses: matches.slice(i, j + 1).filter(m => m.won === false).length,
            eloDrop: Math.round(eloDrop)
          });
          break; // Não procurar mais drops a partir deste ponto
        }
      }
    }
  }

  return tilts;
}

/**
 * Calcula queda de Elo em uma sequência de matches
 * @param {Array} matches 
 * @returns {number}
 */
function calculateEloDrop(matches) {
  if (matches.length === 0) return 0;
  
  const first = matches[0];
  const last = matches[matches.length - 1];
  
  if (Number.isFinite(first.rating_before) && Number.isFinite(last.rating_after)) {
    return Math.round(first.rating_before - last.rating_after);
  }
  
  return 0;
}

/**
 * Converte ID de civilização para nome
 * @param {number} civId 
 * @returns {string|null}
 */
function getCivilizationName(civId) {
  const civs = {
    1: 'Britons', 2: 'Franks', 3: 'Goths', 4: 'Teutons', 5: 'Chinese',
    6: 'Japanese', 7: 'Byzantines', 8: 'Persians', 9: 'Saracens', 10: 'Turks',
    11: 'Vikings', 12: 'Mongols', 13: 'Celts', 14: 'Spanish', 15: 'Aztecs',
    16: 'Mayans', 17: 'Huns', 18: 'Koreans', 19: 'Italians', 20: 'Indians',
    21: 'Incas', 22: 'Magyars', 23: 'Slavs', 24: 'Portuguese', 25: 'Ethiopians',
    26: 'Malians', 27: 'Berbers', 28: 'Khmer', 29: 'Malay', 30: 'Burmese',
    31: 'Vietnamese', 32: 'Bulgarians', 33: 'Tatars', 34: 'Cumans', 35: 'Lithuanians',
    36: 'Burgundians', 37: 'Sicilians', 38: 'Poles', 39: 'Bohemians'
  };
  
  return civs[civId] || null;
}

module.exports = {
  loadTrackedAccounts,
  pullMatchesForProfile,
  pullAll,
  readAllMatches,
  computePerAccountStats,
  computeConsolidatedStats,
  computeCycles
};
