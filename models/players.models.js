const axios = require("axios");
const rateLimit = require("axios-rate-limit");

infoRequest = rateLimit(axios.create(), {
	maxRequests: 2,
	perMilliseconds: 50,
	maxRPS: 40,
});
// Cliente com rate limit para histórico de partidas
const historyRequest = rateLimit(axios.create(), {
  maxRequests: 2,
  perMilliseconds: 50,
  maxRPS: 40,
});

const fs = require("fs");
const zlib = require('zlib');
// Cache em memória para aliases resolvidos por profile_id
const aliasCacheByProfileId = new Map();

async function fetchAliasForProfileId(profileId) {
  const pid = Number(profileId);
  if (!Number.isFinite(pid)) return null;
  if (aliasCacheByProfileId.has(pid)) return aliasCacheByProfileId.get(pid);

  try {
    const url = 'https://aoe-api.worldsedgelink.com/community/leaderboard/GetPersonalStat';
    const params = {
      title: 'age2',
      profile_ids: JSON.stringify([pid]),
    };
    const resp = await infoRequest.get(url, { params, timeout: 10000 });
    const data = resp.data || {};
    const alias = data?.statGroups?.[0]?.members?.[0]?.alias || null;
    if (alias) aliasCacheByProfileId.set(pid, String(alias));
    return alias;
  } catch (_) {
    return null;
  }
}


function getFSPlayersProfileId() {
    return new Promise(function (resolve, reject) {
        // Ler da lista JSON oficial dos jogadores do clã
        const path = require('path');
        const filePath = path.join(__dirname, '../database/fs_players.json');

        fs.readFile(filePath, 'utf-8', (err, fileContent) => {
            if (err) {
                console.error('Erro ao ler fs_players.json:', err);
                reject(err);
                return;
            }

            try {
                const players = JSON.parse(fileContent);
                // Extrair apenas SteamIDs numéricos válidos, pois o endpoint usa profile_names="/steam/<steamid64>"
                const steamIdList = players
                    .map((p) => (p && p.steam ? String(p.steam).trim() : ''))
                    .filter((steam) => /^\d+$/.test(steam));

                resolve(steamIdList);
            } catch (parseErr) {
                console.error('Erro ao parsear fs_players.json:', parseErr);
                reject(parseErr);
            }
        });
    });
}

// Recupera a lista de profile_ids (IDs do AOE) do arquivo oficial do clã
function getFSPlayersAoEProfileIds() {
    return new Promise(function (resolve, reject) {
        const path = require('path');
        const filePath = path.join(__dirname, '../database/fs_players.json');

        fs.readFile(filePath, 'utf-8', (err, fileContent) => {
            if (err) {
                console.error('Erro ao ler fs_players.json:', err);
                reject(err);
                return;
            }

            try {
                const players = JSON.parse(fileContent);
                // Extrair os IDs do AOE (profile_id) válidos (numéricos)
                const profileIdList = players
                    .map((p) => (p && p.id ? String(p.id).trim() : ''))
                    .filter((id) => /^\d+$/.test(id))
                    .map((id) => Number(id));

                resolve(profileIdList);
            } catch (parseErr) {
                console.error('Erro ao parsear fs_players.json:', parseErr);
                reject(parseErr);
            }
        });
    });
}

// Utilitário: carrega a lista completa do arquivo fs_players.json
async function loadFsPlayers() {
  const path = require('path');
  const filePath = path.join(__dirname, '../database/fs_players.json');
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf-8', (err, content) => {
      if (err) return reject(err);
      try {
        const list = JSON.parse(content);
        resolve(Array.isArray(list) ? list : []);
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Extrair aliases a partir do payload do recentMatchHistory
function extractAliasesFromHistoryPayload(payload) {
  const aliasById = new Map();
  if (!payload || typeof payload !== 'object') return aliasById;
  const scanArray = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (item && typeof item === 'object') {
        const pid = Number(item.profile_id || item.profileId || item.profileid);
        const alias = item.alias || item.name || '';
        if (Number.isFinite(pid) && alias && !aliasById.has(pid)) {
          aliasById.set(pid, String(alias));
        }
      }
    }
  };
  // Chaves comuns observadas na resposta
  scanArray(payload.profiles);
  scanArray(payload.profile);
  // Varrer todas as chaves de arrays para garantir abrangência
  for (const key of Object.keys(payload)) {
    try {
      scanArray(payload[key]);
    } catch (_) {
      // ignore
    }
  }
  return aliasById;
}

