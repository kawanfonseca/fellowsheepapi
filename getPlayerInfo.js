const playerRequest = require("axios");
const fs = require("fs");

function getPlayerInfo(playerId, leaderboard_id = 3) {
	return new Promise(function (resolve, reject) {
		playerRequest({
			method: "get",
			url: "https://data.aoe2companion.com/api/nightbot/rank?",
			params: {
				leaderboard_id: leaderboard_id,
				profile_id: playerId,
			},
		})
			.then((ranking) => {
				resolve(ranking.data);
			})
			.catch((err) => {
				reject(err);
			});
	});
}

function getAllPlayers() {
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

function makeRanking(leaderboard_id) {
	return getAllPlayers().then((data) => {
		return Promise.all(
			data.map((player) => getPlayerInfo(player, leaderboard_id))
		)
			.then((players) => {
				let ranking = [];

				let mode =
					leaderboard_id === 3
						? "RM 1v1"
						: leaderboard_id === 4
						? "RM TG"
						: "Unknown";

				players.forEach((player) => {
					if (player !== undefined && player !== "Player not found") {
						nicknames = /[\[Fs\] a-zA-Z0-9 ]{1,}/; // Regex to validate nicknames
						ELO = /\([^\d]*(\d+)[^\d]*\)/;

						const nick = player.match(nicknames); // Fetch the nickname from the result string

						const getElo = player.match(ELO); // Fectch the ELO from the result string with (xxxx)

						const elo = getElo[0].match(/\(([^)]+)\)/); // Remove the parenthesis from the ELO string

						let rankPos = player.match(/#[0-9]{1,4}/); // Get the current ranking position of the player.
						rankPos =
							rankPos === null
								? "No recent activity on " + mode
								: rankPos[0];

						let winrate = player.match(/[0-9]{1,3}% winrate/);
						winrate =
							winrate === null
								? "No recent activity on " + mode
								: winrate[0];

						if (nick !== null) {
							ranking.push({
								nickname: nick[0].trim(),
								elo: Number(elo[1]),
								rankPos: rankPos,
								winrate: winrate,
							});
						}
					}
				});

				ranking = ranking.sort((a, b) => b.elo - a.elo);
				return ranking;
			})
			.catch((err) => {
				console.log("Error resolving players: ", err);
			});
	});
}

makeRanking(3)
	.then((ranking) => {
		//You can manipulate the ranking with the ranking object.
		console.log(ranking);
	})
	.catch((err) => {
		console.log("Error generating the ranking: ", err);
	});
