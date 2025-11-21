#!/usr/bin/env node

/**
 * Setup OneDrive - Script para configurar a sincronização com OneDrive
 *
 * Este script ajuda a obter o refresh token necessário para sincronizar
 * os arquivos do MISE com seu OneDrive pessoal ou corporativo.
 */

import readline from 'readline';
import fs from 'fs';
import axios from 'axios';
import open from 'open';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function pergunta(texto) {
  return new Promise((resolve) => {
    rl.question(texto, (resposta) => {
      resolve(resposta.trim());
    });
  });
}

console.log(`
╔════════════════════════════════════════════════════════════════════╗
║           CONFIGURAÇÃO DO ONEDRIVE PARA MISE SCANNER               ║
╠════════════════════════════════════════════════════════════════════╣
║  Este assistente vai te ajudar a configurar a sincronização        ║
║  automática dos arquivos de inventário com seu OneDrive.           ║
║                                                                    ║
║  Você vai precisar:                                                ║
║  1. Uma conta Microsoft (pessoal ou trabalho/escola)               ║
║  2. Acesso ao Azure Portal para criar um App Registration          ║
╚════════════════════════════════════════════════════════════════════╝
`);

async function main() {
  console.log('\n📋 PASSO 1: Criar App Registration no Azure Portal\n');
  console.log('   1. Acesse: https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade');
  console.log('   2. Clique em "New registration"');
  console.log('   3. Preencha:');
  console.log('      - Name: "MISE OneDrive Sync"');
  console.log('      - Supported account types: "Accounts in any organizational directory and personal Microsoft accounts"');
  console.log('      - Redirect URI: Selecione "Web" e coloque: http://localhost:3333/callback');
  console.log('   4. Clique em "Register"');
  console.log('   5. Na página do app, copie o "Application (client) ID"');
  console.log('');

  const clientId = await pergunta('Cole aqui o Client ID: ');
  if (!clientId) {
    console.log('❌ Client ID é obrigatório!');
    process.exit(1);
  }

  console.log('\n📋 PASSO 2: Criar Client Secret\n');
  console.log('   1. No menu lateral do app, clique em "Certificates & secrets"');
  console.log('   2. Clique em "New client secret"');
  console.log('   3. Descrição: "MISE Sync"');
  console.log('   4. Expires: Escolha "24 months"');
  console.log('   5. Clique em "Add"');
  console.log('   6. IMPORTANTE: Copie o "Value" imediatamente (só aparece uma vez!)');
  console.log('');

  const clientSecret = await pergunta('Cole aqui o Client Secret (Value): ');
  if (!clientSecret) {
    console.log('❌ Client Secret é obrigatório!');
    process.exit(1);
  }

  console.log('\n📋 PASSO 3: Autorizar o aplicativo\n');
  console.log('   Vou abrir seu navegador para autorizar o acesso ao OneDrive.');
  console.log('   Depois de autorizar, você será redirecionado para uma página com um código.');
  console.log('');

  await pergunta('Pressione ENTER para abrir o navegador...');

  // URL de autorização
  const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
    `client_id=${clientId}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent('http://localhost:3333/callback')}` +
    `&response_mode=query` +
    `&scope=${encodeURIComponent('Files.ReadWrite.All offline_access')}`;

  console.log('\n🌐 Abrindo navegador...');
  console.log('   Se não abrir automaticamente, acesse manualmente:');
  console.log(`   ${authUrl}\n`);

  try {
    await open(authUrl);
  } catch (e) {
    console.log('   (Não foi possível abrir automaticamente, acesse o link acima)');
  }

  console.log('   Após autorizar, você verá uma página de erro ou em branco.');
  console.log('   COPIE O CÓDIGO DA URL (parâmetro "code=...")');
  console.log('   A URL será algo como: http://localhost:3333/callback?code=XXXXXXXX...');
  console.log('');

  const code = await pergunta('Cole aqui o código da URL (depois de "code="): ');
  if (!code) {
    console.log('❌ Código de autorização é obrigatório!');
    process.exit(1);
  }

  console.log('\n🔄 Obtendo tokens de acesso...');

  try {
    const tokenResponse = await axios.post(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: 'http://localhost:3333/callback',
        grant_type: 'authorization_code',
        scope: 'Files.ReadWrite.All offline_access'
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const { refresh_token, access_token } = tokenResponse.data;

    if (!refresh_token) {
      console.log('❌ Não foi possível obter o refresh token!');
      process.exit(1);
    }

    console.log('\n✅ Tokens obtidos com sucesso!\n');

    // Testar acesso
    console.log('🧪 Testando acesso ao OneDrive...');
    try {
      const driveResponse = await axios.get(
        'https://graph.microsoft.com/v1.0/me/drive',
        {
          headers: {
            Authorization: `Bearer ${access_token}`
          }
        }
      );
      console.log(`✅ Conectado ao OneDrive de: ${driveResponse.data.owner?.user?.displayName || 'Usuário'}`);
      console.log(`   Tipo: ${driveResponse.data.driveType}`);
      console.log(`   Espaço usado: ${(driveResponse.data.quota?.used / 1024 / 1024 / 1024).toFixed(2)} GB`);
    } catch (e) {
      console.log('⚠️ Não foi possível testar, mas os tokens foram obtidos.');
    }

    // Perguntar nome da pasta
    console.log('');
    const pasta = await pergunta('Nome da pasta no OneDrive para sincronizar (padrão: MISE-Inventario): ') || 'MISE-Inventario';

    // Salvar no .env
    console.log('\n💾 Salvando configurações no arquivo .env...');

    let envContent = '';
    if (fs.existsSync('.env')) {
      envContent = fs.readFileSync('.env', 'utf8');
    }

    // Atualizar ou adicionar variáveis
    const updates = {
      'ONEDRIVE_CLIENT_ID': clientId,
      'ONEDRIVE_CLIENT_SECRET': clientSecret,
      'ONEDRIVE_REFRESH_TOKEN': refresh_token,
      'ONEDRIVE_FOLDER': pasta
    };

    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
    }

    fs.writeFileSync('.env', envContent.trim() + '\n');

    console.log(`
╔════════════════════════════════════════════════════════════════════╗
║                    ✅ CONFIGURAÇÃO CONCLUÍDA!                       ║
╠════════════════════════════════════════════════════════════════════╣
║                                                                    ║
║  Os arquivos do MISE agora serão sincronizados automaticamente     ║
║  para a pasta "${pasta}" no seu OneDrive.
║                                                                    ║
║  Arquivos sincronizados:                                           ║
║  • Inventário.xlsx                                                 ║
║  • OK BASE DO APP COLETADO.xlsx                                    ║
║                                                                    ║
║  Para sincronizar manualmente:                                     ║
║  POST /api/onedrive/sincronizar                                    ║
║                                                                    ║
║  Para verificar status:                                            ║
║  GET /api/onedrive/status                                          ║
║                                                                    ║
║  IMPORTANTE: Reinicie o servidor para aplicar as configurações!    ║
║  Execute: npm start                                                ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
`);

  } catch (error) {
    console.error('\n❌ Erro ao obter tokens:', error.response?.data || error.message);
    console.log('\nDicas de solução:');
    console.log('  • Verifique se o Client ID e Secret estão corretos');
    console.log('  • Verifique se o código de autorização é válido (expira rápido)');
    console.log('  • Tente executar o script novamente desde o início');
    process.exit(1);
  }

  rl.close();
}

main().catch(console.error);