// Buscar histórico recente para um jogador (via steam ou profile_id)
async function fetchRecentMatchForPlayer({ steam, id }) {
  const url = 'https://aoe-api.worldsedgelink.com/community/leaderboard/getRecentMatchHistory';
  const params = { title: 'age2' };
  if (steam && /^\d+$/.test(String(steam))) {
    params.profile_names = JSON.stringify([`/steam/${steam}`]);
  } else if (id && /^\d+$/.test(String(id))) {
    // Algumas rotas aceitam profile_ids, usar como fallback
    params.profile_ids = JSON.stringify([Number(id)]);
  } else {
    return { matches: [], aliases: new Map() };
  }

  const resp = await historyRequest.get(url, { params, timeout: 10000 });
  const data = resp.data || {};
  const list = Array.isArray(data.matchHistoryStats) ? data.matchHistoryStats : [];
  const aliases = extractAliasesFromHistoryPayload(data);
  return { matches: list, aliases };
}

// Detecta se a partida está em andamento: sem completiontime
function isMatchLive(match) {
  if (!match) return false;
  // Considerar sem completiontime ou completiontime = 0 como "ao vivo"
  const comp = Number(match.completiontime || 0);
  const start = Number(match.startgametime || 0);
  if (!comp) return true;
  // Às vezes completiontime pode vir 0 mas start indica passado recente
  // Se a partida começou nos últimos 90 minutos, considerar ao vivo
  const nowSec = Math.floor(Date.now() / 1000);
  return start && (nowSec - start) < (90 * 60);
}

// Mapeamento básico de tipos de partida
const MATCH_TYPE_MAP = {
  7: '1v1 Random Map',
  8: 'Team Random Map',
  9: '1v1 Empire Wars',
  10: 'Team Empire Wars',
};

// Normalização de nomes de mapas (RMS/script -> nome amigável)
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

function normalizeMapName(rawName, decodedOptions) {
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
        // Se já vier amigável
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

function decodeOptionsCompressed(optionsStr) {
  if (!optionsStr || typeof optionsStr !== 'string') return null;
  try {
    const buff = Buffer.from(optionsStr, 'base64');
    // Tentar inflate com cabeçalho zlib
    let inflated;
    try {
      inflated = zlib.inflateSync(buff);
    } catch (_) {
      inflated = zlib.inflateRawSync(buff);
    }
    const text = inflated.toString('utf-8');
    // Tentar JSON direto
    try {
      return JSON.parse(text);
    } catch (_) {
      // fallback: tentar extrair pares chave:valor simples
      const obj = {};
      const pairs = text.match(/\b([A-Za-z0-9_]+)\s*[:=]\s*"?([^",\n\r]+)"?/g) || [];
      for (const p of pairs) {
        const m = p.match(/\b([A-Za-z0-9_]+)\s*[:=]\s*"?([^",\n\r]+)"?/);
        if (m) obj[m[1]] = m[2];
      }
      return obj;
    }
  } catch (_) {
    return null;
  }
}

function getAllPlayersProfileId() {
	return new Promise(function (resolve, reject) {
		// Usar path.join para compatibilidade com diferentes sistemas
		const path = require('path');
		const filePath = path.join(__dirname, '../database/players.txt');
		
		fs.readFile(filePath, "utf-8", (err, players) => {
			if (err) {
				console.error('Erro ao ler players.txt:', err);
				reject(err);
			} else {
				const data = players.split("\n").filter(line => line.trim() !== '');
				resolve(data);
			}
		});
	});
}

