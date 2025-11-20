# 🔧 Corrigir Credenciais R2 - Guia Passo a Passo

## ⚠️ Problema Identificado

O erro HTTP 401 indica que as credenciais no arquivo `.env` estão incorretas ou incompletas.

## 📋 Passo 1: Testar Conexão Atual

No terminal (CMD), execute:

```cmd
cd C:\Users\HP\OneDrive\Gustavo\mise\mise-app
node test-r2-connection.js
```

Se aparecer erro 401, as credenciais precisam ser corrigidas.

---

## 🔑 Passo 2: Obter Novas Credenciais R2

### No Cloudflare Dashboard:

1. **Acesse:** https://dash.cloudflare.com/
2. **Vá para:** R2 (menu lateral esquerdo)
3. **Clique em:** "Manage R2 API Tokens" (botão no canto superior direito)

### Criar Novo Token:

4. **Clique:** "Create API Token"
5. **Preencha:**
   - **Token Name:** `mise-upload-token` (ou qualquer nome)
   - **Permissions:** Selecione `Object Read & Write`
   - **TTL:** Leave as "Forever" or set expiration
   - **Bucket:** Selecione o bucket `mise` (ou "Apply to all buckets")
   - **IP Filtering:** DEIXE EM BRANCO (não preencha nada)

6. **Clique:** "Create API Token"

### ⚡ IMPORTANTE - Copiar Credenciais:

7. **AGORA você verá duas informações importantes:**
   - **Access Key ID** (começa com letras/números - exemplo: `a075f202b754a4a7f9f3b77a72ba9151`)
   - **Secret Access Key** (uma string longa - exemplo: `23bb007a27f5fd688ebe891ef1e62b62babb2b3bb00c73b881e6b17124fcf567`)

8. **COPIE EXATAMENTE ESSES VALORES!** Você não poderá vê-los novamente!

---

## 📝 Passo 3: Atualizar arquivo .env

### No Windows:

1. **Abra o arquivo `.env` no Notepad:**
   ```cmd
   cd C:\Users\HP\OneDrive\Gustavo\mise\mise-app
   notepad .env
   ```

2. **Atualize APENAS estas linhas** (cole os valores que você copiou):
   ```
   R2_ACCESS_KEY_ID=COLE_AQUI_O_ACCESS_KEY_ID
   R2_SECRET_ACCESS_KEY=COLE_AQUI_O_SECRET_ACCESS_KEY_COMPLETO
   ```

3. **NÃO mude as outras linhas:**
   ```
   R2_ACCOUNT_ID=79a87cdae451f906824c74cd1db91eb1
   R2_BUCKET_NAME=mise
   R2_PUBLIC_URL=https://79a87cdae451f906824c74cd1db91eb1.r2.cloudflarestorage.com
   ```

4. **Salve o arquivo:** `Ctrl + S`

5. **Feche o Notepad**

---

## ✅ Passo 4: Testar Novamente

```cmd
node test-r2-connection.js
```

Se ver "✅ SUCESSO! As credenciais R2 estão corretas e funcionando!", pode prosseguir!

---

## 🚀 Passo 5: Fazer Upload das Fotos

Quando o teste acima funcionar, execute:

```cmd
node upload-fotos-r2.js "C:\Users\HP\OneDrive\Gustavo\mise\fotos_produtos"
```

---

## 🆘 Se Ainda Não Funcionar

### Verifique:

1. **Copie e cole SEM espaços extras** antes ou depois das chaves
2. **Certifique-se de copiar a chave COMPLETA** (não pode estar cortada)
3. **O Secret Access Key geralmente tem 64+ caracteres**
4. **Não adicione aspas** ao redor dos valores no .env

### Exemplo de .env correto:
```
R2_ACCOUNT_ID=79a87cdae451f906824c74cd1db91eb1
R2_ACCESS_KEY_ID=a075f202b754a4a7f9f3b77a72ba9151
R2_SECRET_ACCESS_KEY=23bb007a27f5fd688ebe891ef1e62b62babb2b3bb00c73b881e6b17124fcf567890abc
R2_BUCKET_NAME=mise
R2_PUBLIC_URL=https://79a87cdae451f906824c74cd1db91eb1.r2.cloudflarestorage.com
```

---

## 📱 Tire Screenshots

Se ainda tiver problemas, tire screenshots de:
1. A tela do Cloudflare mostrando o token criado (pode cobrir parte das chaves)
2. O resultado do comando `node test-r2-connection.js`
3. O conteúdo do arquivo .env (pode cobrir as chaves secretas)
