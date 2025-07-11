# Implementação de Novos Endpoints - API FellowSheep

## 🎯 Objetivo

Adicionar novos endpoints que retornem **TODOS os jogadores** ao invés de apenas os jogadores FS, permitindo que o filtro seja feito no frontend.

## 📋 Mudanças Necessárias

### 1. Arquivo: `models/players.models.js`

#### Adicionar nova função para ler todos os jogadores:

```javascript
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
```

#### Adicionar novas funções para todos os jogadores:

```javascript
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
```

#### Atualizar exports:

```javascript
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
```

### 2. Arquivo: `controllers/players.controller.js`

#### Adicionar imports:

```javascript
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
```

#### Adicionar novos controllers:

```javascript
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
```

#### Atualizar exports:

```javascript
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
```

### 3. Arquivo: `app.js`

#### Adicionar imports:

```javascript
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
} = require("./controllers/players.controller");
```

#### Adicionar novas rotas:

```javascript
// Novos endpoints para todos os jogadores
app.get("/api/rankAll1v1", getAllRank1v1);

app.get("/api/rankAllTg", getAllRankTg);

app.get("/api/rankAllEw", getAllRankEw);
```

## 🚀 Como Testar

### 1. Reiniciar o servidor:
```bash
npm start
```

### 2. Testar os novos endpoints:

**Todos os jogadores 1v1:**
```
GET http://filipedasilva.co.uk/api/rankAll1v1
```

**Todos os jogadores Team Games:**
```
GET http://filipedasilva.co.uk/api/rankAllTg
```

**Todos os jogadores Empire Wars:**
```
GET http://filipedasilva.co.uk/api/rankAllEw
```

### 3. Comparar com endpoints antigos:

**Apenas FS 1v1:**
```
GET http://filipedasilva.co.uk/api/rankFS1v1
```

## 📊 Diferenças Esperadas

- **Endpoints antigos** (`/rankFS*`): Retornam ~66 jogadores (apenas FS)
- **Endpoints novos** (`/rankAll*`): Retornam ~65 jogadores (todos os jogadores)

## ✅ Resultado Esperado

Após implementar essas mudanças, o site do Kawan poderá:
1. Buscar **todos os jogadores** via API
2. Fazer o **filtro FS no frontend**
3. Mostrar tanto o ranking geral quanto o ranking do clan
4. Ter mais flexibilidade na exibição dos dados

## 🔧 Arquivos Modificados

1. ✅ `models/players.models.js` - Novas funções
2. ✅ `controllers/players.controller.js` - Novos controllers  
3. ✅ `app.js` - Novas rotas

---

**Status:** ✅ Implementação completa
**Impacto:** Baixo - apenas adiciona novos endpoints sem afetar os existentes 