function getPlayerInfo(player) {
	const playerInfoUrl = `https://aoe-api.worldsedgelink.com/community/leaderboard/GetPersonalStat?title=age2`;
	let parameters = {};

    if (player.hasOwnProperty("profile_id")) {
        parameters = {
            profile_ids: `[${player.profile_id}]`,
        };
    } else if (player.hasOwnProperty("steam_id")) {
        parameters = {
            profile_names: JSON.stringify([`/steam/${player.steam_id}`]),
        };
    } else {
        parameters = {
            aliases: JSON.stringify([player.nickname]),
        };
    }

	return new Promise(function (resolve, reject) {
		infoRequest({
			method: "get",
			url: playerInfoUrl,
			params: parameters,
		})
			.then((playerInfo) => {
				console.log(playerInfo);
				playerInfo.data.leaderboardStats =
					playerInfo.data.leaderboardStats.sort(
						(a, b) => a.leaderboard_id - b.leaderboard_id
					);

				playerInfo.data.leaderboardStats =
					playerInfo.data.leaderboardStats.filter(
						(leaderboard) =>
							leaderboard.leaderboard_id === 3 ||
							leaderboard.leaderboard_id === 4 ||
							leaderboard.leaderboard_id === 27
					);

				if (playerInfo.data.leaderboardStats.length === 3) {
					const playerData = {
						nick: playerInfo.data.statGroups[0].members[0].alias,
						country:
							playerInfo.data.statGroups[0].members[0].country,
						rm1v1Stats: {
							rating: playerInfo.data.leaderboardStats[0].rating,
							wins: playerInfo.data.leaderboardStats[0].wins,
							losses: playerInfo.data.leaderboardStats[0].losses,
							streak: playerInfo.data.leaderboardStats[0].streak,
							drops: playerInfo.data.leaderboardStats[0].drops,
							highestrating:
								playerInfo.data.leaderboardStats[0]
									.highestrating,
						},
						rmTGStats: {
							rating: playerInfo.data.leaderboardStats[1].rating,
							wins: playerInfo.data.leaderboardStats[1].wins,
							losses: playerInfo.data.leaderboardStats[1].losses,
							streak: playerInfo.data.leaderboardStats[1].streak,
							drops: playerInfo.data.leaderboardStats[1].drops,
							highestrating:
								playerInfo.data.leaderboardStats[1]
									.highestrating,
						},
						rmEWStats: {
							rating: playerInfo.data.leaderboardStats[2].rating,
							wins: playerInfo.data.leaderboardStats[2].wins,
							losses: playerInfo.data.leaderboardStats[2].losses,
							streak: playerInfo.data.leaderboardStats[2].streak,
							drops: playerInfo.data.leaderboardStats[2].drops,
							highestrating:
								playerInfo.data.leaderboardStats[2]
									.highestrating,
						},
					};
					resolve(playerData);
				}

				if (playerInfo.data.leaderboardStats.length === 2) {
					const playerData = {
						nick: playerInfo.data.statGroups[0].members[0].alias,
						country:
							playerInfo.data.statGroups[0].members[0].country,
						rm1v1Stats: {
							rating: playerInfo.data.leaderboardStats[0].rating,
							wins: playerInfo.data.leaderboardStats[0].wins,
							losses: playerInfo.data.leaderboardStats[0].losses,
							streak: playerInfo.data.leaderboardStats[0].streak,
							drops: playerInfo.data.leaderboardStats[0].drops,
							highestrating:
								playerInfo.data.leaderboardStats[0]
									.highestrating,
						},
						rmTGStats: {
							rating: playerInfo.data.leaderboardStats[1].rating,
							wins: playerInfo.data.leaderboardStats[1].wins,
							losses: playerInfo.data.leaderboardStats[1].losses,
							streak: playerInfo.data.leaderboardStats[1].streak,
							drops: playerInfo.data.leaderboardStats[1].drops,
							highestrating:
								playerInfo.data.leaderboardStats[1]
									.highestrating,
						},
						rmEWStats: {
							rating: 0,
							wins: 0,
							losses: 0,
							streak: 0,
							drops: 0,
							highestrating: 0,
						},
					};
					resolve(playerData);
				}
				if (playerInfo.data.leaderboardStats.length === 1) {
					const playerData = {
						nick: playerInfo.data.statGroups[0].members[0].alias,
						country:
							playerInfo.data.statGroups[0].members[0].country,
						rm1v1Stats: {
							rating: playerInfo.data.leaderboardStats[0].rating,
							wins: playerInfo.data.leaderboardStats[0].wins,
							losses: playerInfo.data.leaderboardStats[0].losses,
							streak: playerInfo.data.leaderboardStats[0].streak,
							drops: playerInfo.data.leaderboardStats[0].drops,
							highestrating:
								playerInfo.data.leaderboardStats[0]
									.highestrating,
						},
						rmTGStats: {
							rating: 0,
							wins: 0,
							losses: 0,
							streak: 0,
							drops: 0,
							highestrating: 0,
						},
						rmEWStats: {
							rating: 0,
							wins: 0,
							losses: 0,
							streak: 0,
							drops: 0,
							highestrating: 0,
						},
					};

					resolve(playerData);
				}
			})
			.catch((err) => {
				reject(err);
			});
	});
}

