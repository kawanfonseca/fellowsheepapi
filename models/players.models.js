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
    return null;
  }

  const resp = await historyRequest.get(url, { params, timeout: 10000 });
  const data = resp.data || {};
  const list = Array.isArray(data.matchHistoryStats) ? data.matchHistoryStats : [];
  return list.length > 0 ? list[0] : null;
}

// Detecta se a partida está em andamento: sem completiontime
function isMatchLive(match) {
  if (!match) return false;
  // Considerar sem completiontime ou completiontime = 0 como "ao vivo"
  return !("completiontime" in match) || !match.completiontime;
}

// Mapeamento básico de tipos de partida
const MATCH_TYPE_MAP = {
  7: '1v1 Random Map',
  8: 'Team Random Map',
  9: '1v1 Empire Wars',
  10: 'Team Empire Wars',
};

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
    const results = await Promise.allSettled(
      fsPlayers.map((p) => fetchRecentMatchForPlayer({ steam: p.steam, id: p.id }))
    );

    const matchesById = new Map();

    results.forEach((res, idx) => {
      if (res.status !== 'fulfilled') return;
      const match = res.value;
      if (!isMatchLive(match)) return;

      const matchId = match.id || match.matchhistory_id;
      if (!matchId) return;

      // Montar informação básica
      if (!matchesById.has(matchId)) {
        const members = Array.isArray(match.matchhistorymember) ? match.matchhistorymember : [];
        const team0 = members.filter(m => m.teamid === 0).map(m => ({ profile_id: m.profile_id }));
        const team1 = members.filter(m => m.teamid === 1).map(m => ({ profile_id: m.profile_id }));

        // Decorar nomes para membros FS a partir do arquivo local
        const idToNick = new Map(fsPlayers.map(fp => [Number(fp.id), fp.nick]));
        const decorate = (player) => ({
          profile_id: Number(player.profile_id),
          name: idToNick.get(Number(player.profile_id)) || String(player.profile_id),
          is_fs: idToNick.has(Number(player.profile_id)),
        });

        const gameType = MATCH_TYPE_MAP[match.matchtype_id] || 'Ranked';

        matchesById.set(matchId, {
          id: matchId,
          mapname: match.mapname || 'Unknown',
          matchtype_id: match.matchtype_id,
          gameType,
          startgametime: match.startgametime || 0,
          observertotal: match.observertotal || 0,
          teams: {
            team0: team0.map(decorate),
            team1: team1.map(decorate),
          },
        });
      }
    });

    return Array.from(matchesById.values());
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
