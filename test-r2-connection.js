import { S3Client, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

console.log('🔍 Testando conexão com Cloudflare R2...\n');

// Mostrar configuração (mascarando chaves sensíveis)
console.log('📋 Configuração atual:');
console.log(`   Account ID: ${process.env.R2_ACCOUNT_ID}`);
console.log(`   Access Key ID: ${process.env.R2_ACCESS_KEY_ID?.slice(0, 8)}...${process.env.R2_ACCESS_KEY_ID?.slice(-4)}`);
console.log(`   Secret Key: ${process.env.R2_SECRET_ACCESS_KEY ? '***configurada*** (length: ' + process.env.R2_SECRET_ACCESS_KEY.length + ')' : 'NÃO CONFIGURADA'}`);
console.log(`   Bucket: ${process.env.R2_BUCKET_NAME}`);
console.log(`   Endpoint: https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com\n`);

// Criar cliente
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function testConnection() {
  try {
    console.log('1️⃣ Tentando listar objetos no bucket...');
    const listCommand = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      MaxKeys: 5,
    });

    const response = await r2Client.send(listCommand);
    console.log('✅ Conexão bem-sucedida!');
    console.log(`   Objetos no bucket: ${response.KeyCount}`);
    console.log(`   Primeiros arquivos:`, response.Contents?.slice(0, 3).map(obj => obj.Key) || []);

    console.log('\n2️⃣ Tentando fazer upload de teste...');
    const testCommand = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: 'test/connection-test.txt',
      Body: Buffer.from(`Teste de conexão - ${new Date().toISOString()}`),
      ContentType: 'text/plain',
    });

    await r2Client.send(testCommand);
    console.log('✅ Upload de teste bem-sucedido!');

    console.log('\n🎉 SUCESSO! As credenciais R2 estão corretas e funcionando!\n');

  } catch (error) {
    console.error('\n❌ ERRO ao conectar com R2:');
    console.error('   Nome:', error.name);
    console.error('   Mensagem:', error.message);
    console.error('   HTTP Status:', error.$metadata?.httpStatusCode);
    console.error('   Request ID:', error.$metadata?.requestId);
    console.error('   Fault:', error.$fault);

    if (error.$metadata?.httpStatusCode === 401) {
      console.error('\n🔑 ERRO DE AUTENTICAÇÃO (401)');
      console.error('   Isso significa que as credenciais estão incorretas.');
      console.error('\n   Verifique no Cloudflare Dashboard:');
      console.error('   1. Acesse R2 > Settings > API Tokens');
      console.error('   2. Confirme que o Access Key ID está correto');
      console.error('   3. Se necessário, crie um novo token R2');
      console.error('   4. Copie EXATAMENTE o Access Key ID e Secret Access Key');
      console.error('   5. Atualize o arquivo .env com os valores corretos\n');
    }

    console.error('\n📋 Detalhes completos do erro:');
    console.error(error);
    process.exit(1);
  }
}

testConnection();