function getFSRank1v1Info() {
	return getFSPlayersProfileId().then((data) => {
		const playersArray = data.map((player) =>
			getPlayerInfo({ steam_id: player })
		);

		return Promise.all(playersArray).then((players) => {
			let ranking = [];

			players.forEach((player) => {
				ranking.push({
					nickname: player.nick,
					country: player.country,
					rating: player.rm1v1Stats.rating,
					streak: player.rm1v1Stats.streak,
					wins: player.rm1v1Stats.wins,
					losses: player.rm1v1Stats.losses,
					highestrating: player.rm1v1Stats.highestrating,
				});
			});

			ranking = ranking.sort((a, b) => b.rating - a.rating);

			return ranking;
		});
	});
}

function getFSRankTgInfo() {
	return getFSPlayersProfileId().then((data) => {
		const playersArray = data.map((player) =>
			getPlayerInfo({ steam_id: player })
		);

		return Promise.all(playersArray).then((players) => {
			let ranking = [];

			players.forEach((player) => {
				ranking.push({
					nickname: player.nick,
					country: player.country,
					rating: player.rmTGStats.rating,
					streak: player.rmTGStats.streak,
					wins: player.rmTGStats.wins,
					losses: player.rmTGStats.losses,
					highestrating: player.rmTGStats.highestrating,
				});
			});

			ranking = ranking.sort((a, b) => b.rating - a.rating);

			return ranking;
		});
	});
}

function getFSRankMaxInfo() {
	return getFSPlayersProfileId().then((data) => {
		const playersArray = data.map((player) =>
			getPlayerInfo({ steam_id: player })
		);

		return Promise.all(playersArray).then((players) => {
			let ranking = [];

			players.forEach((player) => {
				ranking.push({
					nickname: player.nick,
					rating1v1: player.rm1v1Stats.highestrating,
					ratingTG: player.rmTGStats.highestrating,
				});
			});

			ranking = ranking.sort((a, b) => b.rating1v1 - a.rating1v1);

			return ranking;
		});
	});
}

function getFSRankEWInfo() {
	return getFSPlayersProfileId().then((data) => {
		const playersArray = data.map((player) =>
			getPlayerInfo({ steam_id: player })
		);

		return Promise.all(playersArray).then((players) => {
			let ranking = [];

			players.forEach((player) => {
				if (player.rmEWStats.rating !== 0) {
					ranking.push({
						nickname: player.nick,
						country: player.country,
						rating: player.rmEWStats.rating,
						streak: player.rmEWStats.streak,
						wins: player.rmEWStats.wins,
						losses: player.rmEWStats.losses,
						highestrating: player.rmEWStats.highestrating,
					});
				}
			});

			ranking = ranking.sort((a, b) => b.rating - a.rating);
			return ranking;
		});
	});
}

// Funções para ranking geral usando a API do AOE2 Companion
async function getAllRank1v1Info() {
  try {
    const response = await axios.get('https://data.aoe2companion.com/api/leaderboards/rm_1v1?direction=forward&search=&page=1');
    const data = Array.isArray(response.data.players) ? response.data.players : [];
    const ranking = data.map((player) => ({
      nickname: player.name || player.nickname || 'Unknown',
      country: player.country || '',
      rating: player.rating || 0,
      streak: player.streak || 0,
      wins: player.wins || 0,
      losses: player.losses || 0,
      rank: player.rank || null,
      games: (player.wins || 0) + (player.losses || 0),
      highestrating: player.highestrating || player.rating || 0,
    }));
    return ranking;
  } catch (err) {
    return [];
  }
}

