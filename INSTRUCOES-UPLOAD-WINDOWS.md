# 📸 Como Fazer Upload das Fotos do Windows para o R2

## 🎯 Situação

Você tem mais de 120 mil fotos em:
```
C:\Users\HP\OneDrive\Gustavo\mise\fotos_produtos
```

E quer fazer upload delas para o Cloudflare R2.

## ✅ Passo a Passo

### 1. Baixar o Código Atualizado

No seu PC Windows, abra o PowerShell ou CMD e execute:

```bash
cd C:\Users\HP\OneDrive\Gustavo\mise
git pull origin claude/fix-script-layout-01BABwSpCcwt9MMS6NDeryP2
```

Ou baixe os arquivos diretamente do GitHub.

### 2. Instalar Node.js (se ainda não tiver)

Baixe e instale do site oficial: https://nodejs.org/
- Versão recomendada: LTS (18.x ou superior)

### 3. Configurar Credenciais do R2

No diretório do projeto, copie o arquivo `.env.example`:

```bash
copy .env.example .env
```

Edite o arquivo `.env` com um editor de texto (Notepad, VS Code, etc.) e preencha:

```env
# Cloudflare R2 Configuration
R2_ACCOUNT_ID=79a87cdae451f906824c74cd1db9
R2_ACCESS_KEY_ID=sua_access_key_aqui
R2_SECRET_ACCESS_KEY=sua_secret_key_aqui
R2_BUCKET_NAME=mise
R2_PUBLIC_URL=https://79a87cdae451f906824c74cd1db9.r2.cloudflarestorage.com
```

**Como obter as credenciais:**
1. Acesse: https://dash.cloudflare.com/
2. Vá em **R2** no menu lateral
3. Clique em **Manage R2 API Tokens**
4. Crie um novo token com permissões de **Read & Write**
5. Anote o **Access Key ID** e **Secret Access Key**

### 4. Instalar Dependências

No PowerShell/CMD, na pasta do projeto:

```bash
npm install
```

### 5. Executar Upload das Fotos

Execute o script apontando para o diretório das fotos:

```bash
node upload-fotos-r2.js "C:\Users\HP\OneDrive\Gustavo\mise\fotos_produtos"
```

**IMPORTANTE:** Use aspas se o caminho tiver espaços!

### 6. Aguardar o Upload

O script irá:
- ✅ Processar as 120k+ fotos
- 📊 Mostrar progresso em tempo real
- ⏭️ Pular fotos já existentes no R2
- 📈 Exibir estatísticas ao final

**Tempo estimado:** 1-2 horas (dependendo da sua conexão de internet)

### 7. Verificar Sucesso

Ao final, você verá:

```
============================================================
📈 ESTATÍSTICAS DO UPLOAD
============================================================
✅ Uploads bem-sucedidos: 120000
⏭️  Arquivos já existentes: 0
❌ Erros: 0
📊 Total processado: 120000
⏱️  Tempo total: 3600.0s
⚡ Velocidade média: 33.3 fotos/s
============================================================

✨ Upload concluído com sucesso!
```

## 🔍 Verificar no Cloudflare

1. Acesse: https://dash.cloudflare.com/
2. Vá em **R2**
3. Clique no bucket **mise**
4. Entre na pasta **fotos/**
5. Confirme que as imagens foram enviadas

## 🐛 Problemas Comuns

### Erro: "Cannot find module 'dotenv'"

Execute novamente:
```bash
npm install
```

### Erro: "Access Denied"

- Verifique se as credenciais no `.env` estão corretas
- Confirme que o token tem permissões de Read & Write
- Teste com uma foto primeiro

### Upload Muito Lento

É normal! São 120 mil fotos. Deixe o script rodando e vá tomar um café ☕

### Interrompeu no Meio

Não tem problema! Execute o script novamente. Ele pula fotos já enviadas automaticamente.

## 💡 Dicas

1. **Deixe o PC ligado** durante o upload
2. **Não feche o terminal** enquanto o script está rodando
3. **Use uma conexão estável** (evite WiFi instável)
4. **Monitore o progresso** através dos logs

## 🎉 Após o Upload

Depois que todas as fotos estiverem no R2:
1. O app automaticamente buscará as fotos da nuvem
2. Você pode remover as fotos locais do servidor para economizar espaço
3. As fotos no seu PC podem servir como backup

---

## 📞 Precisa de Ajuda?

Se tiver algum erro, me envie:
1. A mensagem de erro completa
2. O conteúdo do seu arquivo `.env` (SEM as credenciais secretas!)
3. A versão do Node.js: `node --version`
