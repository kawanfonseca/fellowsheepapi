const axios = require("axios");
const rateLimit = require("axios-rate-limit");

infoRequest = rateLimit(axios.create(), {
	maxRequests: 2,
	perMilliseconds: 50,
	maxRPS: 40,
});

const fs = require("fs");

function getFSPlayersProfileId() {
	return new Promise(function (resolve, reject) {
		fs.readFile("./database/fs_steam_ids.txt", "utf-8", (err, players) => {
			if (err) {
				reject(err);
			} else {
				const data = players.split("\n");
				resolve(data);
			}
		});
	});
}

function getAllPlayersProfileId() {
	return new Promise(function (resolve, reject) {
		fs.readFile("./database/players.txt", "utf-8", (err, players) => {
			if (err) {
				reject(err);
			} else {
				const data = players.split("\n");
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
			profile_names: `["/steam/${player.steam_id}"]`,
		};
	} else
		parameters = {
			aliases: `[${player.nickname}]`,
		};

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

// Novas funções para todos os jogadores
function getAllRank1v1Info() {
	return getAllPlayersProfileId().then((data) => {
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

function getAllRankTgInfo() {
	return getAllPlayersProfileId().then((data) => {
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

function getAllRankEWInfo() {
	return getAllPlayersProfileId().then((data) => {
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

module.exports = {
	getPlayerInfo,
	getFSRank1v1Info,
	getFSRankTgInfo,
	getFSRankMaxInfo,
	getFSRankEWInfo,
	getAllRank1v1Info,
	getAllRankTgInfo,
	getAllRankEWInfo,
};
