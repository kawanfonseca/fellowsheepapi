# 🐑 FellowSheep API

API REST para gerenciamento de dados do clan FellowSheep Gaming para Age of Empires 2: Definitive Edition.

## 📋 Descrição

Esta API fornece endpoints para consultar informações de jogadores, rankings, partidas e streams relacionados ao clan FellowSheep Gaming. A API utiliza dados da aoe2.net API para fornecer estatísticas atualizadas dos jogadores.

## 🚀 Tecnologias

- **Node.js** - Runtime JavaScript
- **Express.js** - Framework web
- **Axios** - Cliente HTTP para chamadas de API
- **CORS** - Middleware para Cross-Origin Resource Sharing
- **Axios Rate Limit** - Controle de taxa de requisições

## 📁 Estrutura do Projeto

```
fellowsheepapi/
├── controllers/           # Controladores das rotas
│   └── players.controller.js
├── models/               # Modelos de dados
│   ├── players.models.js
│   └── streams.models.js
├── database/            # Arquivos de dados
│   ├── fs_players.json  # Lista de jogadores FS
│   ├── fs_steam_ids.txt # Steam IDs dos membros
│   └── streamers.json   # Dados dos streamers
├── middlewares/         # Middlewares customizados
│   └── middlewares.js
├── app.js              # Configuração do Express
├── server.js           # Servidor principal
└── package.json        # Dependências e scripts
```

## 🛠️ Instalação e Execução

### Pré-requisitos
- Node.js 18+
- npm ou yarn

### Instalação
```bash
# Clonar o repositório
git clone <repository-url>

# Navegar para o diretório
cd fellowsheepapi

# Instalar dependências
npm install
```

### Execução
```bash
# Desenvolvimento (com nodemon)
npm run dev

# Produção
npm start
```

A API estará disponível em `http://localhost:3000`

## 📚 Endpoints da API

### 🔍 Status da API

#### GET `/api/status`
Verifica se a API está funcionando.

**Resposta:**
```json
{
  "server": "Live and listening..."
}
```

---

### 👤 Informações de Jogador

#### GET `/api/player`
Busca informações detalhadas de um jogador específico.

**Parâmetros:**
- `steam_id` (string, opcional): Steam ID do jogador
- `nickname` (string, opcional): Nome do jogador

**Exemplo:**
```bash
GET /api/player?nickname=[Fs] TchachaBR
GET /api/player?steam_id=76561198289002713
```

**Resposta:**
```json
{
  "nick": "[Fs] TchachaBR",
  "country": "gb",
  "rm1v1Stats": {
    "rating": 1467,
    "wins": 1350,
    "losses": 1308,
    "streak": 4,
    "drops": 18,
    "highestrating": 1559
  },
  "rmTGStats": {
    "rating": 1411,
    "wins": 168,
    "losses": 132,
    "streak": -2,
    "drops": 1,
    "highestrating": 1468
  }
}
```

---

### 🏆 Rankings do Clan

#### GET `/api/fs/rank/1v1`
Retorna o ranking 1v1 dos membros do clan FellowSheep.

#### GET `/api/fs/rank/tg`
Retorna o ranking de Team Games dos membros do clan FellowSheep.

#### GET `/api/fs/rank/max`
Retorna o ranking com as maiores pontuações históricas.

#### GET `/api/fs/rank/ew`
Retorna o ranking de Empire Wars dos membros do clan.

**Resposta (exemplo):**
```json
[
  {
    "nickname": "[Fs] Player1",
    "elo": 1500,
    "rankPos": 1234,
    "winrate": "65%",
    "wins": 100,
    "losses": 54,
    "country": "br"
  }
]
```

---

### 🌍 Rankings Globais

#### GET `/api/all/rank/1v1`
Retorna ranking global 1v1.

#### GET `/api/all/rank/tg`
Retorna ranking global de Team Games.

#### GET `/api/all/rank/ew`
Retorna ranking global de Empire Wars.

---

### 🎮 Partidas

#### GET `/api/fs/recent-matches`
Retorna as partidas recentes dos membros do clan.

#### GET `/api/fs/live-matches`
Retorna as partidas em andamento dos membros do clan.

#### GET `/api/fs/live-leaderboard`
Retorna o leaderboard ao vivo dos membros.

---

### 📺 Streams

#### GET `/api/streams/twitch`
Retorna streams ativas no Twitch relacionadas ao clan.

#### GET `/api/streams/youtube`
Retorna streams ativas no YouTube relacionadas ao clan.

#### GET `/api/streams/all`
Retorna todas as streams ativas (Twitch + YouTube).

**Resposta:**
```json
[
  {
    "platform": "twitch",
    "streamer": "StreamerName",
    "title": "Age of Empires 2 - Ranked Games",
    "viewers": 150,
    "url": "https://twitch.tv/streamername",
    "thumbnail": "https://...",
    "isLive": true
  }
]
```

## 🗄️ Base de Dados

### Arquivos de Configuração

- **`fs_players.json`**: Lista completa dos membros do clan com seus dados
- **`fs_steam_ids.txt`**: Steam IDs dos membros (um por linha)
- **`streamers.json`**: Configuração dos streamers do clan

### Estrutura do fs_players.json
```json
[
  {
    "steam_id": "76561198289002713",
    "nickname": "[Fs] Player",
    "country": "br",
    "active": true
  }
]
```

## 🔧 Configuração

### Variáveis de Ambiente
Crie um arquivo `.env` na raiz do projeto:

```env
PORT=3000
NODE_ENV=development
API_RATE_LIMIT=100
```

### Rate Limiting
A API implementa rate limiting para evitar sobrecarga nas APIs externas:
- Limite padrão: 100 requisições por minuto
- Configurável via variável de ambiente

## 🚀 Deploy

### Vercel
O projeto está configurado para deploy no Vercel. O arquivo `vercel.json` contém as configurações necessárias.

```bash
# Deploy via Vercel CLI
vercel --prod
```

### Outras Plataformas
A API pode ser deployada em qualquer plataforma que suporte Node.js:
- Heroku
- Railway
- DigitalOcean App Platform
- AWS Lambda (com adaptações)

## 📊 Monitoramento

### Logs
Os logs são salvos em `run.log` durante a execução.

### Health Check
Use o endpoint `/api/status` para verificar a saúde da API.

## 🤝 Contribuindo

1. Faça um fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -m 'Adiciona nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

## 📝 Notas de Desenvolvimento

### Adicionando Novos Endpoints
1. Adicione a função no controller apropriado
2. Implemente a lógica no model correspondente
3. Registre a rota no `app.js`
4. Atualize esta documentação

### Estrutura de Resposta Padrão
```json
{
  "success": true,
  "data": {},
  "message": "Operação realizada com sucesso",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### Tratamento de Erros
```json
{
  "success": false,
  "error": "Descrição do erro",
  "code": "ERROR_CODE",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

## 📄 Licença

Este projeto está sob a licença ISC. Veja o arquivo `LICENSE` para mais detalhes.

## 📞 Contato

- **Discord**: [discord.gg/fellowsheep](https://discord.gg/fellowsheep)
- **GitHub**: [Repositório do Projeto](https://github.com/fellowsheep/api)
- **Website**: [fellowsheep-gaming.com](https://fellowsheep-gaming.com)

---

*Desenvolvido com ❤️ pela comunidade FellowSheep Gaming*