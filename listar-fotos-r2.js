import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

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
  forcePathStyle: true,
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'mise';

async function listarFotos() {
  console.log('🔍 Listando fotos no R2...\n');
  console.log(`☁️  Bucket: ${BUCKET_NAME}`);
  console.log(`📁 Prefixo: fotos/\n`);

  try {
    let continuationToken = null;
    let totalFotos = 0;
    const todasFotos = [];

    do {
      const command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: 'fotos/',
        ContinuationToken: continuationToken,
      });

      const response = await r2Client.send(command);

      if (response.Contents) {
        for (const item of response.Contents) {
          const filename = item.Key.replace('fotos/', '');
          if (filename) {
            todasFotos.push({
              filename,
              size: item.Size,
              lastModified: item.LastModified,
            });
            totalFotos++;
          }
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : null;
    } while (continuationToken);

    console.log(`📊 Total de fotos encontradas: ${totalFotos}\n`);
    console.log('='.repeat(80));
    console.log('LISTA DE FOTOS NO R2:');
    console.log('='.repeat(80));

    // Agrupar por código de barras (primeiros dígitos)
    const porCodigo = {};
    for (const foto of todasFotos) {
      const match = foto.filename.match(/^(\d+)/);
      const codigo = match ? match[1] : 'outros';
      if (!porCodigo[codigo]) {
        porCodigo[codigo] = [];
      }
      porCodigo[codigo].push(foto.filename);
    }

    // Mostrar agrupado
    const codigos = Object.keys(porCodigo).sort();
    for (const codigo of codigos) {
      console.log(`\n📦 Código: ${codigo}`);
      for (const arquivo of porCodigo[codigo]) {
        console.log(`   └─ ${arquivo}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`\n✅ Total: ${totalFotos} fotos em ${codigos.length} códigos diferentes`);

    // Mostrar códigos únicos para teste
    console.log('\n📋 CÓDIGOS DE BARRAS DISPONÍVEIS (para testar na busca):');
    console.log('-'.repeat(40));
    codigos.slice(0, 20).forEach(c => {
      if (c !== 'outros') console.log(`   ${c}`);
    });
    if (codigos.length > 20) {
      console.log(`   ... e mais ${codigos.length - 20} códigos`);
    }

  } catch (error) {
    console.error('❌ Erro ao listar fotos:', error.message);
    if (error.$metadata) {
      console.error('   HTTP Status:', error.$metadata.httpStatusCode);
    }
  }
}

// Executar
listarFotos();
