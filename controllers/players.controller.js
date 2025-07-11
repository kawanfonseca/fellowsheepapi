const {
	getPlayerInfo,
	getFSRank1v1Info,
	getFSRankTgInfo,
	getFSRankMaxInfo,
	getFSRankEWInfo,
	getAllRank1v1Info,
	getAllRankTgInfo,
	getAllRankEWInfo,
} = require("../models/players.models");

function getStatus(req, res, next) {
	res.status(200).json({ server: "Live and listening..." });
}

function getPlayer(req, res, next) {
	const player = req.query;

	getPlayerInfo(player)
		.then((data) => {
			res.status(200).json(data);
		})
		.catch((err) => {
			res.status(400).json(err);
		});
}

function getFSRank1v1(req, res, next) {
	getFSRank1v1Info()
		.then((ranking) => {
			res.status(200).send(ranking);
		})
		.catch((err) => {
			console.log(err);
			res.status(400).json(err);
		});
}

function getFSRankTg(req, res, next) {
	getFSRankTgInfo()
		.then((ranking) => {
			res.status(200).send(ranking);
		})
		.catch((err) => {
			res.status(400).json(err);
		});
}

function getFSRankEw(req, res, next) {
	getFSRankEWInfo()
		.then((ranking) => {
			res.status(200).send(ranking);
		})
		.catch((err) => {
			res.status(400).json(err);
		});
}

function getFSRankMax(req, res, next) {
	getFSRankMaxInfo()
		.then((ranking) => {
			res.status(200).send(ranking);
		})
		.catch((err) => {
			res.status(400).json(err);
		});
}

// Novos controllers para todos os jogadores
function getAllRank1v1(req, res, next) {
	getAllRank1v1Info()
		.then((ranking) => {
			res.status(200).send(ranking);
		})
		.catch((err) => {
			console.log(err);
			res.status(400).json(err);
		});
}

function getAllRankTg(req, res, next) {
	getAllRankTgInfo()
		.then((ranking) => {
			res.status(200).send(ranking);
		})
		.catch((err) => {
			res.status(400).json(err);
		});
}

function getAllRankEw(req, res, next) {
	getAllRankEWInfo()
		.then((ranking) => {
			res.status(200).send(ranking);
		})
		.catch((err) => {
			res.status(400).json(err);
		});
}

module.exports = {
	getStatus,
	getPlayer,
	getFSRank1v1,
	getFSRankTg,
	getFSRankMax,
	getFSRankEw,
	getAllRank1v1,
	getAllRankTg,
	getAllRankEw,
};
