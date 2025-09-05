# 📊 Elo Tracker - Documentação da API

O módulo Elo Tracker consolida dados de múltiplas contas de Age of Empires 2 DE para fornecer métricas avançadas de performance e análise de tendências.

## 🎯 Funcionalidades

- **Consolidação Multi-Conta**: Agrega dados de todas as contas rastreadas
- **Métricas Avançadas**: Rolling averages, percentis, deltas de Elo
- **Detecção de Tilt**: Identifica sequências de derrotas e quedas de Elo
- **Ciclos de Elo**: Rastreia progressão através de marcos (+100 pontos)
- **Timeline**: Série temporal de evolução do Elo
- **Persistência Flexível**: Suporte para disco local e memória (Vercel)

## 🔧 Configuração

### Variáveis de Ambiente

```bash
# Controle de persistência
USE_DISK_STORAGE=true|false  # default: true

# Timeout para requests da API
API_REQUEST_TIMEOUT_MS=10000  # default: 10000ms
```

### Arquivos de Configuração

- `database/fs_players.json`: Lista de contas rastreadas
- `database/matches-<PROFILE_ID>.json.gz`: Cache de partidas por conta (se USE_DISK_STORAGE=true)

## 📡 Endpoints da API

### POST /api/tracker/pull

Executa pull de matches para uma conta específica ou todas as contas.

**Parâmetros Query:**
- `profile_id` (opcional): ID da conta específica
- `since` (opcional): Timestamp Unix em segundos

**Exemplos:**

```bash
# Pull todas as contas
curl -X POST "http://localhost:3000/api/tracker/pull"

# Pull conta específica
curl -X POST "http://localhost:3000/api/tracker/pull?profile_id=10952501"

# Pull desde timestamp específico
curl -X POST "http://localhost:3000/api/tracker/pull?since=1703980800"
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "added": {
      "10952501": 12,
      "12201758": 4,
      "12201758": 8
    },
    "memory": true
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### GET /api/tracker/volume

Retorna volume de jogos por conta e consolidado.

**Parâmetros Query:**
- `ladder` (opcional): Tipo de ladder, default: `rm_1v1`
- `from` (opcional): Timestamp Unix início
- `to` (opcional): Timestamp Unix fim

**Exemplo:**

```bash
curl "http://localhost:3000/api/tracker/volume?ladder=rm_1v1"
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "byAccount": [
      { "profile_id": 10952501, "week": 14, "month": 52 },
      { "profile_id": 12201758, "week": 11, "month": 47 },
      { "profile_id": 12201758, "week": 9, "month": 41 }
    ],
    "consolidated": { "week": 30, "month": 120 }
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### GET /api/tracker/summary

Retorna métricas completas por conta e consolidado.

**Parâmetros Query:**
- `ladder` (opcional): Tipo de ladder, default: `rm_1v1`
- `from` (opcional): Timestamp Unix início
- `to` (opcional): Timestamp Unix fim
- `includeDetails` (opcional): `true|false`, inclui dados do jogador via WorldsEdgeLink

**Exemplo:**

