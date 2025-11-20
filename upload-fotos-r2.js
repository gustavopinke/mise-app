import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Configuração de paths para ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carregar variáveis de ambiente
dotenv.config();

// Configurar cliente R2 da Cloudflare
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'mise';
const FOTOS_DIR = path.join(__dirname, 'data', 'fotos_produtos');

// Extensões de imagem suportadas
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

// Estatísticas
const stats = {
  total: 0,
  uploaded: 0,
  skipped: 0,
  errors: 0,
  startTime: Date.now(),
};

/**
 * Verifica se um arquivo já existe no R2
 */
async function fileExistsInR2(key) {
  try {
    await r2Client.send(new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }));
    return true;
  } catch (error) {
    if (error.name === 'NotFound') {
      return false;
    }
    throw error;
  }
}

/**
 * Faz upload de um arquivo para o R2
 */
async function uploadToR2(filePath, key) {
  const fileContent = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();

  // Determinar Content-Type
  const contentType = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }[ext] || 'application/octet-stream';

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: fileContent,
    ContentType: contentType,
  });

  await r2Client.send(command);
}

/**
 * Processa todos os arquivos do diretório
 */
async function processDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    console.error(`❌ Diretório não encontrado: ${dirPath}`);
    return;
  }

  const files = fs.readdirSync(dirPath);
  stats.total = files.filter(file => {
    const ext = path.extname(file).toLowerCase();
    return IMAGE_EXTENSIONS.includes(ext);
  }).length;

  console.log(`📊 Total de imagens encontradas: ${stats.total}`);
  console.log(`📤 Iniciando upload para R2 (bucket: ${BUCKET_NAME})...\n`);

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const ext = path.extname(file).toLowerCase();

    // Pular se não for uma imagem
    if (!IMAGE_EXTENSIONS.includes(ext)) {
      continue;
    }

    // Pular se for um diretório
    if (fs.statSync(filePath).isDirectory()) {
      continue;
    }

    try {
      // Key no R2 será o nome do arquivo (mantém código de barras)
      const key = `fotos/${file}`;

      // Verificar se já existe no R2 (opcional, para evitar uploads duplicados)
      const exists = await fileExistsInR2(key);
      if (exists) {
        stats.skipped++;
        console.log(`⏭️  [${stats.uploaded + stats.skipped + stats.errors}/${stats.total}] Já existe: ${file}`);
        continue;
      }

      // Fazer upload
      await uploadToR2(filePath, key);
      stats.uploaded++;

      const progress = ((stats.uploaded + stats.skipped + stats.errors) / stats.total * 100).toFixed(1);
      console.log(`✅ [${stats.uploaded + stats.skipped + stats.errors}/${stats.total}] (${progress}%) Upload: ${file}`);

    } catch (error) {
      stats.errors++;
      console.error(`❌ [${stats.uploaded + stats.skipped + stats.errors}/${stats.total}] Erro ao fazer upload de ${file}:`, error.message);
    }
  }
}

/**
 * Mostra estatísticas finais
 */
function showStats() {
  const duration = ((Date.now() - stats.startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(60));
  console.log('📈 ESTATÍSTICAS DO UPLOAD');
  console.log('='.repeat(60));
  console.log(`✅ Uploads bem-sucedidos: ${stats.uploaded}`);
  console.log(`⏭️  Arquivos já existentes: ${stats.skipped}`);
  console.log(`❌ Erros: ${stats.errors}`);
  console.log(`📊 Total processado: ${stats.total}`);
  console.log(`⏱️  Tempo total: ${duration}s`);
  console.log(`⚡ Velocidade média: ${(stats.uploaded / parseFloat(duration)).toFixed(1)} fotos/s`);
  console.log('='.repeat(60));
}

/**
 * Função principal
 */
async function main() {
  console.log('🚀 MISE - Upload de Fotos para Cloudflare R2\n');

  // Validar variáveis de ambiente
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    console.error('❌ Erro: Configure as variáveis de ambiente no arquivo .env');
    console.error('   Copie .env.example para .env e preencha os valores.');
    process.exit(1);
  }

  // Permitir passar um diretório personalizado como argumento
  const customDir = process.argv[2];
  const targetDir = customDir || FOTOS_DIR;

  console.log(`📁 Diretório de origem: ${targetDir}`);
  console.log(`☁️  Bucket R2: ${BUCKET_NAME}`);
  console.log(`🔑 Account ID: ${process.env.R2_ACCOUNT_ID}\n`);

  try {
    await processDirectory(targetDir);
    showStats();

    if (stats.errors === 0) {
      console.log('\n✨ Upload concluído com sucesso!');
      process.exit(0);
    } else {
      console.log('\n⚠️  Upload concluído com alguns erros.');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Erro fatal:', error);
    process.exit(1);
  }
}

// Executar
main();
