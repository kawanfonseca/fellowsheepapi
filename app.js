const express = require("express");
const cors = require("cors");
const app = express();

const logger = require("./middlewares/middlewares");
const {
	getStatus,
	getPlayer,
	getFSRank1v1,
	getFSRankTg,
	getFSRankMax,
	getFSRankEw,
	getAllRank1v1,
	getAllRankTg,
	getAllRankEw,
  getFsLiveLeaderboard,
  getFsLiveMatches,
} = require("./controllers/players.controller");
const { getTwitchStreams, getYouTubeStreams, getAllStreams } = require('./models/streams.models');
const { getFsRecentMatchesInfo } = require('./models/players.models');

app.use(express.json());

app.use(cors());

app.use(logger);

// Rota raiz para verificar se a API está funcionando
app.get("/", getStatus);

app.get("/api", getStatus);

app.get("/api/player", getPlayer);

app.get("/api/rankFS1v1", getFSRank1v1);

app.get("/api/rankFSTg", getFSRankTg);

app.get("/api/rankFSMax", getFSRankMax);

app.get("/api/rankFSEw", getFSRankEw);

// Novos endpoints para todos os jogadores
app.get("/api/rankAll1v1", getAllRank1v1);

app.get("/api/rankAllTg", getAllRankTg);

app.get("/api/rankAllEw", getAllRankEw);

// Novo endpoint: partidas/leaderboard ao vivo filtradas pelos membros FS
app.get("/api/liveFs1v1", getFsLiveLeaderboard);

// Novo endpoint: partidas em andamento dos membros FS (composição dos times)
app.get("/api/liveFsMatches", getFsLiveMatches);

// Partidas recentes
app.get('/api/recentFsMatches', async (req, res) => {
  try {
    const data = await getFsRecentMatchesInfo();
    res.status(200).json(data);
  } catch (_) {
    res.status(200).json([]);
  }
});

// Endpoints de streams
app.get('/api/streams/twitch', async (req, res) => {
  try {
    const data = await getTwitchStreams();
    res.status(200).json(data);
  } catch (_) {
    res.status(200).json([]);
  }
});

app.get('/api/streams/youtube', async (req, res) => {
  try {
    const data = await getYouTubeStreams();
    res.status(200).json(data);
  } catch (_) {
    res.status(200).json([]);
  }
});

app.get('/api/streams', async (req, res) => {
  try {
    const data = await getAllStreams();
    res.status(200).json(data);
  } catch (_) {
    res.status(200).json([]);
  }
});

// Para desenvolvimento local
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
