/**
 * OneDrive Helper - Sincronização automática de arquivos
 * Usa Microsoft Graph API para upload de arquivos para o OneDrive
 */

import fs from 'fs';
import path from 'path';
import axios from 'axios';

// Configurações do OneDrive (via variáveis de ambiente)
const ONEDRIVE_CLIENT_ID = process.env.ONEDRIVE_CLIENT_ID;
const ONEDRIVE_CLIENT_SECRET = process.env.ONEDRIVE_CLIENT_SECRET;
const ONEDRIVE_REFRESH_TOKEN = process.env.ONEDRIVE_REFRESH_TOKEN;
const ONEDRIVE_FOLDER = process.env.ONEDRIVE_FOLDER || 'MISE-Inventario'; // Pasta no OneDrive

// Cache do access token
let accessToken = null;
let tokenExpiry = 0;

/**
 * Verifica se o OneDrive está configurado
 */
export function onedriveHabilitado() {
  return !!(ONEDRIVE_CLIENT_ID && ONEDRIVE_CLIENT_SECRET && ONEDRIVE_REFRESH_TOKEN);
}

/**
 * Obtém um novo access token usando o refresh token
 */
async function obterAccessToken() {
  // Retorna token em cache se ainda válido (com margem de 5 min)
  if (accessToken && Date.now() < tokenExpiry - 300000) {
    return accessToken;
  }

  console.log('🔑 OneDrive: Obtendo novo access token...');

  try {
    const response = await axios.post(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      new URLSearchParams({
        client_id: ONEDRIVE_CLIENT_ID,
        client_secret: ONEDRIVE_CLIENT_SECRET,
        refresh_token: ONEDRIVE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
        scope: 'Files.ReadWrite.All offline_access'
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    accessToken = response.data.access_token;
    // Token expira em expires_in segundos, guardar timestamp de expiração
    tokenExpiry = Date.now() + (response.data.expires_in * 1000);

    console.log('✅ OneDrive: Access token obtido com sucesso');
    return accessToken;

  } catch (error) {
    console.error('❌ OneDrive: Erro ao obter access token:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Cria a pasta no OneDrive se não existir
 */
async function criarPastaSeNecessario(token) {
  try {
    // Verificar se pasta existe
    await axios.get(
      `https://graph.microsoft.com/v1.0/me/drive/root:/${ONEDRIVE_FOLDER}`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    console.log(`📁 OneDrive: Pasta '${ONEDRIVE_FOLDER}' já existe`);
  } catch (error) {
    if (error.response?.status === 404) {
      // Pasta não existe, criar
      console.log(`📁 OneDrive: Criando pasta '${ONEDRIVE_FOLDER}'...`);
      await axios.post(
        'https://graph.microsoft.com/v1.0/me/drive/root/children',
        {
          name: ONEDRIVE_FOLDER,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail'
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log(`✅ OneDrive: Pasta '${ONEDRIVE_FOLDER}' criada`);
    } else {
      throw error;
    }
  }
}

/**
 * Faz upload de um arquivo para o OneDrive
 * @param {string} localPath - Caminho local do arquivo
 * @param {string} remoteName - Nome do arquivo no OneDrive (opcional, usa nome original se não especificado)
 */
export async function uploadParaOneDrive(localPath, remoteName = null) {
  if (!onedriveHabilitado()) {
    console.log('⚠️ OneDrive não configurado, sincronização ignorada');
    return null;
  }

  try {
    const token = await obterAccessToken();
    const fileName = remoteName || path.basename(localPath);

    // Garantir que a pasta existe
    await criarPastaSeNecessario(token);

    // Ler arquivo
    const fileContent = fs.readFileSync(localPath);
    const fileSize = fileContent.length;

    console.log(`☁️ OneDrive: Fazendo upload de '${fileName}' (${(fileSize / 1024).toFixed(1)} KB)...`);

    // Para arquivos pequenos (< 4MB), usar upload simples
    if (fileSize < 4 * 1024 * 1024) {
      const response = await axios.put(
        `https://graph.microsoft.com/v1.0/me/drive/root:/${ONEDRIVE_FOLDER}/${fileName}:/content`,
        fileContent,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/octet-stream'
          }
        }
      );

      console.log(`✅ OneDrive: Upload de '${fileName}' concluído`);
      return {
        ok: true,
        fileName,
        webUrl: response.data.webUrl,
        id: response.data.id
      };
    } else {
      // Para arquivos maiores, usar upload em sessão
      // Criar sessão de upload
      const sessionResponse = await axios.post(
        `https://graph.microsoft.com/v1.0/me/drive/root:/${ONEDRIVE_FOLDER}/${fileName}:/createUploadSession`,
        {
          item: {
            '@microsoft.graph.conflictBehavior': 'replace'
          }
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const uploadUrl = sessionResponse.data.uploadUrl;

      // Upload em chunks de 10MB
      const chunkSize = 10 * 1024 * 1024;
      let offset = 0;

      while (offset < fileSize) {
        const end = Math.min(offset + chunkSize, fileSize);
        const chunk = fileContent.slice(offset, end);

        const uploadResponse = await axios.put(
          uploadUrl,
          chunk,
          {
            headers: {
              'Content-Length': chunk.length,
              'Content-Range': `bytes ${offset}-${end - 1}/${fileSize}`
            }
          }
        );

        if (uploadResponse.status === 200 || uploadResponse.status === 201) {
          console.log(`✅ OneDrive: Upload de '${fileName}' concluído`);
          return {
            ok: true,
            fileName,
            webUrl: uploadResponse.data.webUrl,
            id: uploadResponse.data.id
          };
        }

        offset = end;
        console.log(`   Upload: ${Math.round((offset / fileSize) * 100)}%`);
      }
    }

  } catch (error) {
    console.error(`❌ OneDrive: Erro no upload de '${localPath}':`, error.response?.data || error.message);
    return {
      ok: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
}

/**
 * Sincroniza múltiplos arquivos para o OneDrive
 * @param {string[]} arquivos - Array de caminhos locais
 */
export async function sincronizarArquivos(arquivos) {
  if (!onedriveHabilitado()) {
    return { ok: false, message: 'OneDrive não configurado' };
  }

  const resultados = [];

  for (const arquivo of arquivos) {
    if (fs.existsSync(arquivo)) {
      const resultado = await uploadParaOneDrive(arquivo);
      resultados.push({ arquivo, resultado });
    } else {
      resultados.push({ arquivo, resultado: { ok: false, error: 'Arquivo não existe' } });
    }
  }

  return {
    ok: true,
    resultados
  };
}

/**
 * Retorna status da configuração do OneDrive
 */
export function getOneDriveStatus() {
  return {
    habilitado: onedriveHabilitado(),
    pasta: ONEDRIVE_FOLDER,
    configurado: {
      clientId: !!ONEDRIVE_CLIENT_ID,
      clientSecret: !!ONEDRIVE_CLIENT_SECRET,
      refreshToken: !!ONEDRIVE_REFRESH_TOKEN
    }
  };
}
