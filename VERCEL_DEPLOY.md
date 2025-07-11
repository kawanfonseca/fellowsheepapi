# Deploy da API no Vercel

## 🚀 Configurações Necessárias

### 1. Arquivos Criados/Modificados

#### ✅ `vercel.json` - Configuração do Vercel
```json
{
  "version": 2,
  "builds": [
    {
      "src": "app.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/app.js"
    }
  ]
}
```

#### ✅ `app.js` - Modificado para Vercel
- Adicionada rota raiz `/`
- Adicionado suporte para desenvolvimento local
- Mantidos todos os endpoints existentes

#### ✅ `package.json` - Scripts atualizados
- `"start": "node app.js"` - Necessário para o Vercel
- `"dev": "nodemon app.js"` - Para desenvolvimento local

#### ✅ `models/players.models.js` - Caminhos corrigidos
- Uso de `path.join()` para compatibilidade
- Melhor tratamento de erros
- Filtro de linhas vazias

### 2. Estrutura de Arquivos

```
api/
├── app.js                 # ✅ Arquivo principal
├── vercel.json           # ✅ Configuração Vercel
├── package.json          # ✅ Dependências e scripts
├── database/
│   ├── fs_steam_ids.txt  # ✅ IDs dos jogadores FS
│   └── players.txt       # ✅ IDs de todos os jogadores
├── controllers/
│   └── players.controller.js
├── models/
│   └── players.models.js
└── middlewares/
    └── middlewares.js
```

## 🔧 Deploy no Vercel

### 1. Conectar ao Vercel
```bash
# Instalar Vercel CLI (se não tiver)
npm i -g vercel

# Fazer login
vercel login

# Deploy
vercel
```

### 2. Configurações do Deploy
- **Framework Preset:** Node.js
- **Root Directory:** `./` (pasta api)
- **Build Command:** `npm install`
- **Output Directory:** `./`
- **Install Command:** `npm install`

### 3. Variáveis de Ambiente (se necessário)
```bash
NODE_ENV=production
```

## 🧪 Testando a API

### Endpoints Disponíveis:

#### ✅ Status da API
```
GET https://fellowsheepapi.vercel.app/
GET https://fellowsheepapi.vercel.app/api
```

#### ✅ Rankings FS (apenas jogadores do clan)
```
GET https://fellowsheepapi.vercel.app/api/rankFS1v1
GET https://fellowsheepapi.vercel.app/api/rankFSEw
GET https://fellowsheepapi.vercel.app/api/rankFSTg
```

#### ✅ Rankings Todos os Jogadores (NOVOS)
```
GET https://fellowsheepapi.vercel.app/api/rankAll1v1
GET https://fellowsheepapi.vercel.app/api/rankAllEw
GET https://fellowsheepapi.vercel.app/api/rankAllTg
```

#### ✅ Informações de Jogador
```
GET https://fellowsheepapi.vercel.app/api/player?nickname=PlayerName
```

## 🔍 Troubleshooting

### Problema: "Cannot find module"
**Solução:** Verificar se todas as dependências estão no `package.json`

### Problema: "Cannot read file"
**Solução:** Verificar se os arquivos `database/` estão incluídos no deploy

### Problema: "Function timeout"
**Solução:** A API pode demorar para carregar dados externos. Considerar cache.

### Problema: CORS
**Solução:** CORS já está configurado no `app.js`

## 📊 Monitoramento

### Logs no Vercel:
```bash
vercel logs
```

### Métricas:
- Acessar dashboard do Vercel
- Verificar Function Invocations
- Monitorar Response Times

## ✅ Checklist de Deploy

- [ ] ✅ `vercel.json` criado
- [ ] ✅ `app.js` modificado para Vercel
- [ ] ✅ `package.json` com script `start`
- [ ] ✅ Caminhos dos arquivos corrigidos
- [ ] ✅ Todos os arquivos `database/` incluídos
- [ ] ✅ Deploy feito no Vercel
- [ ] ✅ Teste dos endpoints funcionando
- [ ] ✅ URL atualizada no frontend

## 🎯 Resultado Esperado

Após o deploy, a API estará disponível em:
```
https://fellowsheepapi.vercel.app/
```

E o frontend poderá acessar todos os endpoints normalmente.

---

**Status:** ✅ Pronto para deploy
**Última atualização:** $(date) 