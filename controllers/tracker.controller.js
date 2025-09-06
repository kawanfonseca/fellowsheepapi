const {
  loadTrackedAccounts,
  pullMatchesForProfile,
  pullAll,
  readAllMatches,
  computePerAccountStats,
  computeConsolidatedStats,
  computeCycles
} = require('../models/tracker.models');

const axios = require("axios");
const rateLimit = require("axios-rate-limit");

// Cliente para WorldsEdgeLink (única API funcional para detalhes)
const welRequest = rateLimit(axios.create({
  httpsAgent: new (require('https').Agent)({
    rejectUnauthorized: false
  })
}), {
  maxRequests: 2,
  perMilliseconds: 50,
  maxRPS: 40,
});

/**
 * Busca detalhes do jogador via WorldsEdgeLink GetPersonalStat (como no script funcional)
 * @param {number} profileId 
 * @returns {Promise<object|null>}
 */
async function getPlayerDetailsFromWEL(profileId) {
  try {
    const url = 'https://aoe-api.worldsedgelink.com/community/leaderboard/GetPersonalStat';
    const params = {
      title: 'age2',
      profile_ids: JSON.stringify([Number(profileId)])
    };
    
    const response = await welRequest.get(url, { params, timeout: 5000 });
    const data = response.data || {};
    
    if (!data.leaderboardStats || !Array.isArray(data.leaderboardStats)) {
      return null;
    }
    
    // Buscar stats de 1v1 RM (leaderboard_id = 3)
    const rm1v1Stats = data.leaderboardStats.find(stat => stat.leaderboard_id === 3);
    if (!rm1v1Stats) {
      return null;
    }
    
    // Buscar alias se disponível
    let nick = 'Unknown';
    if (data.statGroups && data.statGroups[0] && data.statGroups[0].members && data.statGroups[0].members[0]) {
      nick = data.statGroups[0].members[0].alias || 'Unknown';
    }
    
    return {
      nick: nick,
      country: 'unknown', // WorldsEdgeLink não fornece país facilmente
      ratingNow: rm1v1Stats.rating || null,
      maxRating: rm1v1Stats.highestrating || null
    };
    
  } catch (error) {
    console.warn(`Erro ao buscar detalhes WEL para profile ${profileId}:`, error.message);
    return null;
  }
}

/**
 * POST /api/tracker/pull
 * Executa pull de matches para uma conta específica ou todas as contas
 * Query params: ?profile_id=<id> (opcional)
 */
