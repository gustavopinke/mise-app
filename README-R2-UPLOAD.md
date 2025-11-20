# 📸 Upload de Fotos para Cloudflare R2

Este documento explica como configurar e fazer upload de fotos de produtos para o Cloudflare R2.

## 🎯 Visão Geral

O sistema agora suporta armazenamento de fotos em duas localizações:
1. **Cloudflare R2** (recomendado) - Armazenamento em nuvem escalável
2. **Sistema de arquivos local** (fallback) - Para desenvolvimento e compatibilidade

Quando configurado, o sistema tenta buscar fotos do R2 primeiro, e usa o armazenamento local como fallback.

## ⚙️ Configuração

### 1. Criar Credenciais do R2

Acesse o [Cloudflare Dashboard](https://dash.cloudflare.com/) e:

1. Vá em **R2** no menu lateral
2. Clique em **Manage R2 API Tokens**
3. Crie um novo token com permissões de leitura/escrita
4. Anote:
   - Access Key ID
   - Secret Access Key
   - Account ID (visível na URL do dashboard)

### 2. Configurar Variáveis de Ambiente

Copie o arquivo `.env.example` para `.env`:

```bash
cp .env.example .env
```

Edite o arquivo `.env` e preencha com suas credenciais:

```env
# Cloudflare R2 Configuration
R2_ACCOUNT_ID=79a87cdae451f906824c74cd1db9
R2_ACCESS_KEY_ID=sua_access_key_aqui
R2_SECRET_ACCESS_KEY=sua_secret_key_aqui
R2_BUCKET_NAME=mise
R2_PUBLIC_URL=https://79a87cdae451f906824c74cd1db9.r2.cloudflarestorage.com

# Server Configuration
PORT=3000
NODE_ENV=production
```

### 3. Instalar Dependências

```bash
npm install
```

## 📤 Upload de Fotos

### Convenção de Nomenclatura

As fotos devem seguir este padrão:
- `{codigo_de_barras}.{ext}` - Ex: `7891234567890.jpg`
- `{codigo_de_barras}_mise.{ext}` - Ex: `7891234567890_mise.jpg`

Extensões suportadas: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`

### Opção 1: Upload de Diretório Local

Se você tem as fotos no diretório `data/fotos_produtos/`:

```bash
node upload-fotos-r2.js
```

### Opção 2: Upload de Diretório Customizado

Se as fotos estão em outro local:

```bash
node upload-fotos-r2.js /caminho/para/suas/fotos
```

### Exemplo com 120k Fotos

```bash
# Supondo que suas fotos estejam em ~/Downloads/fotos_produtos
node upload-fotos-r2.js ~/Downloads/fotos_produtos
```

O script irá:
- ✅ Processar apenas arquivos de imagem válidos
- ⏭️ Pular arquivos que já existem no R2 (evita duplicatas)
- 📊 Mostrar progresso em tempo real
- 📈 Exibir estatísticas ao final

### Saída Esperada

```
🚀 MISE - Upload de Fotos para Cloudflare R2

📁 Diretório de origem: /home/user/fotos
☁️  Bucket R2: mise
🔑 Account ID: 79a87cdae451f906824c74cd1db9

📊 Total de imagens encontradas: 120000
📤 Iniciando upload para R2 (bucket: mise)...

✅ [1/120000] (0.0%) Upload: 7891234567890.jpg
✅ [2/120000] (0.0%) Upload: 7891234567891.jpg
⏭️  [3/120000] (0.0%) Já existe: 7891234567892.jpg
...

============================================================
📈 ESTATÍSTICAS DO UPLOAD
============================================================
✅ Uploads bem-sucedidos: 119500
⏭️  Arquivos já existentes: 500
❌ Erros: 0
📊 Total processado: 120000
⏱️  Tempo total: 3600.0s
⚡ Velocidade média: 33.2 fotos/s
============================================================

✨ Upload concluído com sucesso!
```

## 🔍 Verificação

Após o upload, você pode verificar no [Cloudflare Dashboard](https://dash.cloudflare.com/):
1. Acesse **R2**
2. Clique no bucket **mise**
3. Navegue até a pasta **fotos/**
4. Confirme que as imagens foram enviadas

## 🚀 Como o Sistema Funciona

### Busca de Fotos (Prioridade)

1. **R2** (se configurado) - Busca na nuvem com URLs assinadas
2. **Local** (fallback) - Busca no diretório `data/fotos_produtos/`

### URLs Geradas

O sistema retorna URLs no formato:

**R2 (URL Assinada):**
```
https://79a87cdae451f906824c74cd1db9.r2.cloudflarestorage.com/fotos/7891234567890.jpg?X-Amz-Algorithm=...
```

**Local (URL Relativa):**
```
/fotos/7891234567890.jpg
```

### Response da API

```json
{
  "ok": true,
  "origem": "local",
  "produto": {
    "cod de barra": "7891234567890",
    "nome": "Produto Exemplo",
    "foto": {
      "fonte": "r2",
      "url": "https://...",
      "filename": "7891234567890.jpg"
    }
  }
}
```

## 🐛 Troubleshooting

### Erro: "Configure as variáveis de ambiente"

Verifique se o arquivo `.env` existe e contém todas as credenciais necessárias.

### Erro: "Access Denied"

Verifique se:
- As credenciais estão corretas
- O token tem permissões de leitura/escrita
- O bucket name está correto

### Fotos Não Aparecem no App

1. Verifique se as fotos foram enviadas: `node upload-fotos-r2.js`
2. Teste a API: `curl http://localhost:3000/consulta/7891234567890`
3. Verifique os logs do servidor para mensagens de erro

### Upload Muito Lento

O script processa fotos sequencialmente para evitar sobrecarga. Para 120k fotos:
- Tempo estimado: ~1-2 horas (dependendo da conexão)
- Velocidade média: 15-50 fotos/segundo

Para acelerar, você pode modificar o script para processar em lote (batch processing).

## 📝 Notas Importantes

1. **Segurança**: Nunca commite o arquivo `.env` no git (já está no `.gitignore`)
2. **Custos**: Cloudflare R2 oferece 10GB grátis, monitore seu uso
3. **URLs Assinadas**: Expiram após 1 hora (configurável)
4. **Fallback**: O sistema continua funcionando mesmo sem R2 configurado

## 🔗 Links Úteis

- [Cloudflare R2 Docs](https://developers.cloudflare.com/r2/)
- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
- [Mise App GitHub](https://github.com/gustavopinke/mise-app)

---

✨ **Dica**: Após configurar o R2, você pode remover as fotos locais para economizar espaço em disco!
