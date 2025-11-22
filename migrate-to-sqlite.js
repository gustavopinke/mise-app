/**
 * Script de Migração CSV → SQLite
 * Converte a base de produtos CSV para um banco SQLite otimizado
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Caminhos dos arquivos
const CSV_PATH = path.join(__dirname, 'data', 'PARA_BUSCAR_DO_SITE.csv');
const XLSX_PATH = path.join(__dirname, 'data', 'PARA_BUSCAR_DO_SITE.xlsx');
const DB_PATH = path.join(__dirname, 'data', 'produtos.db');
const JSON_CACHE_PATH = path.join(__dirname, 'data', 'produtos.json');
const OK_BASE_PATH = path.join(__dirname, 'data', 'OK BASE DO APP COLETADO.xlsx');

// Normalizar código de barras (7.8913E+12 → 7891300000000)
function normalizarCodigo(valor) {
  if (!valor) return "";
  const str = String(valor).trim();

  if (str.toLowerCase().includes("e")) {
    const num = Number(str);
    return String(num.toFixed(0));
  }

  return str.replace(/\D/g, "");
}

async function migrar() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  MIGRAÇÃO CSV → SQLite');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // Verificar se CSV existe
  if (!fs.existsSync(CSV_PATH) && !fs.existsSync(XLSX_PATH)) {
    console.error('❌ Arquivo CSV ou XLSX não encontrado!');
    console.log('   Esperado em:', CSV_PATH);
    process.exit(1);
  }

  // Criar/abrir banco de dados
  console.log('📦 Criando banco de dados SQLite...');

  // Remover banco antigo se existir
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log('   Banco antigo removido');
  }

  const db = new Database(DB_PATH);

  // Otimizações de performance
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = 10000');
  db.pragma('temp_store = MEMORY');

  // Criar tabela de produtos
  console.log('📋 Criando estrutura do banco...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo_barras TEXT UNIQUE NOT NULL,
      produto TEXT,
      grupo TEXT,
      subgrupo TEXT,
      marca TEXT,
      categoria TEXT,
      ncm TEXT,
      unidade_medida TEXT,
      quantidade TEXT,
      peso_liquido TEXT,
      peso_bruto TEXT,
      preco_medio TEXT,
      fonte TEXT DEFAULT 'local',
      data_cadastro TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_codigo ON produtos(codigo_barras);
    CREATE INDEX IF NOT EXISTS idx_produto ON produtos(produto);
    CREATE INDEX IF NOT EXISTS idx_marca ON produtos(marca);
  `);

  // Criar tabela de produtos encontrados online
  db.exec(`
    CREATE TABLE IF NOT EXISTS produtos_online (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo_barras TEXT UNIQUE NOT NULL,
      nome TEXT,
      marca TEXT,
      categoria TEXT,
      fonte TEXT NOT NULL,
      data_coleta TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_online_codigo ON produtos_online(codigo_barras);
  `);

  // Ler dados do CSV ou XLSX
  let produtos = [];

  if (fs.existsSync(CSV_PATH)) {
    console.log('📂 Lendo CSV...');
    const conteudo = fs.readFileSync(CSV_PATH, 'utf8');
    const linhas = conteudo.split('\n').filter(l => l.trim());

    if (linhas.length === 0) {
      console.error('❌ CSV vazio!');
      process.exit(1);
    }

    // Detectar delimitador
    const delimitador = linhas[0].includes(';') ? ';' : ',';
    const cabecalhos = linhas[0].split(delimitador).map(h => h.trim().toLowerCase());

    console.log(`   Delimitador: "${delimitador}"`);
    console.log(`   Colunas: ${cabecalhos.join(', ')}`);

    for (let i = 1; i < linhas.length; i++) {
      const colunas = linhas[i].split(delimitador);
      if (!colunas[0] || !colunas[0].trim()) continue;

      let obj = {};
      cabecalhos.forEach((cab, idx) => {
        obj[cab] = (colunas[idx] || "").trim();
      });

      // Normalizar código de barras
      const codigoOriginal = obj["cod. de barra"] || obj["cod de barra"] || obj["codigo de barra"] || obj["gtin"];
      const codigo = normalizarCodigo(codigoOriginal);

      if (codigo && codigo.length >= 8) {
        produtos.push({
          codigo_barras: codigo,
          produto: obj['produto'] || obj['nome'] || '',
          grupo: obj['grupo'] || '',
          subgrupo: obj['subgrupo'] || '',
          marca: obj['marca'] || '',
          categoria: obj['categoria'] || '',
          ncm: obj['ncm'] || '',
          unidade_medida: obj['unidade medida'] || obj['unidade_medida'] || '',
          quantidade: obj['quantidade'] || '',
          peso_liquido: obj['peso líquido'] || obj['peso_liquido'] || '',
          peso_bruto: obj['peso bruto'] || obj['peso_bruto'] || '',
          preco_medio: obj['preço médio'] || obj['preco_medio'] || '',
          fonte: 'local'
        });
      }

      // Mostrar progresso
      if (i % 50000 === 0) {
        console.log(`   Processadas ${i.toLocaleString()} linhas...`);
      }
    }
  } else if (fs.existsSync(XLSX_PATH)) {
    console.log('📂 Lendo XLSX...');
    const workbook = XLSX.readFile(XLSX_PATH);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const linhas = XLSX.utils.sheet_to_json(sheet);

    linhas.forEach((l, i) => {
      let p = {};
      for (const key in l) {
        const keyLower = key.toString().toLowerCase().trim();
        p[keyLower] = String(l[key] ?? "").trim();
      }

      const codigoOriginal = p["cod. de barra"] || p["cod de barra"] || p["codigo de barra"] || p["gtin"];
      const codigo = normalizarCodigo(codigoOriginal);

      if (codigo && codigo.length >= 8) {
        produtos.push({
          codigo_barras: codigo,
          produto: p['produto'] || p['nome'] || '',
          grupo: p['grupo'] || '',
          subgrupo: p['subgrupo'] || '',
          marca: p['marca'] || '',
          categoria: p['categoria'] || '',
          ncm: p['ncm'] || '',
          unidade_medida: p['unidade medida'] || p['unidade_medida'] || '',
          quantidade: p['quantidade'] || '',
          peso_liquido: p['peso líquido'] || p['peso_liquido'] || '',
          peso_bruto: p['peso bruto'] || p['peso_bruto'] || '',
          preco_medio: p['preço médio'] || p['preco_medio'] || '',
          fonte: 'local'
        });
      }

      if (i % 50000 === 0 && i > 0) {
        console.log(`   Processadas ${i.toLocaleString()} linhas...`);
      }
    });
  }

  console.log(`✅ ${produtos.length.toLocaleString()} produtos encontrados no arquivo`);

  // Inserir produtos no banco (batch insert para performance)
  console.log('');
  console.log('💾 Inserindo produtos no banco...');

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO produtos
    (codigo_barras, produto, grupo, subgrupo, marca, categoria, ncm, unidade_medida, quantidade, peso_liquido, peso_bruto, preco_medio, fonte)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((produtos) => {
    for (const p of produtos) {
      insertStmt.run(
        p.codigo_barras,
        p.produto,
        p.grupo,
        p.subgrupo,
        p.marca,
        p.categoria,
        p.ncm,
        p.unidade_medida,
        p.quantidade,
        p.peso_liquido,
        p.peso_bruto,
        p.preco_medio,
        p.fonte
      );
    }
  });

  // Inserir em batches de 10000 para mostrar progresso
  const BATCH_SIZE = 10000;
  for (let i = 0; i < produtos.length; i += BATCH_SIZE) {
    const batch = produtos.slice(i, i + BATCH_SIZE);
    insertMany(batch);
    console.log(`   Inseridos ${Math.min(i + BATCH_SIZE, produtos.length).toLocaleString()} / ${produtos.length.toLocaleString()}`);
  }

  // Importar produtos do cache JSON (produtos encontrados online anteriormente)
  if (fs.existsSync(JSON_CACHE_PATH)) {
    console.log('');
    console.log('📂 Importando cache de produtos online...');

    try {
      const cacheData = JSON.parse(fs.readFileSync(JSON_CACHE_PATH, 'utf8'));

      if (Array.isArray(cacheData) && cacheData.length > 0) {
        const insertOnline = db.prepare(`
          INSERT OR REPLACE INTO produtos_online (codigo_barras, nome, fonte, data_coleta)
          VALUES (?, ?, ?, datetime('now'))
        `);

        const insertOnlineMany = db.transaction((items) => {
          for (const item of items) {
            insertOnline.run(item.codigo, item.nome, item.fonte || 'cache');
          }
        });

        insertOnlineMany(cacheData);
        console.log(`   ✅ ${cacheData.length} produtos importados do cache`);
      }
    } catch (e) {
      console.log('   ⚠️ Não foi possível importar cache:', e.message);
    }
  }

  // Importar produtos do Excel "OK BASE DO APP COLETADO"
  if (fs.existsSync(OK_BASE_PATH)) {
    console.log('');
    console.log('📂 Importando "OK BASE DO APP COLETADO.xlsx"...');

    try {
      const workbook = XLSX.readFile(OK_BASE_PATH);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const dados = XLSX.utils.sheet_to_json(sheet);

      if (dados.length > 0) {
        const insertOnline = db.prepare(`
          INSERT OR REPLACE INTO produtos_online (codigo_barras, nome, fonte, data_coleta)
          VALUES (?, ?, ?, ?)
        `);

        const insertOnlineMany = db.transaction((items) => {
          for (const item of items) {
            const codigo = normalizarCodigo(item["Código de Barra"] || item["codigo"] || item["Cod. de Barra"]);
            const nome = item["Nome do Produto"] || item["nome"] || '';
            const fonte = item["Fonte"] || 'online';
            const data = item["Data de Coleta"] || new Date().toISOString();

            if (codigo) {
              insertOnline.run(codigo, nome, fonte, data);
            }
          }
        });

        insertOnlineMany(dados);
        console.log(`   ✅ ${dados.length} produtos importados do Excel`);
      }
    } catch (e) {
      console.log('   ⚠️ Não foi possível importar Excel:', e.message);
    }
  }

  // Estatísticas finais
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  MIGRAÇÃO CONCLUÍDA');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const stats = db.prepare('SELECT COUNT(*) as total FROM produtos').get();
  const statsOnline = db.prepare('SELECT COUNT(*) as total FROM produtos_online').get();
  const dbSize = fs.statSync(DB_PATH).size;

  console.log(`📊 Produtos na base local: ${stats.total.toLocaleString()}`);
  console.log(`📊 Produtos encontrados online: ${statsOnline.total.toLocaleString()}`);
  console.log(`📊 Tamanho do banco: ${(dbSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`📂 Arquivo criado: ${DB_PATH}`);
  console.log('');
  console.log('✅ Agora reinicie o servidor para usar o SQLite!');

  db.close();
}

// Executar migração
migrar().catch(err => {
  console.error('❌ Erro na migração:', err);
  process.exit(1);
});