async function getAllRankTgInfo() {
  try {
    const response = await axios.get('https://data.aoe2companion.com/api/leaderboards/rm_team?direction=forward&search=&page=1');
    const data = Array.isArray(response.data.players) ? response.data.players : [];
    const ranking = data.map((player) => ({
      nickname: player.name || player.nickname || 'Unknown',
      country: player.country || '',
      rating: player.rating || 0,
      streak: player.streak || 0,
      wins: player.wins || 0,
      losses: player.losses || 0,
      rank: player.rank || null,
      games: (player.wins || 0) + (player.losses || 0),
      highestrating: player.highestrating || player.rating || 0,
    }));
    return ranking;
  } catch (err) {
    return [];
  }
}

async function getAllRankEWInfo() {
  try {
    const response = await axios.get('https://data.aoe2companion.com/api/leaderboards/ew_1v1?direction=forward&search=&page=1');
    const data = Array.isArray(response.data.players) ? response.data.players : [];
    const ranking = data.map((player) => ({
      nickname: player.name || player.nickname || 'Unknown',
      country: player.country || '',
      rating: player.rating || 0,
      streak: player.streak || 0,
      wins: player.wins || 0,
      losses: player.losses || 0,
      rank: player.rank || null,
      games: (player.wins || 0) + (player.losses || 0),
      highestrating: player.highestrating || player.rating || 0,
    }));
    return ranking;
  } catch (err) {
    return [];
  }
}

// Proxy do leaderboard oficial para filtrar membros do clã (usando profile_id do AOE)
async function getFsLiveLeaderboardInfo({ leaderboardId = 3, start = 1, count = 200 } = {}) {
  try {
    const fsProfileIds = new Set(await getFSPlayersAoEProfileIds());

    const url = 'https://aoe-api.worldsedgelink.com/community/leaderboard/getLeaderBoard2';
    const params = {
      leaderboard_id: leaderboardId,
      platform: 'PC_STEAM',
      title: 'age2',
      sortBy: 1,
      start,
      count,
    };

    const response = await axios.get(url, { params, timeout: 10000 });
    const raw = response.data || {};

    const list = Array.isArray(raw.leaderboard)
      ? raw.leaderboard
      : Array.isArray(raw.players)
        ? raw.players
        : Array.isArray(raw)
          ? raw
          : [];

    const filtered = list.filter((item) => {
      const profileId = Number(item.profile_id || item.profileId || item.profileid);
      return Number.isFinite(profileId) && fsProfileIds.has(profileId);
    });

    // Normalizar saída
    const normalized = filtered.map((p) => ({
      profile_id: Number(p.profile_id || p.profileId || p.profileid),
      name: p.name || p.nickname || p.alias || 'Unknown',
      rating: Number(p.rating || p.elo || 0),
      rank: Number(p.rank || p.position || 0),
      wins: Number(p.wins || 0),
      losses: Number(p.losses || 0),
      streak: Number(p.streak || 0),
      drops: Number(p.drops || 0),
      highestrating: Number(p.highestrating || p.highest_rating || p.best_rating || p.rating || 0),
      last_match_time: Number(p.last_match_time || p.lastmatchtime || 0),
      country: p.country || p.country_code || '',
    }));

    // Ordenar por rating desc
    normalized.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    return normalized;
  } catch (err) {
    return [];
  }
}

