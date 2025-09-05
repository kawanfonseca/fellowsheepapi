const {
  loadTrackedAccounts,
  pullMatchesForProfile,
  pullAll,
  readAllMatches,
  computePerAccountStats,
  computeConsolidatedStats,
  computeCycles
} = require('../models/tracker.models');

const { getPlayerInfo } = require('../models/players.models');

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
          
          const playerInfoPromise = getPlayerInfo({ profile_id: account.id });
          const playerInfo = await Promise.race([playerInfoPromise, timeoutPromise]);
          
          if (playerInfo && !playerInfo.error) {
            return {
              profile_id: account.id,
              player: {
                nick: playerInfo.nick || account.nick || 'Unknown',
                country: playerInfo.country || 'unknown',
                ratingNow: playerInfo.rm1v1Stats?.rating || null
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

module.exports = {
  postTrackerPull,
  getTrackerVolume,
  getTrackerSummary,
  getTrackerTimeline,
  getTrackerCycles
};