```bash
curl "http://localhost:3000/api/tracker/summary?includeDetails=true"
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "byAccount": [{
      "profile_id": 10952501,
      "volume": { "week": 14, "month": 52 },
      "rollingAvg": { 
        "g10": 1891, 
        "g20": 1870, 
        "g30": 1868, 
        "g50": 1840, 
        "g100": 1806 
      },
      "percentiles": { 
        "p25": 1860, 
        "p50": 1890, 
        "p75": 1920 
      },
      "delta": { 
        "g10": 22, 
        "g20": 35, 
        "g30": 48 
      },
      "tilt": [{
        "type": "loss_streak",
        "fromMatch": "match123",
        "toMatch": "match127",
        "losses": 4,
        "eloDrop": 56
      }],
      "player": {
        "nick": "Fs.Kawan",
        "country": "br",
        "ratingNow": 1931
      }
    }],
    "consolidated": {
      "volume": { "week": 30, "month": 120 },
      "rollingAvg": { "g10": 1885, "g20": 1872, "g30": 1865, "g50": 1845, "g100": 1810 },
      "percentiles": { "p25": 1865, "p50": 1888, "p75": 1915 },
      "delta": { "g10": 18, "g20": 28, "g30": 35 },
      "tilt": []
    }
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### GET /api/tracker/timeline

Retorna série temporal de evolução do Elo consolidado.

**Parâmetros Query:**
- `granularity` (opcional): `day|week`, default: `day`
- `days` (opcional): Número de dias para trás, default: `90`
- `ladder` (opcional): Tipo de ladder, default: `rm_1v1`

**Exemplo:**

```bash
curl "http://localhost:3000/api/tracker/timeline?granularity=day&days=30"
```

**Resposta:**
```json
{
  "success": true,
  "data": [
    { "bucket": "2024-01-01", "avg_elo": 1875, "last_elo": 1889 },
    { "bucket": "2024-01-02", "avg_elo": 1892, "last_elo": 1901 },
    { "bucket": "2024-01-03", "avg_elo": 1888, "last_elo": 1885 }
  ],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### GET /api/tracker/cycles

Retorna ciclos de Elo (+100 pontos) consolidados.

**Parâmetros Query:**
- `ladder` (opcional): Tipo de ladder, default: `rm_1v1`

**Exemplo:**

```bash
curl "http://localhost:3000/api/tracker/cycles"
```

**Resposta:**
```json
{
  "success": true,
  "data": [
    { 
      "elo_from": 1700, 
      "elo_to": 1800, 
      "games_in_cycle": 142, 
      "days_in_cycle": 34 
    },
    { 
      "elo_from": 1800, 
      "elo_to": 1900, 
      "games_in_cycle": 118, 
      "days_in_cycle": 29 
    },
    { 
      "elo_from": 1900, 
      "elo_to": 2000, 
      "games_in_cycle": 89, 
      "days_in_cycle": 21 
    }
  ],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## 📊 Explicação das Métricas

### Volume
- **week**: Número de jogos nos últimos 7 dias
- **month**: Número de jogos nos últimos 30 dias

### Rolling Averages
- **g10/g20/g30/g50/g100**: Média móvel do Elo nos últimos N jogos
- Útil para suavizar flutuações e identificar tendências

### Percentis
- **P25 (Elo Base)**: 25% dos jogos têm Elo abaixo deste valor
- **P50 (Mediana)**: Elo médio, 50% dos jogos acima/abaixo
- **P75 (Elo Alto)**: 75% dos jogos têm Elo abaixo deste valor
- Calculados sobre os últimos 200 jogos (ou todos se < 200)

### Delta Elo
- **g10/g20/g30**: Diferença entre Elo atual e Elo de N jogos atrás
- Valores positivos = subindo, negativos = descendo

### Detecção de Tilt
Identifica duas situações problemáticas:

1. **Loss Streak**: ≥3 derrotas consecutivas
2. **Elo Drop**: Queda ≥40 pontos em ≤10 jogos

```json
{
  "type": "loss_streak|elo_drop",
  "fromMatch": "id_primeira_partida",
  "toMatch": "id_ultima_partida", 
  "losses": 4,
  "eloDrop": 56
}
```

### Ciclos +100
Rastreia progressão através de marcos de 100 pontos (1700→1800→1900→2000):

- **games_in_cycle**: Jogos necessários para completar o ciclo
- **days_in_cycle**: Dias necessários para completar o ciclo

## 🏗️ Arquitetura

### Fontes de Dados
1. **WorldsEdgeLink API**: Fonte primária (recentMatchHistory)
2. **aoe2.net API**: Fonte secundária para complementar dados

### Persistência
- **Desenvolvimento**: Arquivos `.json.gz` comprimidos em `database/`
- **Produção (Vercel)**: Processamento em memória com `USE_DISK_STORAGE=false`

### Rate Limiting
- **WorldsEdgeLink**: 40 RPS, 2 req/50ms
- **aoe2.net**: 10 RPS, 3 req/1000ms

### Normalização de Partidas
Ambas as fontes são normalizadas para o formato:

```json
{
  "match_id": "string|number",
  "profile_id": "number",
  "started_at": "epoch_seconds",
  "ended_at": "epoch_seconds", 
  "ladder": "rm_1v1|other",
  "map": "string",
  "civ": "string|null",
  "won": "boolean|null",
  "rating_before": "number|null",
  "rating_after": "number|null"
}
```

## 🚀 Deploy em Produção

### Vercel (Serverless)
```bash
# Configurar variável de ambiente
vercel env add USE_DISK_STORAGE false

# Deploy
vercel --prod
```

### Servidor Tradicional
```bash
# Manter persistência em disco
export USE_DISK_STORAGE=true
export API_REQUEST_TIMEOUT_MS=10000

npm start
```

## 🔍 Troubleshooting

### Problemas Comuns

#### "Erro ao ler fs_players.json"
- Verificar se o arquivo existe em `database/fs_players.json`
- Validar formato JSON correto

#### Rate Limiting
- Reduzir concorrência no `pullAll()` (padrão: 5 contas simultâneas)
- Ajustar timeouts se necessário

#### Memória Insuficiente (Vercel)
- Usar `USE_DISK_STORAGE=false`
- Processar menos dados por vez
- Implementar paginação se necessário

#### Dados Inconsistentes
- Executar `POST /api/tracker/pull` para atualizar cache
- Verificar se as contas em `fs_players.json` são válidas

### Logs de Debug
```bash
# Habilitar logs detalhados
DEBUG=tracker:* npm start
```

## 📈 Roadmap

### Funcionalidades Futuras
- [ ] **Análise de Civilizações**: Estatísticas por civ
- [ ] **Análise de Mapas**: Performance por mapa
- [ ] **Comparação Temporal**: Comparar períodos diferentes
- [ ] **Alertas**: Notificações para milestones/tilt
- [ ] **Export**: CSV/Excel das métricas
- [ ] **Gráficos**: Endpoints para dados de charts

### Otimizações Técnicas
- [ ] **Cache Inteligente**: Invalidação baseada em tempo
- [ ] **Batch Processing**: Processamento em lotes maiores
- [ ] **Compression**: Otimizar tamanho dos arquivos
- [ ] **Indexing**: Índices para consultas rápidas

---

*Documentação atualizada em Janeiro 2024*