// Agrega partidas em andamento dos membros do clã (via recentMatchHistory)
async function getFsLiveMatchesInfo() {
  try {
    const fsPlayers = await loadFsPlayers();
    // Limitar concorrência para evitar timeouts no serverless
    const chunkSize = 10;
    const allMatches = [];
    const globalAliases = new Map();
    for (let i = 0; i < fsPlayers.length; i += chunkSize) {
      const slice = fsPlayers.slice(i, i + chunkSize);
      const results = await Promise.allSettled(
        slice.map((p) => fetchRecentMatchForPlayer({ steam: p.steam, id: p.id }))
      );
      results.forEach((res) => {
        if (res.status === 'fulfilled' && res.value) {
          const { matches, aliases } = res.value;
          if (Array.isArray(matches)) allMatches.push(...matches);
          if (aliases && typeof aliases.forEach === 'function') {
            aliases.forEach((alias, pid) => {
              if (!globalAliases.has(pid)) globalAliases.set(pid, alias);
            });
          }
        }
      });
    }

    const idToNick = new Map(
      fsPlayers.map(fp => [Number(fp.id), fp.nick])
    );
    const fsIdSet = new Set(fsPlayers.map(fp => Number(fp.id)));
    const matchesById = new Map();
    const unresolvedProfileIds = new Set();

    allMatches.forEach((match) => {
      if (!isMatchLive(match)) return;
      const matchId = match.id || match.matchhistory_id;
      if (!matchId) return;
      if (matchesById.has(matchId)) return;

      const members = Array.isArray(match.matchhistorymember) ? match.matchhistorymember : [];
      const team0 = members.filter(m => m.teamid === 0).map(m => ({ profile_id: m.profile_id }));
      const team1 = members.filter(m => m.teamid === 1).map(m => ({ profile_id: m.profile_id }));

      // Garantir que pelo menos um membro FS esteja nesta partida
      const hasFs = [...team0, ...team1].some(p => fsIdSet.has(Number(p.profile_id)));
      if (!hasFs) return;

      const decorate = (player) => {
        const pid = Number(player.profile_id);
        const fromFs = idToNick.get(pid);
        const fromHistory = globalAliases.get(pid);
        const name = fromFs || fromHistory || String(pid);
        if (!fromFs && !fromHistory) unresolvedProfileIds.add(pid);
        return {
          profile_id: pid,
          name,
          is_fs: idToNick.has(pid),
        };
      };

      // Decodificar options para melhorar detecção de mapa e modo
      const decodedOptions = decodeOptionsCompressed(match.options);
      const mapname = normalizeMapName(match.mapname, decodedOptions);

      // Determinar modo com base em matchtype_id e tamanho dos times
      const isEmpire = match.matchtype_id === 9 || match.matchtype_id === 10 ||
        (decodedOptions && /empire/i.test(JSON.stringify(decodedOptions)));
      const is1v1 = (team0.length === 1 && team1.length === 1);
      const gameType = isEmpire
        ? (is1v1 ? '1v1 Empire Wars' : 'Team Empire Wars')
        : (is1v1 ? '1v1 Random Map' : 'Team Random Map');
      matchesById.set(matchId, {
        id: matchId,
        mapname,
        matchtype_id: match.matchtype_id,
        gameType,
        startgametime: match.startgametime || 0,
        observertotal: match.observertotal || 0,
        teams: {
          team0: team0.map(decorate),
          team1: team1.map(decorate),
        },
      });
    });

    // Resolver aliases pendentes via GetPersonalStat em lote (concorrência limitada)
    const unresolvedList = Array.from(unresolvedProfileIds).slice(0, 100);
    const concurrency = 8;
    for (let i = 0; i < unresolvedList.length; i += concurrency) {
      const batch = unresolvedList.slice(i, i + concurrency);
      // eslint-disable-next-line no-await-in-loop
      const aliases = await Promise.all(batch.map((pid) => fetchAliasForProfileId(pid)));
      aliases.forEach((alias, idx) => {
        const pid = batch[idx];
        if (alias) aliasCacheByProfileId.set(pid, alias);
      });
    }

    // Aplicar aliases resolvidos aos matches
    const result = Array.from(matchesById.values()).map((m) => {
      const replaceName = (p) => {
        if (p.is_fs) return p;
        const alias = aliasCacheByProfileId.get(p.profile_id);
        if (alias && String(p.name) === String(p.profile_id)) {
          return { ...p, name: alias };
        }
        return p;
      };
      return {
        ...m,
        teams: {
          team0: (m.teams?.team0 || []).map(replaceName),
          team1: (m.teams?.team1 || []).map(replaceName),
        },
      };
    });

    return result;
  } catch (err) {
    return [];
  }
}

module.exports = {
	getPlayerInfo,
	getFSRank1v1Info,
	getFSRankTgInfo,
	getFSRankMaxInfo,
	getFSRankEWInfo,
	getAllRank1v1Info,
	getAllRankTgInfo,
	getAllRankEWInfo,
  getFsLiveLeaderboardInfo,
  getFsLiveMatchesInfo,
};
