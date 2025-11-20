import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';

// Carregar variáveis de ambiente
dotenv.config();

// Verificar se deve usar R2 (variáveis configuradas)
const USE_R2 = Boolean(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY
);

let r2Client = null;
const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'mise';

// Inicializar cliente R2 se configurado
if (USE_R2) {
  r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true, // Importante para R2
  });
  console.log('✅ Cliente R2 inicializado com sucesso');
} else {
  console.log('⚠️  R2 não configurado - usando armazenamento local');
}

/**
 * Verifica se uma foto existe no R2
 * @param {string} filename - Nome do arquivo (ex: 7891234567890.jpg)
 * @returns {Promise<boolean>}
 */
export async function fotoExisteR2(filename) {
  if (!USE_R2 || !r2Client) return false;

  try {
    await r2Client.send(new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `fotos/${filename}`,
    }));
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    console.error(`Erro ao verificar foto no R2: ${filename}`, error.message);
    return false;
  }
}

/**
 * Gera uma URL assinada (pré-assinada) para acessar uma foto do R2
 * @param {string} filename - Nome do arquivo (ex: 7891234567890.jpg)
 * @param {number} expiresIn - Tempo de expiração em segundos (padrão: 3600 = 1 hora)
 * @returns {Promise<string|null>} URL assinada ou null se não encontrada
 */
export async function gerarUrlFotoR2(filename, expiresIn = 3600) {
  if (!USE_R2 || !r2Client) return null;

  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `fotos/${filename}`,
    });

    const url = await getSignedUrl(r2Client, command, { expiresIn });
    return url;
  } catch (error) {
    console.error(`Erro ao gerar URL para foto: ${filename}`, error.message);
    return null;
  }
}

/**
 * Gera URL pública do R2 (se o bucket estiver configurado como público)
 * @param {string} filename - Nome do arquivo
 * @returns {string|null} URL pública ou null
 */
export function gerarUrlPublicaR2(filename) {
  if (!USE_R2) return null;

  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!publicUrl) return null;

  return `${publicUrl}/fotos/${filename}`;
}

/**
 * Busca foto do produto no R2 (tenta várias extensões)
 * @param {string} codigoBarras - Código de barras do produto
 * @returns {Promise<{url: string, filename: string}|null>}
 */
export async function buscarFotoR2(codigoBarras) {
  if (!USE_R2 || !r2Client) return null;

  const extensoes = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
  const sufixos = ['', '_mise'];

  // Tentar todas as combinações
  for (const sufixo of sufixos) {
    for (const ext of extensoes) {
      const filename = `${codigoBarras}${sufixo}.${ext}`;

      const existe = await fotoExisteR2(filename);
      if (existe) {
        // Tentar URL pública primeiro
        const publicUrl = gerarUrlPublicaR2(filename);
        if (publicUrl) {
          return { url: publicUrl, filename };
        }

        // Caso contrário, gerar URL assinada
        const signedUrl = await gerarUrlFotoR2(filename);
        if (signedUrl) {
          return { url: signedUrl, filename };
        }
      }
    }
  }

  return null;
}

/**
 * Verifica se o R2 está habilitado
 * @returns {boolean}
 */
export function r2Habilitado() {
  return USE_R2;
}

export default {
  fotoExisteR2,
  gerarUrlFotoR2,
  gerarUrlPublicaR2,
  buscarFotoR2,
  r2Habilitado,
};