async function postTrackerPull(req, res) {
  try {
    const profileId = req.query.profile_id;
    const sinceTs = req.query.since ? Number(req.query.since) : undefined;
    
    let result;

    if (profileId) {
      // Pull para um perfil específico
      const pid = Number(profileId);
      if (!Number.isFinite(pid)) {
        return res.status(400).json({
          success: false,
          error: 'profile_id deve ser um número válido'
        });
      }

      const pullResult = await pullMatchesForProfile(pid, { sinceTs });
      result = {
        added: { [pid]: pullResult.addedCount }
      };

      if (process.env.USE_DISK_STORAGE === 'false') {
        result.memory = true;
      }
    } else {
      // Pull para todas as contas
      result = await pullAll({ sinceTs });
      
      if (process.env.USE_DISK_STORAGE === 'false') {
        result.memory = true;
      }
    }

    res.status(200).json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erro em postTrackerPull:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * GET /api/tracker/volume
 * Retorna volume de jogos por conta e consolidado
 * Query params: ?ladder=rm_1v1&from=<epoch>&to=<epoch>
 */
async function getTrackerVolume(req, res) {
  try {
    const ladder = req.query.ladder || 'rm_1v1';
    const from = req.query.from ? Number(req.query.from) : undefined;
    const to = req.query.to ? Number(req.query.to) : undefined;

    // Validar parâmetros de tempo
    if (req.query.from && !Number.isFinite(from)) {
      return res.status(400).json({
        success: false,
        error: 'Parâmetro "from" deve ser um timestamp válido'
      });
    }

    if (req.query.to && !Number.isFinite(to)) {
      return res.status(400).json({
        success: false,
        error: 'Parâmetro "to" deve ser um timestamp válido'
      });
    }

    const accounts = await loadTrackedAccounts();
    const allMatches = await readAllMatches({ ladder, from, to });

    // Agrupar por conta
    const matchesByAccount = {};
    accounts.forEach(account => {
      matchesByAccount[account.id] = allMatches.filter(m => m.profile_id === account.id);
    });

    // Calcular volume por conta
    const byAccount = accounts.map(account => {
      const matches = matchesByAccount[account.id] || [];
      const stats = computePerAccountStats(matches);
      
      return {
        profile_id: account.id,
        week: stats.volume.week,
        month: stats.volume.month
      };
    });

    // Calcular volume consolidado
    const consolidatedStats = computePerAccountStats(allMatches);

    res.status(200).json({
      success: true,
      data: {
        byAccount,
        consolidated: {
          week: consolidatedStats.volume.week,
          month: consolidatedStats.volume.month
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erro em getTrackerVolume:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * GET /api/tracker/summary
 * Retorna métricas completas por conta e consolidado
 * Query params: ?ladder=rm_1v1&from=<epoch>&to=<epoch>&includeDetails=false
 */
async function getTrackerSummary(req, res) {
  try {
    const ladder = req.query.ladder || 'rm_1v1';
    const from = req.query.from ? Number(req.query.from) : undefined;
    const to = req.query.to ? Number(req.query.to) : undefined;
    const includeDetails = req.query.includeDetails === 'true';

    // Timeout mais agressivo para Vercel (máximo 10 segundos)
    const isServerless = process.env.VERCEL || process.env.USE_DISK_STORAGE === 'false';
    const maxTimeout = isServerless ? 9000 : 25000; // 9s para Vercel, 25s para desenvolvimento
    
    const startTime = Date.now();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Request timeout - operação muito lenta')), maxTimeout)
    );

    // Validar parâmetros de tempo
    if (req.query.from && !Number.isFinite(from)) {
      return res.status(400).json({
        success: false,
        error: 'Parâmetro "from" deve ser um timestamp válido'
      });
    }

    if (req.query.to && !Number.isFinite(to)) {
      return res.status(400).json({
        success: false,
        error: 'Parâmetro "to" deve ser um timestamp válido'
      });
    }

    // Executar operação principal com timeout
    const mainOperation = async () => {
      const accounts = await loadTrackedAccounts();
      const allMatches = await readAllMatches({ ladder, from, to });

      // Agrupar por conta
      const matchesByAccount = {};
      accounts.forEach(account => {
        matchesByAccount[account.id] = allMatches.filter(m => m.profile_id === account.id);
      });

      // Calcular estatísticas
      const { byAccount: statsByAccount, consolidated } = computeConsolidatedStats(matchesByAccount);
      
      return { accounts, statsByAccount, consolidated };
    };

    const { accounts, statsByAccount, consolidated } = await Promise.race([
      mainOperation(),
      timeoutPromise
    ]);

    // Montar resposta por conta
    const byAccountResponse = [];

    if (includeDetails) {
      // Buscar detalhes em paralelo com timeout reduzido para evitar timeout geral
      const detailsPromises = accounts.map(async (account) => {
        try {
          // Timeout reduzido para cada chamada individual
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout individual')), 3000)
          );
          
          const playerInfoPromise = getPlayerDetailsFromWEL(account.id);
          const playerInfo = await Promise.race([playerInfoPromise, timeoutPromise]);
          
          if (playerInfo) {
            return {
              profile_id: account.id,
              player: {
                nick: playerInfo.nick || account.nick || 'Unknown',
                country: playerInfo.country || 'unknown',
                ratingNow: playerInfo.ratingNow || null
              }
            };
          }
        } catch (detailsError) {
          console.warn(`Erro ao buscar detalhes para profile ${account.id}:`, detailsError.message);
        }
        
        // Fallback para dados básicos
        return {
          profile_id: account.id,
          player: {
            nick: account.nick || 'Unknown',
            country: 'unknown',
            ratingNow: null
          }
        };
      });

      // Executar todas as chamadas em paralelo com timeout global (mais conservador para Vercel)
      const detailsTimeout = isServerless ? 4000 : 8000; // 4s para Vercel, 8s para desenvolvimento
      const globalTimeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout global para detalhes')), detailsTimeout)
      );

      let accountDetails = [];
      try {
        accountDetails = await Promise.race([
          Promise.allSettled(detailsPromises),
          globalTimeoutPromise
        ]);
      } catch (globalTimeoutError) {
        console.warn('Timeout global ao buscar detalhes dos jogadores, usando dados básicos');
        accountDetails = accounts.map(account => ({
          status: 'fulfilled',
          value: {
            profile_id: account.id,
            player: {
              nick: account.nick || 'Unknown',
              country: 'unknown',
              ratingNow: null
            }
          }
        }));
      }

      // Mapear detalhes por profile_id
      const detailsMap = new Map();
      accountDetails.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          detailsMap.set(result.value.profile_id, result.value.player);
        } else {
          // Fallback se a promise falhou
          const account = accounts[index];
          detailsMap.set(account.id, {
            nick: account.nick || 'Unknown',
            country: 'unknown',
            ratingNow: null
          });
        }
      });

      // Montar resposta final
      for (const account of accounts) {
        const accountStats = statsByAccount[account.id] || {
          volume: { week: 0, month: 0 },
          rollingAvg: { g10: null, g20: null, g30: null, g50: null, g100: null },
          percentiles: { p25: null, p50: null, p75: null },
          delta: { g10: null, g20: null, g30: null },
          tilt: []
        };

        const accountData = {
          profile_id: account.id,
          volume: accountStats.volume,
          rollingAvg: accountStats.rollingAvg,
          percentiles: accountStats.percentiles,
          delta: accountStats.delta,
          tilt: accountStats.tilt,
          player: detailsMap.get(account.id) || {
            nick: account.nick || 'Unknown',
            country: 'unknown',
            ratingNow: null
          }
        };

        byAccountResponse.push(accountData);
      }
    } else {
      // Sem detalhes - resposta rápida
      for (const account of accounts) {
        const accountStats = statsByAccount[account.id] || {
          volume: { week: 0, month: 0 },
          rollingAvg: { g10: null, g20: null, g30: null, g50: null, g100: null },
          percentiles: { p25: null, p50: null, p75: null },
          delta: { g10: null, g20: null, g30: null },
          tilt: []
        };

        const accountData = {
          profile_id: account.id,
          volume: accountStats.volume,
          rollingAvg: accountStats.rollingAvg,
          percentiles: accountStats.percentiles,
          delta: accountStats.delta,
          tilt: accountStats.tilt
        };

        byAccountResponse.push(accountData);
      }
    }

    const processingTime = Date.now() - startTime;
    console.log(`Summary processado em ${processingTime}ms (includeDetails: ${includeDetails})`);

    res.status(200).json({
      success: true,
      data: {
        byAccount: byAccountResponse,
        consolidated: {
          volume: consolidated.volume,
          rollingAvg: consolidated.rollingAvg,
          percentiles: consolidated.percentiles,
          delta: consolidated.delta,
          tilt: consolidated.tilt
        }
      },
      meta: {
        processingTime: processingTime,
        includeDetails: includeDetails,
        accountsProcessed: byAccountResponse.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erro em getTrackerSummary:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * GET /api/tracker/timeline
 * Retorna série temporal de Elo consolidado
 * Query params: ?granularity=day|week&days=90&ladder=rm_1v1
 */
async function getTrackerTimeline(req, res) {
  try {
    const granularity = req.query.granularity || 'day';
    const days = req.query.days ? Number(req.query.days) : 90;
    const ladder = req.query.ladder || 'rm_1v1';

    // Validar parâmetros
    if (!['day', 'week'].includes(granularity)) {
      return res.status(400).json({
        success: false,
        error: 'Granularity deve ser "day" ou "week"'
      });
    }

    if (!Number.isFinite(days) || days <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Days deve ser um número positivo'
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const from = now - (days * 24 * 60 * 60);

    const allMatches = await readAllMatches({ ladder, from });

    if (allMatches.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        timestamp: new Date().toISOString()
      });
    }

    // Agrupar por bucket de tempo
    const buckets = new Map();
    const bucketSize = granularity === 'day' ? 24 * 60 * 60 : 7 * 24 * 60 * 60;

    allMatches.forEach(match => {
      if (!match.ended_at || !Number.isFinite(match.rating_after)) return;

      const bucketStart = Math.floor(match.ended_at / bucketSize) * bucketSize;
      const bucketKey = new Date(bucketStart * 1000).toISOString().split('T')[0];

      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, {
          bucket: bucketKey,
          ratings: [],
          lastRating: null,
          lastTimestamp: 0
        });
      }

      const bucket = buckets.get(bucketKey);
      bucket.ratings.push(match.rating_after);

      // Manter o rating mais recente do bucket
      if (match.ended_at > bucket.lastTimestamp) {
        bucket.lastRating = match.rating_after;
        bucket.lastTimestamp = match.ended_at;
      }
    });

    // Calcular médias e montar timeline
    const timeline = Array.from(buckets.values()).map(bucket => ({
      bucket: bucket.bucket,
      avg_elo: Math.round(bucket.ratings.reduce((sum, r) => sum + r, 0) / bucket.ratings.length),
      last_elo: bucket.lastRating
    }));

    // Ordenar por data
    timeline.sort((a, b) => a.bucket.localeCompare(b.bucket));

    res.status(200).json({
      success: true,
      data: timeline,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erro em getTrackerTimeline:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * GET /api/tracker/cycles
 * Retorna ciclos de Elo (+100 pontos) consolidados
 * Query params: ?ladder=rm_1v1
 */
async function getTrackerCycles(req, res) {
  try {
    const ladder = req.query.ladder || 'rm_1v1';

    const allMatches = await readAllMatches({ ladder });
    const cycles = computeCycles(allMatches);

    res.status(200).json({
      success: true,
      data: cycles,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erro em getTrackerCycles:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * GET /api/tracker/player/:profileId/history
 * Retorna histórico completo de um jogador específico
 * Query params: ?from=<epoch>&to=<epoch>&limit=<number>&sort=asc|desc
 */
async function getPlayerHistory(req, res) {
  try {
    const { profileId } = req.params;
    const pid = Number(profileId);
    const from = req.query.from ? Number(req.query.from) : undefined;
    const to = req.query.to ? Number(req.query.to) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const sortOrder = req.query.sort === 'asc' ? 'asc' : 'desc';

    if (!Number.isFinite(pid)) {
      return res.status(400).json({
        success: false,
        error: 'ID do perfil deve ser um número válido'
      });
    }

    // Carregar matches do jogador
    const allMatches = await readAllMatches({ ladder: 'rm_1v1', from, to });
    const playerMatches = allMatches.filter(m => m.profile_id === pid);

    // Aplicar limite se especificado
    let matchesToReturn = playerMatches;
    if (Number.isFinite(limit) && limit > 0) {
      matchesToReturn = matchesToReturn.slice(0, limit);
    }

    // Ordenar
    matchesToReturn.sort((a, b) => {
      const order = sortOrder === 'asc' ? 1 : -1;
      return order * (a.ended_at - b.ended_at);
    });

    // Buscar detalhes do jogador
    let playerDetails = null;
    try {
      const accounts = await loadTrackedAccounts();
      const account = accounts.find(acc => acc.id === pid);
      if (account) {
        playerDetails = await getPlayerDetailsFromWEL(pid);
        if (playerDetails) {
          playerDetails = {
            ...playerDetails,
            nick: account.nick || playerDetails.nick
          };
        }
      }
    } catch (detailsError) {
      console.warn(`Erro ao buscar detalhes do jogador ${pid}:`, detailsError.message);
    }

    // Calcular estatísticas do período
    const stats = computePerAccountStats(matchesToReturn);

    // Calcular progresso por períodos
    const now = Math.floor(Date.now() / 1000);
    const weekAgo = now - (7 * 24 * 60 * 60);
    const monthAgo = now - (30 * 24 * 60 * 60);
    const quarterAgo = now - (90 * 24 * 60 * 60);

    const progressStats = {
      lastWeek: calculatePeriodProgress(matchesToReturn, weekAgo, now),
      lastMonth: calculatePeriodProgress(matchesToReturn, monthAgo, now),
      lastQuarter: calculatePeriodProgress(matchesToReturn, quarterAgo, now),
      overall: calculatePeriodProgress(matchesToReturn)
    };

    // Calcular correlação volume vs progresso
    const volumeProgressCorrelation = calculateVolumeProgressCorrelation(matchesToReturn);

    // Analisar padrões de jogo
    const gamePatterns = analyzeGamePatterns(matchesToReturn);

    res.status(200).json({
      success: true,
      data: {
        profile_id: pid,
        player: playerDetails,
        total_matches: matchesToReturn.length,
        matches: matchesToReturn,
        stats: stats,
        progress: progressStats,
        volume_progress_correlation: volumeProgressCorrelation,
        game_patterns: gamePatterns,
        period: {
          from: from,
          to: to,
          limit: limit,
          sort: sortOrder
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erro em getPlayerHistory:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Calcula progresso em um período específico
 * @param {Array} matches - Matches ordenados por ended_at asc
 * @param {number} fromTs - Timestamp início (opcional)
 * @param {number} toTs - Timestamp fim (opcional)
 * @returns {object}
 */
function calculatePeriodProgress(matches, fromTs, toTs) {
  let periodMatches = matches;

  if (fromTs || toTs) {
    periodMatches = matches.filter(m => {
      if (fromTs && m.ended_at < fromTs) return false;
      if (toTs && m.ended_at > toTs) return false;
      return true;
    });
  }

  if (periodMatches.length === 0) {
    return {
      games: 0,
      elo_change: 0,
      win_rate: 0,
      avg_elo: null,
      start_elo: null,
      end_elo: null
    };
  }

  const firstMatch = periodMatches[0];
  const lastMatch = periodMatches[periodMatches.length - 1];

  const eloChange = lastMatch.rating_after - firstMatch.rating_before;
  const wins = periodMatches.filter(m => m.won === true).length;
  const winRate = (wins / periodMatches.length) * 100;

  const avgElo = periodMatches.reduce((sum, m) => sum + (m.rating_after || 0), 0) / periodMatches.length;

  // Calcular métricas de eficiência
  const totalDays = periodMatches.length > 1 ?
    (lastMatch.ended_at - firstMatch.ended_at) / (24 * 60 * 60) : 1;
  const gamesPerDay = periodMatches.length / Math.max(totalDays, 1);
  const eloPerGame = periodMatches.length > 0 ? eloChange / periodMatches.length : 0;
  const eloPerDay = eloChange / Math.max(totalDays, 1);

  return {
    games: periodMatches.length,
    elo_change: Math.round(eloChange),
    win_rate: Math.round(winRate * 10) / 10,
    avg_elo: Math.round(avgElo),
    start_elo: firstMatch.rating_before,
    end_elo: lastMatch.rating_after,
    // Métricas de eficiência
    games_per_day: Math.round(gamesPerDay * 100) / 100,
    elo_per_game: Math.round(eloPerGame * 100) / 100,
    elo_per_day: Math.round(eloPerDay * 100) / 100,
    total_days: Math.round(totalDays * 100) / 100
  };
}

/**
 * Calcula correlação entre volume de jogos e progresso
 * @param {Array} matches - Matches ordenados por ended_at asc
 * @returns {object}
 */
function calculateVolumeProgressCorrelation(matches) {
  if (!Array.isArray(matches) || matches.length < 10) {
    return {
      correlation_coefficient: null,
      analysis: "Dados insuficientes para análise de correlação",
      recommendation: "Jogue mais para gerar dados suficientes",
      efficiency_brackets: []
    };
  }

  // Agrupar jogos em períodos de 7 dias
  const weeklyGroups = {};
  matches.forEach(match => {
    const weekStart = Math.floor(match.ended_at / (7 * 24 * 60 * 60)) * (7 * 24 * 60 * 60);
    if (!weeklyGroups[weekStart]) {
      weeklyGroups[weekStart] = [];
    }
    weeklyGroups[weekStart].push(match);
  });

  // Calcular métricas por semana
  const weeklyStats = Object.entries(weeklyGroups).map(([weekStart, weekMatches]) => {
    if (weekMatches.length === 0) return null;

    const games = weekMatches.length;
    const firstMatch = weekMatches[0];
    const lastMatch = weekMatches[weekMatches.length - 1];
    const eloChange = lastMatch.rating_after - firstMatch.rating_before;
    const wins = weekMatches.filter(m => m.won === true).length;
    const winRate = (wins / games) * 100;

    return {
      week_start: parseInt(weekStart),
      games: games,
      elo_change: eloChange,
      win_rate: Math.round(winRate * 10) / 10,
      efficiency: eloChange / games // Elo ganho por jogo
    };
  }).filter(stat => stat !== null);

  if (weeklyStats.length < 3) {
    return {
      correlation_coefficient: null,
      analysis: "Poucos períodos para análise significativa",
      recommendation: "Continue jogando por mais semanas",
      efficiency_brackets: []
    };
  }

  // Calcular correlação entre volume e progresso
  const volumes = weeklyStats.map(s => s.games);
  const progresses = weeklyStats.map(s => s.elo_change);

  const correlation = calculateCorrelation(volumes, progresses);

  // Analisar eficiência por brackets de volume
  const brackets = [
    { min: 0, max: 5, label: "Poucos jogos (0-5/semana)" },
    { min: 6, max: 15, label: "Moderado (6-15/semana)" },
    { min: 16, max: 25, label: "Muito ativo (16-25/semana)" },
    { min: 26, max: Infinity, label: "Extremamente ativo (26+/semana)" }
  ];

  const efficiencyBrackets = brackets.map(bracket => {
    const bracketStats = weeklyStats.filter(s => s.games >= bracket.min && s.games <= bracket.max);

    if (bracketStats.length === 0) {
      return {
        bracket: bracket.label,
        avg_games: 0,
        avg_efficiency: 0,
        avg_win_rate: 0,
        sample_size: 0
      };
    }

    const avgGames = bracketStats.reduce((sum, s) => sum + s.games, 0) / bracketStats.length;
    const avgEfficiency = bracketStats.reduce((sum, s) => sum + s.efficiency, 0) / bracketStats.length;
    const avgWinRate = bracketStats.reduce((sum, s) => sum + s.win_rate, 0) / bracketStats.length;

    return {
      bracket: bracket.label,
      avg_games: Math.round(avgGames * 10) / 10,
      avg_efficiency: Math.round(avgEfficiency * 100) / 100,
      avg_win_rate: Math.round(avgWinRate * 10) / 10,
      sample_size: bracketStats.length
    };
  });

  // Análise da correlação
  let analysis, recommendation;
  if (correlation > 0.5) {
    analysis = "Correlação positiva forte: quanto mais você joga, mais progride";
    recommendation = "Continue com o volume atual de jogos!";
  } else if (correlation > 0.2) {
    analysis = "Correlação positiva moderada: jogar mais tende a ajudar no progresso";
    recommendation = "Considere aumentar ligeiramente o volume de jogos";
  } else if (correlation > -0.2) {
    analysis = "Correlação neutra: o volume não impacta significativamente o progresso";
    recommendation = "Foque na qualidade dos jogos ao invés do volume";
  } else if (correlation > -0.5) {
    analysis = "Correlação negativa moderada: jogar demais pode prejudicar o progresso";
    recommendation = "Considere reduzir o volume e focar em jogos de melhor qualidade";
  } else {
    analysis = "Correlação negativa forte: volume excessivo prejudica o progresso";
    recommendation = "Reduza significativamente o volume de jogos e melhore a qualidade";
  }

  return {
    correlation_coefficient: Math.round(correlation * 1000) / 1000,
    analysis: analysis,
    recommendation: recommendation,
    efficiency_brackets: efficiencyBrackets,
    total_weeks_analyzed: weeklyStats.length
  };
}

/**
 * Calcula coeficiente de correlação de Pearson entre dois arrays
 * @param {Array} x
 * @param {Array} y
 * @returns {number}
 */
function calculateCorrelation(x, y) {
  if (x.length !== y.length || x.length === 0) return 0;

  const n = x.length;
  const sumX = x.reduce((sum, val) => sum + val, 0);
  const sumY = y.reduce((sum, val) => sum + val, 0);
  const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
  const sumX2 = x.reduce((sum, val) => sum + val * val, 0);
  const sumY2 = y.reduce((sum, val) => sum + val * val, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Analisa padrões de jogo (dias da semana, horários)
 * @param {Array} matches - Matches ordenados por ended_at asc
 * @returns {object}
 */
function analyzeGamePatterns(matches) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return {
      weekday_distribution: {},
      hour_distribution: {},
      peak_day: null,
      peak_hour: null,
      consistency_score: 0,
      insights: []
    };
  }

  const weekdayStats = {};
  const hourStats = {};

  // Dias da semana (0 = Domingo, 1 = Segunda, etc.)
  const weekdays = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

  // Inicializar contadores
  weekdays.forEach(day => {
    weekdayStats[day] = { games: 0, wins: 0, elo_change: 0 };
  });

  for (let hour = 0; hour < 24; hour++) {
    hourStats[hour] = { games: 0, wins: 0, elo_change: 0 };
  }

  // Analisar cada partida
  matches.forEach(match => {
    if (!match.ended_at) return;

    const date = new Date(match.ended_at * 1000);
    const weekday = weekdays[date.getDay()];
    const hour = date.getHours();

    // Estatísticas por dia da semana
    weekdayStats[weekday].games++;
    if (match.won === true) weekdayStats[weekday].wins++;
    if (Number.isFinite(match.rating_before) && Number.isFinite(match.rating_after)) {
      weekdayStats[weekday].elo_change += match.rating_after - match.rating_before;
    }

    // Estatísticas por hora
    hourStats[hour].games++;
    if (match.won === true) hourStats[hour].wins++;
    if (Number.isFinite(match.rating_before) && Number.isFinite(match.rating_after)) {
      hourStats[hour].elo_change += match.rating_after - match.rating_before;
    }
  });

  // Calcular métricas derivadas
  const weekdayDistribution = {};
  const hourDistribution = {};

  weekdays.forEach(day => {
    const stats = weekdayStats[day];
    weekdayDistribution[day] = {
      games: stats.games,
      win_rate: stats.games > 0 ? Math.round((stats.wins / stats.games) * 100) : 0,
      avg_elo_change: stats.games > 0 ? Math.round(stats.elo_change / stats.games * 100) / 100 : 0
    };
  });

  for (let hour = 0; hour < 24; hour++) {
    const stats = hourStats[hour];
    hourDistribution[hour] = {
      games: stats.games,
      win_rate: stats.games > 0 ? Math.round((stats.wins / stats.games) * 100) : 0,
      avg_elo_change: stats.games > 0 ? Math.round(stats.elo_change / stats.games * 100) / 100 : 0
    };
  }

  // Encontrar dias e horários de pico
  const peakDay = weekdays.reduce((peak, day) => {
    return weekdayStats[day].games > weekdayStats[peak].games ? day : peak;
  }, weekdays[0]);

  let peakHour = 0;
  let maxGames = 0;
  for (let hour = 0; hour < 24; hour++) {
    if (hourStats[hour].games > maxGames) {
      maxGames = hourStats[hour].games;
      peakHour = hour;
    }
  }

  // Calcular score de consistência (jogos distribuídos vs concentrados)
  const totalGames = matches.length;
  const avgGamesPerWeekday = totalGames / 7;
  const variance = weekdays.reduce((sum, day) => {
    const diff = weekdayStats[day].games - avgGamesPerWeekday;
    return sum + (diff * diff);
  }, 0) / 7;

  const consistencyScore = Math.max(0, Math.min(100, 100 - (variance / avgGamesPerWeekday) * 10));

  // Gerar insights
  const insights = [];

  if (weekdayStats[peakDay].games > totalGames * 0.3) {
    insights.push({
      type: 'pattern',
      icon: '📅',
      message: `${peakDay} é seu dia principal de jogo (${weekdayStats[peakDay].games} partidas)`
    });
  }

  if (maxGames > totalGames * 0.25) {
    const period = peakHour >= 6 && peakHour < 12 ? 'manhã' :
                   peakHour >= 12 && peakHour < 18 ? 'tarde' :
                   peakHour >= 18 && peakHour < 22 ? 'noite' : 'madrugada';
    insights.push({
      type: 'pattern',
      icon: '🕐',
      message: `Você joga principalmente à ${period} (${peakHour}:00)`
    });
  }

  if (consistencyScore > 80) {
    insights.push({
      type: 'positive',
      icon: '📊',
      message: 'Excelente consistência nos dias de jogo!'
    });
  } else if (consistencyScore < 40) {
    insights.push({
      type: 'info',
      icon: '🔄',
      message: 'Considere distribuir melhor os jogos durante a semana'
    });
  }

  // Melhor dia para performance
  const bestDay = weekdays.reduce((best, day) => {
    const currentWinRate = weekdayStats[day].games > 0 ? weekdayStats[day].wins / weekdayStats[day].games : 0;
    const bestWinRate = weekdayStats[best].games > 0 ? weekdayStats[best].wins / weekdayStats[best].games : 0;
    return currentWinRate > bestWinRate ? day : best;
  }, weekdays[0]);

  if (weekdayStats[bestDay].games >= 3) {
    const bestWinRate = Math.round((weekdayStats[bestDay].wins / weekdayStats[bestDay].games) * 100);
    insights.push({
      type: 'performance',
      icon: '🏆',
      message: `${bestDay} é seu melhor dia (${bestWinRate}% win rate)`
    });
  }

  return {
    weekday_distribution: weekdayDistribution,
    hour_distribution: hourDistribution,
    peak_day: peakDay,
    peak_hour: peakHour,
    consistency_score: Math.round(consistencyScore),
    insights: insights
  };
}

module.exports = {
  postTrackerPull,
  getTrackerVolume,
  getTrackerSummary,
  getTrackerTimeline,
  getTrackerCycles,
  getPlayerHistory
};
